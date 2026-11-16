// Cinderworks Foundry: the armoury. Five guns, three grenades, one economy.
// Damage is per-hit before range falloff; armour halves body damage.
import * as THREE from 'three';
export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 WASP', price: 0, kind: 'pistol', auto: false,
    damage: 34, headMult: 3.4, range: 42, mag: 12, reserve: 48,
    fireMs: 170, reloadMs: 1500, spread: 0.011, moveSpread: 0.030,
    kick: 0.011, adsFov: 58, pellets: 1, tracer: 0xffe9a8,
  },
  smg: {
    id: 'smg', name: 'RASP-9 SMG', price: 1500, kind: 'smg', auto: true,
    damage: 26, headMult: 3.0, range: 34, mag: 28, reserve: 112,
    fireMs: 92, reloadMs: 1900, spread: 0.017, moveSpread: 0.042,
    kick: 0.008, adsFov: 56, pellets: 1, tracer: 0xffd27a,
  },
  shotgun: {
    id: 'shotgun', name: 'MAUL-12', price: 1900, kind: 'shotgun', auto: false,
    damage: 17, headMult: 2.2, range: 16, mag: 6, reserve: 30,
    fireMs: 780, reloadMs: 2600, spread: 0.052, moveSpread: 0.075,
    kick: 0.05, adsFov: 60, pellets: 8, tracer: 0xffc46a,
  },
  rifle: {
    id: 'rifle', name: 'KESTREL AR', price: 2700, kind: 'rifle', auto: true,
    damage: 33, headMult: 3.6, range: 60, mag: 25, reserve: 100,
    fireMs: 118, reloadMs: 2100, spread: 0.013, moveSpread: 0.038,
    kick: 0.014, adsFov: 52, pellets: 1, tracer: 0xffe9a8,
  },
  marksman: {
    id: 'marksman', name: 'ANVIL DMR', price: 4200, kind: 'marksman', auto: false,
    damage: 78, headMult: 3.2, range: 90, mag: 8, reserve: 32,
    fireMs: 620, reloadMs: 2600, spread: 0.004, moveSpread: 0.028,
    kick: 0.038, adsFov: 30, pellets: 1, tracer: 0xfff2c8,
  },
};

export const GRENADES = {
  frag: { id: 'frag', name: 'FRAG', price: 300, radius: 7, damage: 110 },
  flash: { id: 'flash', name: 'FLASH', price: 200, radius: 16 },
  smoke: { id: 'smoke', name: 'SMOKE', price: 300, radius: 4.5, life: 14 },
};

export const ARMOUR_PRICE = 1000;
export const ARMOUR_FACTOR = 0.5; // body hits through armour deal half

export function damageFor(weapon, part, target) {
  let dmg = weapon.damage;
  if (part === 'head') dmg *= weapon.headMult;
  else if (part === 'leg') dmg *= 0.75;
  if (part !== 'head' && target.armour) dmg *= ARMOUR_FACTOR;
  return dmg;
}

export function createArsenal(camera) {
  const state = {
    owned: { pistol: true },
    current: 'pistol',
    mag: WEAPONS.pistol.mag,
    reserve: WEAPONS.pistol.reserve,
    armour: false,
    grenades: { frag: 0, flash: 0, smoke: 0 },
    reloading: false,
    reloadEnd: 0,
    nextShot: 0,
  };

  // A simple view model: dark gun body + barrel, bobbing with movement.
  const gun = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x22262b, roughness: 0.4, metalness: 0.8 });
  const gripMat = new THREE.MeshStandardMaterial({ color: 0x4a3220, roughness: 0.85, metalness: 0.1 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.5), bodyMat);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 8), bodyMat);
  barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.02, -0.38);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.1), gripMat);
  grip.position.set(0, -0.14, 0.12); grip.rotation.x = 0.25;
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.06), bodyMat);
  sight.position.set(0, 0.09, -0.05);
  gun.add(body, barrel, grip, sight);
  gun.position.set(0.26, -0.24, -0.6);
  camera.add(gun);

  let bobT = 0;
  let kickBack = 0;

  function currentWeapon() { return WEAPONS[state.current]; }

  return {
    state,
    currentWeapon,
    give(id) {
      state.owned[id] = true;
      if (state.current === id) { state.mag = WEAPONS[id].mag; state.reserve = WEAPONS[id].reserve; }
    },
    equip(id) {
      if (!state.owned[id]) return;
      state.current = id;
      state.mag = WEAPONS[id].mag;
      state.reserve = WEAPONS[id].reserve;
      state.reloading = false;
      const scale = id === 'marksman' ? 1.35 : id === 'shotgun' ? 1.2 : id === 'rifle' ? 1.05 : 0.9;
      gun.scale.setScalar(scale);
    },
    resetRound() {
      state.mag = currentWeapon().mag;
      state.reserve = currentWeapon().reserve;
      state.reloading = false;
    },
    ammoText() { return { mag: state.mag, reserve: state.reserve }; },
    spread(speed, crouching, aiming) {
      const w = currentWeapon();
      let s = w.spread + (speed > 0.5 ? w.moveSpread * Math.min(1, speed / 5) : 0);
      if (crouching) s *= 0.7;
      if (aiming) s *= 0.45;
      return s;
    },
    ready(t) { return t >= state.nextShot && !state.reloading && state.mag > 0; },
    needsReload() { return state.mag === 0 && state.reserve > 0 && !state.reloading; },
    fire(t, audio) {
      const w = currentWeapon();
      if (!this.ready(t)) return false;
      state.mag -= 1;
      state.nextShot = t + w.fireMs / 1000;
      kickBack = 1;
      if (audio) audio.shot(w.kind, 0);
      return true;
    },
    startReload(t, audio) {
      const w = currentWeapon();
      if (state.reloading || state.mag === w.mag || state.reserve <= 0) return;
      state.reloading = true;
      state.reloadEnd = t + w.reloadMs / 1000;
      if (audio) audio.reload();
    },
    finishReloads(t) {
      if (!state.reloading || t < state.reloadEnd) return;
      const w = currentWeapon();
      const need = w.mag - state.mag;
      const take = Math.min(need, state.reserve);
      state.mag += take;
      state.reserve -= take;
      state.reloading = false;
    },
    updateVisual(dt, t, moving) {
      bobT += dt * (moving ? 9 : 2);
      const bob = moving ? 0.012 : 0.003;
      kickBack = Math.max(0, kickBack - dt * 6);
      gun.position.y = -0.24 + Math.sin(bobT) * bob - kickBack * 0.03;
      gun.position.x = 0.26 + Math.cos(bobT * 0.5) * bob * 0.6;
      gun.position.z = -0.6 + kickBack * 0.09;
    },
  };
}
