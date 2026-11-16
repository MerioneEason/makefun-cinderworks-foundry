// Cinderworks Foundry: the operator. WASD + mouse look, crouch, jump, and
// axis-separated circle collision against the hall's AABB colliders.
import * as THREE from 'three';

const RADIUS = 0.38;
const EYE_STAND = 1.62;
const EYE_CROUCH = 1.12;
const WALK = 5.1;
const CROUCH_SPEED = 2.6;
const GRAVITY = 22;

export function createPlayer(colliders) {
  const pos = new THREE.Vector3(0, 0, 17.5);
  const state = {
    pos, yaw: 0, pitch: 0,
    health: 100, armour: false, alive: true,
    crouching: false, airborne: false, yVel: 0, yOff: 0,
    speed2d: 0, lastHurtAt: -99, lastStepAt: -99,
  };

  function moveAxis(dx, dz) {
    const nx = pos.x + dx;
    if (!collides(nx, pos.z)) pos.x = nx;
    const nz = pos.z + dz;
    if (!collides(pos.x, nz)) pos.z = nz;
  }

  function collides(x, z) {
    if (x < -27 + RADIUS || x > 27 - RADIUS || z < -21 + RADIUS || z > 21 - RADIUS) return true;
    for (const c of colliders) {
      if (c.top < 0.5) continue;
      const cx = Math.max(c.minX, Math.min(x, c.maxX));
      const cz = Math.max(c.minZ, Math.min(z, c.maxZ));
      const ddx = x - cx, ddz = z - cz;
      if (ddx * ddx + ddz * ddz < RADIUS * RADIUS) return true;
    }
    return false;
  }

  return {
    ...state,
    get height() { return state.crouching ? EYE_CROUCH : EYE_STAND; },
    get eye() { return state.crouching ? EYE_CROUCH : EYE_STAND; },
    reset(p, yaw) {
      pos.copy(p); state.yaw = yaw; state.pitch = 0;
      state.health = 100; state.alive = true;
      state.crouching = false; state.yOff = 0; state.yVel = 0; state.airborne = false;
      state.speed2d = 0;
    },
    eyePos(out) { return out.set(pos.x, pos.y + state.yOff + this.eye, pos.z); },
    forward(out) {
      return out.set(-Math.sin(state.yaw) * Math.cos(state.pitch), Math.sin(state.pitch), -Math.cos(state.yaw) * Math.cos(state.pitch));
    },
    look(dx, dy) {
      state.yaw -= dx * 0.0021;
      state.pitch = Math.max(-1.5, Math.min(1.5, state.pitch - dy * 0.0021));
    },
    recoil(pitchKick, yawKick) {
      state.pitch = Math.min(1.5, state.pitch + pitchKick);
      state.yaw += yawKick;
    },
    groundSpeed() { return state.speed2d; },
    update(dt, input) {
      const keys = input.state.keys;
      state.crouching = keys.has('ControlLeft') || keys.has('ControlRight');
      const speed = state.crouching ? CROUCH_SPEED : WALK;
      let fx = 0, fz = 0;
      if (keys.has('KeyW')) fz -= 1;
      if (keys.has('KeyS')) fz += 1;
      if (keys.has('KeyA')) fx -= 1;
      if (keys.has('KeyD')) fx += 1;
      const len = Math.hypot(fx, fz) || 1;
      fx /= len; fz /= len;
      const sin = Math.sin(state.yaw), cos = Math.cos(state.yaw);
      const wx = (fx * cos + fz * sin) * speed * dt;
      const wz = (-fx * sin + fz * cos) * speed * dt;
      moveAxis(wx, wz);
      state.speed2d = Math.hypot(wx, wz) / Math.max(dt, 1e-4);
      if (keys.has('Space') && !state.airborne) {
        state.yVel = 7.2; state.airborne = true;
      }
      if (state.airborne) {
        state.yVel -= GRAVITY * dt;
        state.yOff += state.yVel * dt;
        if (state.yOff <= 0) { state.yOff = 0; state.airborne = false; state.yVel = 0; }
      }
    },
  };
}
