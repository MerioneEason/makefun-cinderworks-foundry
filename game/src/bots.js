// Cinderworks Foundry: the five-a-side bots. Each has a role, a waypoint path,
// a vision cone with line-of-sight checks, and burst-fire discipline — no
// aimbot: they miss, they pause, and smoke genuinely blinds them.
import * as THREE from 'three';
import { WEAPONS } from './weapons.js';

export const EMBER_NAMES = ['Ash', 'Cinder', 'Flint', 'Rowan', 'Sable'];
export const SLAG_NAMES = ['Dara', 'Ilya', 'Moss', 'Nadia', 'Okafor'];

const BODY_MATS = {
  attack: new THREE.MeshStandardMaterial({ color: 0xb3541e, roughness: 0.7, metalness: 0.2 }),
  defend: new THREE.MeshStandardMaterial({ color: 0x2e6b7a, roughness: 0.7, metalness: 0.2 }),
};
const DARK = new THREE.MeshStandardMaterial({ color: 0x22262b, roughness: 0.8, metalness: 0.3 });
const SKIN = new THREE.MeshStandardMaterial({ color: 0xc9a184, roughness: 0.8 });
const VISOR = new THREE.MeshStandardMaterial({ color: 0xffc46a, emissive: 0xff8c1a, emissiveIntensity: 1.2 });

function bfsPath(start, goal, edges, count) {
  if (start === goal) return [goal];
  const prev = new Array(count).fill(-1);
  const queue = [start];
  prev[start] = start;
  while (queue.length) {
    const n = queue.shift();
    for (const [a, b] of edges) {
      const m = a === n ? b : b === n ? a : -1;
      if (m === -1 || prev[m] !== -1) continue;
      prev[m] = n;
      if (m === goal) {
        const path = [m];
        let cur = m;
        while (cur !== start) { cur = prev[cur]; path.unshift(cur); }
        return path;
      }
      queue.push(m);
    }
  }
  return [goal];
}

export function createBot(team, name, role, weaponId = 'rifle') {
  const group = new THREE.Group();
  const mat = BODY_MATS[team];

  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.78, 0.26), DARK);
  legs.position.y = 0.39;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.72, 0.32), mat);
  torso.position.y = 1.14;
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.36), DARK);
  vest.position.y = 1.2;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), SKIN);
  head.position.y = 1.66;
  const helm = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), mat);
  helm.position.y = 1.69;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.06), VISOR);
  visor.position.set(0, 1.66, 0.16);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.62), DARK);
  gun.position.set(0.2, 1.28, -0.3);
  group.add(legs, torso, vest, head, helm, visor, gun);
  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });

  // Invisible hit volumes, sized like the body parts.
  const hitMeshes = [];
  const bot = {
    team, name, role, weaponId,
    group, pos: new THREE.Vector3(0, 0, 0), yaw: 0,
    health: 100, armour: false, alive: true,
    speed: 4.3, crouching: false,
    path: [], pathIdx: 0, repathAt: 0,
    targetNode: -1, holdUntil: 0, scanAt: 0,
    seen: null, seenAt: -99, reactAt: 0,
    burstLeft: 0, burstAt: 0, nextShotAt: 0, pauseUntil: 0,
    defusing: false, defuseAt: 0,
    lastStepAt: -99, skill: 0.7 + Math.random() * 0.3,
    hitMeshes,
  };
  const defs = [
    [new THREE.SphereGeometry(0.19, 8, 6), 1.66, 'head'],
    [new THREE.BoxGeometry(0.6, 0.76, 0.36), 1.14, 'torso'],
    [new THREE.BoxGeometry(0.46, 0.8, 0.3), 0.4, 'leg'],
  ];
  for (const [geo, y, part] of defs) {
    const m = new THREE.Mesh(geo);
    m.position.y = y;
    m.visible = false;
    m.userData.combatant = bot;
    m.userData.part = part;
    group.add(m);
    hitMeshes.push(m);
  }
  bot.eyePos = (out) => out.set(bot.pos.x, bot.pos.y + (bot.crouching ? 1.25 : 1.6), bot.pos.z);
  bot.speedNow = () => bot._speed || 0;
  return bot;
}

// Where each role wants to be, given the match state.
function roleGoal(bot, ctx) {
  const w = ctx.world;
  const sites = { A: 15, B: 20 }; // waypoint nodes on the site row
  if (bot.team === 'defend') {
    if (ctx.planted && bot.role === 'defuser') return ctx.chargeNode;
    if (ctx.planted && bot.role === 'rotator') return ctx.chargeNode;
    if (bot.role === 'anchorA') return sites.A;
    if (bot.role === 'anchorB') return sites.B;
    if (bot.role === 'mid') return 12;
    if (bot.role === 'rotator') return Math.random() < 0.5 ? sites.A : sites.B;
    return sites.A;
  }
  // Attackers push their lane; the lurker works mid and the flank nodes.
  if (bot.role === 'pusherA') return ctx.planted ? 12 : sites.A;
  if (bot.role === 'pusherB') return ctx.planted ? 12 : sites.B;
  if (bot.role === 'lurker') return Math.random() < 0.5 ? 26 : 29;
  return 7; // support: mid-south, near the player spawn push
}

const tmpV = new THREE.Vector3();
const tmpEye = new THREE.Vector3();
const tmpDir = new THREE.Vector3();

export function updateBot(bot, dt, ctx) {
  if (!bot.alive) return;
  const { world, t } = ctx;
  bot._speed = 0;

  // --- perception: scan for a visible enemy on a 0.15 s cadence -----------------
  if (t >= bot.scanAt) {
    bot.scanAt = t + 0.15;
    bot.seen = null;
    let bestD = Infinity;
    bot.eyePos(tmpEye);
    for (const c of ctx.combatants) {
      if (!c.alive || c === bot || c.team === bot.team) continue;
      c.eyePos(tmpV);
      const d = tmpEye.distanceTo(tmpV);
      if (d > 40) continue;
      tmpDir.copy(tmpV).sub(tmpEye).normalize();
      const fwd = new THREE.Vector3(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
      if (tmpDir.dot(fwd) < 0.15 && d > 3) continue; // outside the vision cone
      const blocked = world.raycast(tmpEye, tmpDir, d, world.shootMeshes);
      if (blocked && blocked.distance < d - 0.4) continue;
      if (ctx.effects.smokeBlocks(tmpEye, tmpV, t)) continue;
      if (d < bestD) { bestD = d; bot.seen = c; }
    }
    if (bot.seen && t >= bot.reactAt) bot.reactAt = t + 0.25 + Math.random() * 0.3;
  }

  // --- defusing: the dedicated defuser works the charge --------------------------
  if (bot.team === 'defend' && ctx.planted && bot.role === 'defuser') {
    const d = bot.pos.distanceTo(ctx.chargePos);
    if (d < 1.6) {
      bot.defusing = true;
      bot.defuseAt = t;
      return; // stand still and work
    }
  }
  bot.defusing = false;

  // --- combat: face the target and fire in bursts --------------------------------
  if (bot.seen && t >= bot.reactAt) {
    bot.eyePos(tmpEye);
    bot.seen.eyePos(tmpV);
    tmpDir.copy(tmpV).sub(tmpEye);
    const dist = tmpDir.length();
    const wantYaw = Math.atan2(-tmpDir.x, -tmpDir.z);
    let dy = wantYaw - bot.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    bot.yaw += dy * Math.min(1, dt * 8);
    bot.group.rotation.y = bot.yaw;

    const w = WEAPONS[bot.weaponId];
    if (t >= bot.pauseUntil && t >= bot.nextShotAt) {
      if (bot.burstLeft <= 0) {
        bot.burstLeft = 3 + Math.floor(Math.random() * 3);
        bot.pauseUntil = t + 0.45 + Math.random() * 0.6;
      }
      // Accuracy: worse at range, worse against a moving target, better up close.
      const targetSpeed = bot.seen.speedNow ? bot.seen.speedNow() : 0;
      const err = (0.006 + dist * 0.0011 + targetSpeed * 0.0022) / bot.skill;
      tmpDir.normalize();
      tmpDir.x += (Math.random() - 0.5) * 2 * err;
      tmpDir.y += (Math.random() - 0.5) * 2 * err + (bot.seen.isPlayer ? 0.004 : 0);
      tmpDir.z += (Math.random() - 0.5) * 2 * err;
      tmpDir.normalize();
      tmpEye.y -= 0.08;
      ctx.shoot(bot, tmpEye.clone(), tmpDir.clone(), w);
      bot.burstLeft -= 1;
      bot.nextShotAt = t + w.fireMs / 1000 * 1.15;
      if (bot.burstLeft <= 0) bot.pauseUntil = t + 0.5 + Math.random() * 0.7;
    }
    // Strafe a little while engaging so they are not standing targets.
    if (Math.random() < dt * 0.8) {
      const strafe = (Math.random() - 0.5) * 2;
      const nx = bot.pos.x + Math.cos(bot.yaw) * strafe * dt * 2.2;
      const nz = bot.pos.z - Math.sin(bot.yaw) * strafe * dt * 2.2;
      if (!world.blocked(nx, nz, 0.38)) { bot.pos.x = nx; bot.pos.z = nz; }
    }
    bot.group.position.set(bot.pos.x, bot.crouching ? -0.34 : 0, bot.pos.z);
    return;
  }

  // --- movement: follow the waypoint path -----------------------------------------
  if (t >= bot.repathAt || bot.pathIdx >= bot.path.length) {
    bot.repathAt = t + 1.4;
    const goal = roleGoal(bot, ctx);
    const start = world.nearestNode(bot.pos);
    bot.path = bfsPath(start, goal, world.edges, world.waypoints.length);
    bot.pathIdx = 0;
    // Anchors hold their corner and watch the lane.
    if ((bot.role === 'anchorA' || bot.role === 'anchorB') && !ctx.planted) {
      bot.holdUntil = t + 2.5 + Math.random() * 2;
    }
  }
  if (t < bot.holdUntil) {
    const watch = bot.role === 'anchorA' ? 12 : bot.role === 'anchorB' ? 13 : 12;
    const wp = world.waypoints[watch];
    const wantYaw = Math.atan2(-(wp.x - bot.pos.x), -(wp.z - bot.pos.z));
    bot.yaw += (wantYaw - bot.yaw) * Math.min(1, dt * 4);
    bot.group.rotation.y = bot.yaw;
    bot.group.position.set(bot.pos.x, 0, bot.pos.z);
    return;
  }
  const node = bot.path[bot.pathIdx];
  if (node === undefined) return;
  const wp = world.waypoints[node];
  const dx = wp.x - bot.pos.x;
  const dz = wp.z - bot.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.7) { bot.pathIdx += 1; return; }
  const step = bot.speed * dt;
  const mx = (dx / dist) * step;
  const mz = (dz / dist) * step;
  const nx = bot.pos.x + mx;
  const nz = bot.pos.z + mz;
  if (!world.blocked(nx, bot.pos.z, 0.38)) bot.pos.x = nx;
  if (!world.blocked(bot.pos.x, nz, 0.38)) bot.pos.z = nz;
  bot._speed = bot.speed;
  const wantYaw = Math.atan2(-dx, -dz);
  let dy = wantYaw - bot.yaw;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  bot.yaw += dy * Math.min(1, dt * 6);
  bot.group.rotation.y = bot.yaw;
  bot.group.position.set(bot.pos.x, bot.crouching ? -0.34 : 0, bot.pos.z);
}
