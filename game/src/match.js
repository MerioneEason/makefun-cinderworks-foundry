// Cinderworks Foundry: the match. Buy phase, live round, plant and defuse,
// first to 7. Money follows the genre's shape: kills pay, plants pay more,
// wins pay best, and a losing streak pays a little extra each round.
import * as THREE from 'three';
import { WEAPONS, GRENADES, ARMOUR_PRICE } from './weapons.js';
import { SITES, SPAWN_ATTACK, SPAWN_DEFEND } from './world.js';

const BUY_SECONDS = 12;
const ROUND_SECONDS = 100;
const OVER_SECONDS = 4;
const PLANT_SECONDS = 3.2;
const DEFUSE_SECONDS = 5;
const CHARGE_SECONDS = 35;
const WIN_ROUNDS = 7;

const PRICES = {
  smg: 1500, shotgun: 1900, rifle: 2700, marksman: 4200,
  armour: ARMOUR_PRICE, frag: 300, flash: 200, smoke: 300,
};

export function createMatch(deps) {
  const { world, player, arsenal, bots, hud, audio, effects, scene, input } = deps;
  const state = {
    phase: 'idle', // idle | buy | live | over | matchover
    phaseT: 0, round: 1,
    score: { attack: 0, defend: 0 },
    money: 800, lossStreak: 0,
    planted: null, // {site, pos, tLeft}
    plantProgress: 0, defuseProgress: 0,
    planterSite: null,
    winner: null,
  };

  // The planted charge, built once and re-used.
  const chargeGroup = new THREE.Group();
  const chargeBody = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.26, 0.32),
    new THREE.MeshStandardMaterial({ color: 0x39424a, roughness: 0.5, metalness: 0.5 }));
  const chargeLamp = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xe5484d, emissive: 0xe5484d, emissiveIntensity: 2.6 }));
  chargeLamp.position.y = 0.2;
  chargeGroup.add(chargeBody, chargeLamp);
  chargeGroup.visible = false;
  scene.add(chargeGroup);

  function aliveOf(team) {
    let n = player.alive && team === 'attack' ? 1 : 0;
    for (const b of bots) if (b.alive && b.team === team) n += 1;
    return n;
  }

  function spawnAll() {
    player.reset(SPAWN_ATTACK.clone(), Math.PI); // face north, toward the hall
    const atkSpots = [[-4, 17.5], [-1.5, 18.5], [1.5, 18.5], [4, 17.5]];
    const defSpots = [[-16, -17], [-6, -18], [6, -18], [16, -17], [0, -16]];
    let ai = 0, di = 0;
    for (const b of bots) {
      b.health = 100; b.alive = true; b.armour = false;
      b.defusing = false; b.seen = null; b.path = []; b.pathIdx = 0;
      b.group.visible = true;
      b.group.rotation.set(0, 0, 0);
      b.group.position.y = 0;
      if (b.team === 'attack') {
        const [x, z] = atkSpots[ai++ % atkSpots.length];
        b.pos.set(x, 0, z); b.yaw = Math.PI;
      } else {
        const [x, z] = defSpots[di++ % defSpots.length];
        b.pos.set(x, 0, z); b.yaw = 0;
      }
      b.group.position.set(b.pos.x, 0, b.pos.z);
      b.group.rotation.y = b.yaw;
    }
    player.armour = arsenal.state.armour;
    arsenal.resetRound();
  }

  function startRound() {
    spawnAll();
    state.planted = null;
    state.plantProgress = 0;
    state.defuseProgress = 0;
    state.planterSite = null;
    chargeGroup.visible = false;
    state.phase = 'buy';
    state.phaseT = BUY_SECONDS;
    hud.setBuyOpen(true, buyState());
    audio.buyOpen();
  }

  function buyState() {
    return {
      money: state.money,
      owned: arsenal.state.owned,
      armour: arsenal.state.armour,
      grenades: arsenal.state.grenades,
      timeLeft: state.phaseT,
    };
  }

  function buy(id) {
    if (state.phase !== 'buy') return;
    if (id === 'armour') {
      if (arsenal.state.armour || state.money < ARMOUR_PRICE) return;
      state.money -= ARMOUR_PRICE;
      arsenal.state.armour = true;
      player.armour = true;
      return;
    }
    if (GRENADES[id]) {
      if (state.money < GRENADES[id].price || arsenal.state.grenades[id] >= 2) return;
      state.money -= GRENADES[id].price;
      arsenal.state.grenades[id] += 1;
      return;
    }
    const w = WEAPONS[id];
    if (!w || arsenal.state.owned[id] || state.money < w.price) return;
    state.money -= w.price;
    arsenal.give(id);
    arsenal.equip(id);
  }

  function deploy() {
    if (state.phase !== 'buy') return;
    state.phase = 'live';
    state.phaseT = ROUND_SECONDS;
    hud.setBuyOpen(false);
    input.lock();
  }

  function rewardKill(who) {
    if (who === 'player') state.money += 300;
  }

  function endRound(winner, reason) {
    if (state.phase === 'over') return;
    state.phase = 'over';
    state.phaseT = OVER_SECONDS;
    if (winner === 'attack') {
      state.score.attack += 1;
      state.money += 3250;
      state.lossStreak = 0;
    } else {
      state.score.defend += 1;
      state.lossStreak += 1;
      state.money += 1900 + Math.min(1500, (state.lossStreak - 1) * 500);
    }
    if (state.planted) { state.planted = null; chargeGroup.visible = false; }
    if (winner === 'attack') audio.roundWin(); else audio.roundLose();
    hud.banner(winner === 'attack' ? 'ROUND TO EMBER' : 'ROUND TO SLAG', reason, 3.2);
    if (state.score.attack >= WIN_ROUNDS || state.score.defend >= WIN_ROUNDS) {
      state.winner = state.score.attack >= WIN_ROUNDS ? 'attack' : 'defend';
    }
  }

  function plantSiteNearPlayer() {
    for (const key of ['A', 'B']) {
      const s = SITES[key];
      if (player.pos.distanceTo(s.pos) < s.r) return key;
    }
    return null;
  }

  function update(dt, t) {
    if (state.phase === 'idle' || state.phase === 'matchover') return;
    state.phaseT -= dt;

    if (state.phase === 'buy') {
      if (state.phaseT <= 0) deploy();
      return;
    }
    if (state.phase === 'over') {
      if (state.phaseT <= 0) {
        if (state.winner) {
          state.phase = 'matchover';
          hud.showMenu('end', state.winner === 'attack');
        } else {
          state.round += 1;
          startRound();
        }
      }
      return;
    }

    // --- live ---------------------------------------------------------------------
    // Planting: hold E inside a site while alive and unplanted.
    const near = plantSiteNearPlayer();
    state.planterSite = state.planted ? null : near;
    if (!state.planted && near && player.alive && input.state.keys.has('KeyE')) {
      state.plantProgress += dt / PLANT_SECONDS;
      if (Math.floor(t * 2) !== Math.floor((t - dt) * 2)) audio.beep(false);
      if (state.plantProgress >= 1) {
        state.planted = { site: near, pos: SITES[near].pos.clone(), tLeft: CHARGE_SECONDS };
        state.plantProgress = 0;
        state.money += 300;
        chargeGroup.position.copy(SITES[near].pos).setY(0.14);
        chargeGroup.visible = true;
        audio.plantDone();
        hud.banner('CHARGE PLANTED', `Site ${near} — ${CHARGE_SECONDS} seconds to detonation`, 3);
      }
    } else {
      state.plantProgress = Math.max(0, state.plantProgress - dt * 2);
    }

    // Defusing: a defender bot standing on the charge works it down.
    if (state.planted) {
      const defuser = bots.find((b) => b.alive && b.team === 'defend' && b.defusing);
      if (defuser) {
        state.defuseProgress += dt / DEFUSE_SECONDS;
        if (Math.floor(t * 2) !== Math.floor((t - dt) * 2)) audio.beep(false);
        if (state.defuseProgress >= 1) {
          state.planted = null;
          chargeGroup.visible = false;
          endRound('defend', 'The charge was defused');
          return;
        }
      } else {
        state.defuseProgress = Math.max(0, state.defuseProgress - dt * 1.5);
      }
      state.planted.tLeft -= dt;
      if (Math.floor(state.planted.tLeft) !== Math.floor(state.planted.tLeft + dt)) audio.beep(state.planted.tLeft < 6);
      if (state.planted.tLeft <= 0) {
        const p = state.planted.pos;
        deps.blastDamage(p, 12, 500);
        effects.explode(p, t);
        audio.explode(player.pos.distanceTo(p));
        endRound('attack', 'The charge detonated');
        return;
      }
    }

    // Elimination wins.
    if (aliveOf('defend') === 0 && state.planted) {
      endRound('attack', 'Slag wiped out — the charge still goes off');
      return;
    }
    if (aliveOf('defend') === 0) { endRound('attack', 'Slag wiped out'); return; }
    if (aliveOf('attack') === 0) {
      if (state.planted) { /* defenders must still defuse or die */ }
      else { endRound('defend', 'Ember wiped out'); return; }
    }
    // If the whole attack team is dead and the charge is live, defenders win
    // only by defusing; if the timer runs out the charge still wins the round.
    if (state.phaseT <= 0 && !state.planted) {
      endRound('defend', 'Time expired — the charge was never planted');
    }
  }

  return {
    state,
    buy, deploy, rewardKill, update,
    start() {
      state.round = 1;
      state.score = { attack: 0, defend: 0 };
      state.money = 800;
      state.lossStreak = 0;
      state.winner = null;
      arsenal.state.owned = { pistol: true };
      arsenal.state.armour = false;
      arsenal.state.grenades = { frag: 0, flash: 0, smoke: 0 };
      arsenal.equip('pistol');
      startRound();
    },
    hudState() {
      return {
        phase: state.phase,
        phaseT: Math.max(0, state.phaseT),
        round: state.round,
        score: state.score,
        money: state.money,
        planted: state.planted,
        plantProgress: state.plantProgress,
        defuseProgress: state.defuseProgress,
        planterSite: state.planterSite,
      };
    },
  };
}
