// Cinderworks Foundry — engine core, rewritten from scratch.
//
// This file wires the nine subsystem modules into a playable round-based
// tactical FPS. The shape of the wiring is deliberately event-driven: the
// per-frame driver and the bots never apply damage directly. They post
// combat intents (shots, blasts) into a small queue, and a dispatcher at the
// end of each fixed step resolves them in order — hit test, falloff, wound,
// kill feed — so a frame's kills are always settled before the next frame's
// decisions. A tiny phase table (buy / live / over / idle) drives the step;
// the match module itself owns the round economy and the win conditions.
//
// The staged screenshot section at the bottom of this file is untouched and
// relies on the names defined here: shotMode, FIXED, step, updateCamera,
// syncPlayerHitbox, paused, started, simT, and the renderer/scene/camera/
// player/arsenal/bots/effects/match/input/hud objects.
import * as THREE from 'three';
import { createWorld, SPAWN_ATTACK } from './world.js';
import { createPlayer } from './player.js';
import { WEAPONS, GRENADES, damageFor, createArsenal } from './weapons.js';
import { createBot, updateBot, EMBER_NAMES, SLAG_NAMES } from './bots.js';
import { createEffects } from './effects.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';
import { createHud } from './hud.js';
import { createMatch } from './match.js';

// --- constants ------------------------------------------------------------------
const FIXED = 1 / 60;            // fixed simulation step
const BASE_FOV = 75;             // hip-fire field of view
const UP = new THREE.Vector3(0, 1, 0);
const GRENADE_FUSE = { frag: 2.0, flash: 1.5, smoke: 1.7 };
const GRENADE_GRAVITY = 18;
// Player hit volumes mirror the bots' (head / torso / leg).
const HIT_DEFS = [
  { geo: new THREE.SphereGeometry(0.19, 8, 6), y: 1.66, part: 'head' },
  { geo: new THREE.BoxGeometry(0.6, 0.76, 0.36), y: 1.14, part: 'torso' },
  { geo: new THREE.BoxGeometry(0.46, 0.8, 0.3), y: 0.4, part: 'leg' },
];
// Scratch vectors — reused everywhere so the hot loop never allocates.
const _eye = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _end = new THREE.Vector3();
const _ray = new THREE.Raycaster();

// --- run state ------------------------------------------------------------------
let simT = 0;                    // simulation clock, seconds
let paused = false;
let started = false;
let aiming = false;              // right mouse held, alive
let trauma = 0;                  // camera shake energy 0..1
let triggerArmed = true;         // semi-auto trigger latch
let audioReady = false;          // audio graph brought up on the first step

// --- staged capture ---------------------------------------------------------------
const shotParams = new URLSearchParams(window.location.search);
const shotMode = shotParams.get('shot');
if (shotMode) window.__shotMode = true;

// --- stage: renderer, scene, camera ----------------------------------------------
function buildStage() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  document.getElementById('game').appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(BASE_FOV, window.innerWidth / window.innerHeight, 0.1, 200);
  camera.rotation.order = 'YXZ';
  scene.add(camera); // the gun view model hangs off the camera
  return { renderer, scene, camera };
}
const { renderer, scene, camera } = buildStage();

// --- subsystems ---------------------------------------------------------------------
const world = createWorld(scene);
const player = createPlayer(world.colliders);
const arsenal = createArsenal(camera);
const effects = createEffects(scene);
const audio = createAudio();

// The player module keeps its own closed-over state for yaw/pitch/health; the
// object it returns also carries plain copies of those fields, which is what
// the match module, the HUD and the staged shots read. Keep the two in sync:
// after every reset and every look, mirror the live values onto the object.
const rawReset = player.reset.bind(player);
player.reset = (p, yaw) => {
  rawReset(p, yaw);
  player.alive = true;
  player.health = 100;
  player.crouching = false;
  player.yaw = yaw;
  player.pitch = 0;
};
player.isPlayer = true;
player.team = 'attack';
player.speedNow = () => player.groundSpeed();
function syncLook() {
  player.forward(_fwd);
  player.yaw = Math.atan2(-_fwd.x, -_fwd.z);
  player.pitch = Math.asin(THREE.MathUtils.clamp(_fwd.y, -1, 1));
}

// Roster: four Ember attackers, five Slag defenders, in stageShot's order.
const ATTACK_ROLES = ['pusherA', 'pusherB', 'lurker', 'support'];
const DEFEND_ROLES = ['anchorA', 'anchorB', 'mid', 'rotator', 'defuser'];
const bots = [
  ...EMBER_NAMES.slice(0, 4).map((name, i) => createBot('attack', name, ATTACK_ROLES[i], 'rifle')),
  ...SLAG_NAMES.map((name, i) => createBot('defend', name, DEFEND_ROLES[i], 'rifle')),
];
for (const b of bots) scene.add(b.group);
const combatants = [player, ...bots];

// Invisible hit volumes for the player, so bots can wound them like any bot.
const playerRig = new THREE.Group();
const playerHitMeshes = [];
for (const d of HIT_DEFS) {
  const m = new THREE.Mesh(d.geo);
  m.position.y = d.y;
  m.visible = false;
  m.userData.combatant = player;
  m.userData.part = d.part;
  playerRig.add(m);
  playerHitMeshes.push(m);
}
playerRig.position.set(0, 0, 17.5);
scene.add(playerRig);
player.hitMeshes = playerHitMeshes;
function syncPlayerHitbox() {
  playerRig.position.set(player.pos.x, player.eye < 1.4 ? -0.34 : 0, player.pos.z);
  playerRig.rotation.y = player.yaw;
}
// Everything a bullet can strike: hall geometry plus every combatant's volumes.
const shotTargets = [...world.shootMeshes, ...playerHitMeshes, ...bots.flatMap((b) => b.hitMeshes)];

// --- combat event queue ---------------------------------------------------------------
// Producers (the player driver, the bots via ctx.shoot, the match via
// blastDamage) only enqueue intents. drainEvents() resolves them FIFO; a
// lethal wound enqueues its kill at the FRONT so the victim is already down
// before any later shot in the same step is resolved.
const eventQueue = [];
function postEvent(ev) { eventQueue.push(ev); }
function drainEvents() {
  while (eventQueue.length > 0) {
    const ev = eventQueue.shift();
    if (ev.kind === 'shot') resolveShot(ev);
    else if (ev.kind === 'blast') applyBlast(ev);
    else if (ev.kind === 'kill') settleKill(ev);
  }
}

// Damage falls from full inside half the weapon's range to 40% at max range.
function falloffFor(weapon, dist) {
  const half = weapon.range * 0.5;
  if (dist <= half) return 1;
  return Math.max(0.4, 1 - 0.6 * ((dist - half) / half));
}

// Apply raw damage to a combatant; post a kill event when it is lethal.
// Returns true when the wound killed.
function wound(target, dmg, killer, headshot) {
  if (!target.alive || target.health <= 0) return false;
  let killed = false;
  if (target === player) {
    player.health = Math.max(0, player.health - dmg);
    player.lastHurtAt = simT;
    hud.damageFlash();
    audio.hurt();
    trauma = Math.min(1, trauma + 0.3);
    killed = player.health <= 0;
  } else {
    target.health = Math.max(0, target.health - dmg);
    killed = target.health <= 0;
  }
  if (killed) eventQueue.unshift({ kind: 'kill', killer, victim: target, headshot });
  return killed;
}

function settleKill(ev) {
  const { killer, victim, headshot } = ev;
  if (!victim.alive) return;
  victim.alive = false;
  if (victim !== player) {
    victim.group.rotation.x = -Math.PI / 2; // fall flat, stay visible
    victim.group.position.y = 0.25;
  }
  hud.killfeed(
    !killer ? 'CHARGE' : killer === player ? 'You' : killer.name,
    victim === player ? 'You' : victim.name,
    headshot,
    !killer ? true : killer.team === 'attack',
    victim.team === 'attack',
  );
  if (killer === player) match.rewardKill('player');
}

function resolveShot(ev) {
  const { shooter, origin, dir, weapon } = ev;
  _ray.set(origin, dir);
  _ray.far = weapon.range;
  const hits = _ray.intersectObjects(shotTargets, false);
  let struck = null;
  let part = null;
  let hitWorld = false;
  for (const h of hits) {
    const c = h.object.userData.combatant;
    if (!c) { hitWorld = true; _end.copy(h.point); break; }
    if (c === shooter || !c.alive || c.team === shooter.team) continue;
    struck = c; part = h.object.userData.part; _end.copy(h.point); break;
  }
  if (!struck && !hitWorld) _end.copy(dir).multiplyScalar(weapon.range).add(origin);
  effects.tracer(origin, _end, simT);
  effects.muzzle(origin, simT);
  if (struck) {
    const dist = origin.distanceTo(_end);
    const dmg = damageFor(weapon, part, struck) * falloffFor(weapon, dist);
    const killed = wound(struck, dmg, shooter, part === 'head');
    if (shooter === player) { audio.hit(killed); hud.hitmarker(killed); }
  } else if (hitWorld) {
    effects.impact(_end, simT, 4);
  }
  if (shooter !== player) {
    player.eyePos(_eye);
    audio.shot(weapon.kind, origin.distanceTo(_eye));
  }
}

function applyBlast(ev) {
  const { pos, radius, damage, killer } = ev;
  for (const c of combatants) {
    if (!c.alive) continue;
    c.eyePos(_eye);
    const d = _eye.distanceTo(pos);
    if (d > radius) continue;
    const scaled = damage * Math.max(0.25, 1 - d / radius);
    const killed = wound(c, scaled, killer, false);
    if (killer === player && killed) { audio.hit(true); hud.hitmarker(true); }
  }
}

// --- grenades -------------------------------------------------------------------
const grenadeGeo = new THREE.SphereGeometry(0.09, 10, 8);
const grenadeMat = new THREE.MeshStandardMaterial({ color: 0x2c3036, roughness: 0.5, metalness: 0.8 });
const liveGrenades = []; // {type, mesh, vel, fuse}

function lobGrenade(type) {
  if (match.state.phase !== 'live' || !player.alive) return;
  if (arsenal.state.grenades[type] <= 0) return;
  arsenal.state.grenades[type] -= 1;
  player.eyePos(_eye);
  player.forward(_fwd);
  const mesh = new THREE.Mesh(grenadeGeo, grenadeMat);
  mesh.position.copy(_eye).addScaledVector(_fwd, 0.6);
  scene.add(mesh);
  liveGrenades.push({
    type, mesh,
    vel: _fwd.clone().multiplyScalar(15).add(new THREE.Vector3(0, 4, 0)),
    fuse: GRENADE_FUSE[type],
  });
  audio.throwWhoosh();
}

function flashExposure(pos) {
  player.eyePos(_eye);
  _dir.copy(pos).sub(_eye);
  const dist = _dir.length();
  if (dist > GRENADES.flash.radius) return 0;
  _dir.normalize();
  const los = world.raycast(_eye, _dir, dist, world.shootMeshes);
  if (los && los.distance < dist - 0.4) return 0;
  player.forward(_fwd);
  const facing = Math.max(0, _fwd.dot(_dir));
  return (1 - dist / GRENADES.flash.radius) * (0.35 + 0.65 * facing);
}

function detonateGrenade(g) {
  const pos = g.mesh.position.clone();
  if (g.type === 'frag') {
    postEvent({ kind: 'blast', pos, radius: GRENADES.frag.radius, damage: GRENADES.frag.damage, killer: player });
    effects.explode(pos, simT);
    audio.explode(player.pos.distanceTo(pos));
  } else if (g.type === 'flash') {
    const strength = flashExposure(pos);
    if (strength > 0.05) hud.flashWhite(strength);
    audio.flash();
  } else {
    effects.smoke(pos, simT, GRENADES.smoke.life);
  }
}

function updateGrenades(dt) {
  for (let i = liveGrenades.length - 1; i >= 0; i -= 1) {
    const g = liveGrenades[i];
    g.fuse -= dt;
    g.vel.y -= GRENADE_GRAVITY * dt;
    g.mesh.position.addScaledVector(g.vel, dt);
    const p = g.mesh.position;
    if (p.y < 0.12) {
      p.y = 0.12;
      g.vel.y = Math.abs(g.vel.y) > 1.2 ? -g.vel.y * 0.35 : 0;
      g.vel.x *= 0.6; g.vel.z *= 0.6;
    }
    p.x = THREE.MathUtils.clamp(p.x, -26.4, 26.4);
    p.z = THREE.MathUtils.clamp(p.z, -20.4, 20.4);
    if (g.fuse <= 0) {
      detonateGrenade(g);
      scene.remove(g.mesh);
      liveGrenades.splice(i, 1);
    }
  }
}

// --- player driver ------------------------------------------------------------------
// One live frame of operator control: look, move, fire, reload, swap, throw.
function postPlayerShot(w) {
  player.eyePos(_eye);
  player.forward(_fwd);
  const spread = arsenal.spread(player.groundSpeed(), player.eye < 1.4, aiming);
  _right.crossVectors(_fwd, UP);
  if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0);
  _right.normalize();
  _up.crossVectors(_right, _fwd).normalize();
  _muzzle.copy(_eye).addScaledVector(_fwd, 0.5).addScaledVector(_right, 0.16).addScaledVector(_up, -0.14);
  for (let p = 0; p < w.pellets; p += 1) {
    _dir.copy(_fwd)
      .addScaledVector(_right, (Math.random() - 0.5) * 2 * spread)
      .addScaledVector(_up, (Math.random() - 0.5) * 2 * spread)
      .normalize();
    postEvent({ kind: 'shot', shooter: player, origin: _muzzle.clone(), dir: _dir.clone(), weapon: w });
  }
}

function switchWeapon(id) {
  if (!WEAPONS[id] || !arsenal.state.owned[id]) return;
  if (match.state.phase !== 'live' && match.state.phase !== 'buy') return;
  arsenal.equip(id);
}

function drivePlayer(dt) {
  const look = input.takeLook();
  if ((look.x || look.y) && player.alive) {
    player.look(look.x, look.y);
    syncLook();
  }
  if (player.alive) player.update(dt, input);

  const w = arsenal.currentWeapon();
  const wantFire = input.state.firing && player.alive;
  if (!wantFire) triggerArmed = true;
  if (wantFire && triggerArmed) {
    if (arsenal.ready(simT)) {
      if (arsenal.fire(simT, audio)) {
        postPlayerShot(w);
        player.recoil(w.kick, (Math.random() - 0.5) * w.kick * 0.6);
        syncLook();
        trauma = Math.min(1, trauma + 0.05);
        if (!w.auto) triggerArmed = false;
      }
    } else if (arsenal.state.mag === 0 && !arsenal.state.reloading) {
      audio.dryClick();
      if (!w.auto) triggerArmed = false;
    }
  }
  if (arsenal.needsReload()) arsenal.startReload(simT, audio);
  arsenal.finishReloads(simT);

  if (input.consumePressed('KeyR')) arsenal.startReload(simT, audio);
  if (input.consumePressed('Digit1')) switchWeapon('smg');
  if (input.consumePressed('Digit2')) switchWeapon('shotgun');
  if (input.consumePressed('Digit3')) switchWeapon('rifle');
  if (input.consumePressed('Digit4')) switchWeapon('marksman');
  if (input.consumePressed('KeyG')) lobGrenade('frag');
  if (input.consumePressed('KeyF')) lobGrenade('flash');
  if (input.consumePressed('KeyT')) lobGrenade('smoke');

  const spd = player.groundSpeed();
  if (spd > 1 && simT - player.lastStepAt > 0.36) {
    player.lastStepAt = simT;
    audio.step();
  }
  aiming = input.state.aiming && player.alive;
  arsenal.updateVisual(dt, simT, spd > 0.5);
}

// --- camera -------------------------------------------------------------------------
function updateCamera(dt) {
  player.eyePos(_eye);
  camera.position.copy(_eye);
  camera.rotation.y = player.yaw;
  camera.rotation.x = player.pitch;
  camera.rotation.z = 0;
  trauma = Math.max(0, trauma - dt * 1.5);
  if (trauma > 0.001) {
    camera.position.x += (Math.random() - 0.5) * 0.06 * trauma;
    camera.position.y += (Math.random() - 0.5) * 0.06 * trauma;
    camera.rotation.z += (Math.random() - 0.5) * 0.02 * trauma;
  }
  const wantFov = aiming ? arsenal.currentWeapon().adsFov : BASE_FOV;
  if (Math.abs(camera.fov - wantFov) > 0.05) {
    camera.fov += (wantFov - camera.fov) * Math.min(1, dt * 10);
    camera.updateProjectionMatrix();
  }
}

// --- HUD sync -------------------------------------------------------------------------
function fmtClock(t) {
  const s = Math.max(0, Math.ceil(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function syncHud() {
  const hs = match.hudState();
  const planted = hs.planted;
  const clock = planted ? planted.tLeft : hs.phaseT;
  hud.update({
    health: Math.max(0, Math.ceil(player.health)),
    armour: player.armour,
    mag: arsenal.state.mag,
    reserve: arsenal.state.reserve,
    weaponName: arsenal.currentWeapon().name,
    money: hs.money,
    timerText: fmtClock(clock),
    phaseLabel: hs.phase === 'buy' ? 'BUY PHASE' : planted ? 'CHARGE LIVE' : 'ROUND',
    timerUrgent: clock <= 10,
    scoreUs: hs.score.attack,
    scoreThem: hs.score.defend,
    roundNum: hs.round,
    objective: planted ? `DEFEND THE CHARGE — SITE ${planted.site}`
      : hs.phase === 'buy' ? 'BUY YOUR KIT — DEPLOY WHEN READY'
      : 'PLANT THE CHARGE AT MELT SHOP OR CASTING BAY — OR CLEAR SLAG',
    grenades: arsenal.state.grenades,
  });
  hud.setSpread(Math.round(5 + arsenal.spread(player.groundSpeed(), player.eye < 1.4, aiming) * 500));
  if (hs.plantProgress > 0 && !planted) hud.setChargeBar(hs.plantProgress, 'PLANTING THE CHARGE…');
  else if (planted && hs.defuseProgress > 0) hud.setChargeBar(hs.defuseProgress, 'DEFUSING THE CHARGE…');
  else hud.setChargeBar(null);
}

// --- input, HUD, match ------------------------------------------------------------------
// hud's callbacks close over `match`, which is assigned just below; they only
// run on user action, long after this module finishes evaluating.
let match = null;
const input = createInput(renderer.domElement, onLockChange);
const hud = createHud({
  onBuy: (id) => { if (match) match.buy(id); },
  onPlay: handlePlay,
});

// What the bots see: the world, the clock, every combatant, the effects (for
// smoke) and a shoot callback that only enqueues — resolution happens in the
// dispatcher, never inside a bot's own update.
const botCtx = {
  world,
  effects,
  combatants,
  shoot: (shooter, origin, dir, weapon) => postEvent({
    kind: 'shot', shooter, origin: origin.clone(), dir: dir.clone(), weapon,
  }),
  t: 0,
  get planted() { return !!match.state.planted; },
  get chargeNode() { return match.state.planted ? (match.state.planted.site === 'A' ? 15 : 20) : -1; },
  get chargePos() { return match.state.planted ? match.state.planted.pos : new THREE.Vector3(); },
};

match = createMatch({
  world, player, arsenal, bots, hud, audio, effects, scene, input,
  blastDamage: (pos, radius, damage) => postEvent({ kind: 'blast', pos: pos.clone(), radius, damage, killer: null }),
});

function handlePlay() {
  audio.ensure();
  if (paused) {
    paused = false;
    hud.hideMenu();
    input.lock();
    return;
  }
  const phase = match.state.phase;
  if (phase === 'idle' || phase === 'matchover') {
    match.start();
    hud.hideMenu();
    started = true;
  }
}

function onLockChange(locked) {
  if (!locked && started && !paused && match.state.phase === 'live' && !hud.menuVisible()) {
    paused = true;
    hud.showMenu('paused');
  }
}

document.getElementById('buy-deploy').addEventListener('click', () => match.deploy());
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- fixed-step phase machine --------------------------------------------------------------
function tickBuy(dt) {
  match.update(dt, simT);
  hud.refreshBuy({
    money: match.state.money,
    owned: arsenal.state.owned,
    armour: arsenal.state.armour,
    grenades: arsenal.state.grenades,
    timeLeft: match.state.phaseT,
  });
  arsenal.updateVisual(dt, simT, false);
  effects.update(dt, simT);
  if (input.consumePressed('Enter')) match.deploy();
}

function tickLive(dt) {
  drivePlayer(dt);
  syncPlayerHitbox();
  updateGrenades(dt);
  botCtx.t = simT;
  for (const b of bots) updateBot(b, dt, botCtx);
  match.update(dt, simT);
  effects.update(dt, simT);
}

function tickOver(dt) {
  updateGrenades(dt);
  match.update(dt, simT);
  effects.update(dt, simT);
}

function step(dt) {
  // The match can fire sounds (detonation included) from its first update,
  // and the audio graph must exist before any of them runs — a driver that
  // starts the match through __cinder never passes through the Play button,
  // which is the only other place the graph is brought up.
  if (!audioReady) { audio.ensure(); audioReady = true; }
  simT += dt;
  const phase = match.state.phase;
  if (phase === 'buy') tickBuy(dt);
  else if (phase === 'live') tickLive(dt);
  else if (phase === 'over') tickOver(dt);
  else effects.update(dt, simT);
  // The hit volumes live under bot/player groups whose transforms only reach
  // matrixWorld on render. A headless driver can call step() many times
  // without a render in between, so refresh the matrices here — otherwise
  // the dispatcher's raycasts test meshes at their last rendered position.
  scene.updateMatrixWorld();
  drainEvents();
  syncPlayerHitbox();
  if (phase === 'buy' || phase === 'live' || phase === 'over') {
    updateCamera(dt);
    syncHud();
  }
}

// --- debug / deterministic-test handle ------------------------------------------------------
window.__cinder = {
  step,
  get simT() { return simT; },
  get phase() { return match.state.phase; },
  match, player, input, arsenal, bots, hud, world, effects, audio, camera, scene,
  // Point the operator's view at a world point (drives the real look path).
  aimAt(x, y, z) {
    player.eyePos(_eye);
    _dir.set(x - _eye.x, y - _eye.y, z - _eye.z).normalize();
    const wantYaw = Math.atan2(-_dir.x, -_dir.z);
    const wantPitch = Math.asin(THREE.MathUtils.clamp(_dir.y, -1, 1));
    player.forward(_fwd);
    const curYaw = Math.atan2(-_fwd.x, -_fwd.z);
    const curPitch = Math.asin(THREE.MathUtils.clamp(_fwd.y, -1, 1));
    player.look((curYaw - wantYaw) / 0.0021, (curPitch - wantPitch) / 0.0021);
    syncLook();
  },
  // Move the operator (no collision check — a test harness convenience).
  teleport(x, z, yaw) {
    player.pos.set(x, 0, z);
    if (yaw !== undefined) {
      player.forward(_fwd);
      const curYaw = Math.atan2(-_fwd.x, -_fwd.z);
      player.look((curYaw - yaw) / 0.0021, 0);
      syncLook();
    }
    syncPlayerHitbox();
  },
};

if (shotMode) {
  stageShot(shotMode);
} else {
  hud.showMenu('start');
  let last = performance.now();
  let acc = 0;
  renderer.setAnimationLoop(() => {
    const nowMs = performance.now();
    const frame = Math.min(0.1, (nowMs - last) / 1000);
    last = nowMs;
    if (!paused && started) {
      acc += frame;
      while (acc >= FIXED) {
        step(FIXED);
        acc -= FIXED;
      }
    } else if (!started) {
      // Menu backdrop: a slow orbit over the foundry floor.
      simT += frame;
      const r = 24;
      camera.position.set(Math.sin(simT * 0.05) * r, 12, Math.cos(simT * 0.05) * r);
      camera.lookAt(-4, 1, -8);
      effects.update(frame, simT);
    }
    renderer.render(scene, camera);
  });
  setInterval(() => {
    if (started && match.state.phase === 'live' && !input.state.locked && !paused && !hud.menuVisible()) input.lock();
    if (!started && match.state.phase !== 'idle') started = true;
  }, 400);
}

// --- staged frames for screenshots ------------------------------------------------------
function stageBot(bot, x, z, yaw, crouch = false) {
  bot.pos.set(x, 0, z);
  bot.yaw = yaw;
  bot.crouching = crouch;
  bot.group.rotation.set(0, yaw, 0);
  bot.group.position.set(x, crouch ? -0.34 : 0, z);
}

function stageShot(mode) {
  // A believable mid-match state, built from the real pieces.
  hud.hideMenu();
  player.reset(SPAWN_ATTACK.clone(), 0);
  arsenal.give('rifle');
  arsenal.equip('rifle');
  arsenal.state.grenades = { frag: 1, flash: 1, smoke: 0 };
  player.armour = true;
  const [a0, a1, a2, a3, d0, d1, d2, d3, d4] = bots;
  for (const b of bots) { b.weaponId = 'rifle'; }
  if (mode === 'cover') {
    // South hall, looking north up the central aisle: furnace glow left,
    // casting bay right, both lanes open toward the sites.
    player.pos.set(9, 0, 16.5);
    player.yaw = 0.22;
    player.pitch = 0.01;
    stageBot(a0, -8, 8, 0.1);
    stageBot(a1, 4, 6, -0.1);
    stageBot(a2, -13, 12, 0.3);
    stageBot(a3, 15, 11, -2.7);
    stageBot(d0, -14, -4, 2.9);
    stageBot(d1, 3, -3, 3.0);
    stageBot(d2, -6, -8, 2.5, true);
    stageBot(d3, 14, -6, -2.8);
    stageBot(d4, 0, -14, 3.1);
    stageHud({ health: 100, timer: '1:12', scoreUs: 2, scoreThem: 1, round: 4, money: 2450, objective: 'PLANT THE CHARGE AT MELT SHOP OR CASTING BAY — OR CLEAR SLAG' });
    hud.killfeed('Rowan', 'Moss', false, true, false);
  } else if (mode === 'buy') {
    player.pos.set(0, 0, 18.5);
    player.yaw = 0;
    stageBot(a0, -4, 19.5, 0);
    stageBot(a1, 4, 19.5, 0);
    stageBot(a2, -1.5, 20, 0);
    stageBot(a3, 1.5, 20, 0);
    stageBot(d0, -16, -17, Math.PI);
    stageBot(d1, -6, -18, Math.PI);
    stageBot(d2, 6, -18, Math.PI);
    stageBot(d3, 16, -17, Math.PI);
    stageBot(d4, 0, -16, Math.PI);
    stageHud({ health: 100, timer: '0:09', scoreUs: 3, scoreThem: 2, round: 6, money: 3350, objective: 'BUY YOUR KIT — DEPLOY WHEN READY', buy: true });
  } else if (mode === 'play') {
    // West lane firefight in the open: the furnace glow behind the target, a
    // Slag anchor mid-burst ahead, the player having just dropped a defender.
    player.pos.set(-13, 0, 2);
    player.yaw = 0.25;
    player.pitch = 0.02;
    player.health = 62;
    stageBot(a0, -10, 0.5, 0.9);
    stageBot(a1, -3, 6, -0.4);
    stageBot(a2, 10, 6, 2.8);
    stageBot(a3, -12, 10, -0.2);
    stageBot(d0, -15, -6, -2.9);
    stageBot(d1, -13.5, -2.5, -1.8, true);
    stageBot(d2, 4, -6, 3.1);
    stageBot(d3, 12, -10, -2.8);
    stageBot(d4, 0, -14, 3.14);
    d1.alive = false;
    d1.group.rotation.x = -Math.PI / 2;
    d1.group.position.y = 0.25;
    hud.hitmarker(true);
    stageHud({ health: 62, timer: '0:47', scoreUs: 4, scoreThem: 3, round: 8, money: 1750, objective: 'PLANT THE CHARGE AT MELT SHOP OR CASTING BAY — OR CLEAR SLAG' });
    hud.killfeed('You', 'Ilya', true, true, false);
    hud.killfeed('Sable', 'Dara', false, true, false);
    // The Slag anchor by the furnace is mid-burst at the player: flash and tracer, frozen.
    const from = new THREE.Vector3(-15, 1.4, -6);
    const to = new THREE.Vector3(-13.2, 1.2, 1.2);
    effects.muzzle(from, 999);
    effects.tracer(from, to, 999);
    effects.impact(to, 999, 5);
  } else { // plant
    player.pos.set(15.5, 0, -8.5);
    player.yaw = -0.7;
    player.pitch = 0.01;
    player.health = 84;
    stageBot(a0, 13.5, -10, -0.9, true);
    stageBot(a1, 16, -4.5, -2.4);
    stageBot(a2, -5, 0, -0.3);
    stageBot(a3, 7, 7, 2.9);
    stageBot(d0, 17.5, -13.5, 2.2, true); // caught defusing at the charge
    stageBot(d1, 23, -5.5, -2.2);
    stageBot(d2, -12, -10, 2.6);
    stageBot(d3, 5, -9, 3.0);
    d4.alive = false;
    d4.pos.set(-2, 0, -3);
    d4.group.rotation.x = -Math.PI / 2;
    d4.group.position.y = 0.25;
    // The planted charge, as the match builds it.
    const chargeGroup = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.26, 0.32), new THREE.MeshStandardMaterial({ color: 0x39424a, roughness: 0.5, metalness: 0.5 }));
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshStandardMaterial({ color: 0xe5484d, emissive: 0xe5484d, emissiveIntensity: 2.6 }));
    lamp.position.y = 0.2;
    chargeGroup.add(body, lamp);
    chargeGroup.position.set(19, 0.14, -12);
    scene.add(chargeGroup);
    stageHud({ health: 84, timer: '0:23', scoreUs: 5, scoreThem: 4, round: 10, money: 2900, objective: 'DEFEND THE CHARGE — SITE B', planted: true });
    hud.banner('CHARGE PLANTED', 'Site B — 23 seconds to detonation', 999);
  }
  syncPlayerHitbox();
  updateCamera(1);
  renderer.render(scene, camera);
  renderer.render(scene, camera);
  window.__shotReady = true;
  renderer.setAnimationLoop(() => renderer.render(scene, camera));
}

function stageHud({ health, timer, scoreUs, scoreThem, round, money: m, objective, buy = false, planted = false }) {
  hud.update({
    health, armour: true, mag: 24, reserve: 90, weaponName: 'KESTREL AR',
    money: m, timerText: timer, phaseLabel: planted ? 'CHARGE LIVE' : buy ? 'BUY PHASE' : 'ROUND',
    scoreUs, scoreThem, roundNum: round, objective,
    grenades: { frag: 1, flash: 1, smoke: 0 }, timerUrgent: planted,
  });
  hud.setSpread(9);
  if (buy) {
    hud.setBuyOpen(true, {
      money: m,
      owned: { pistol: true, rifle: true },
      armour: false,
      grenades: { frag: 0, flash: 1, smoke: 0 },
      timeLeft: 9,
    });
  }
}
