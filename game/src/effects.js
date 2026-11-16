// Cinderworks Foundry: tracers, muzzle flashes, impacts, smoke and blasts.
// Everything is pooled and recycled; smoke clouds are also vision blockers.
import * as THREE from 'three';

export function createEffects(scene) {
  // --- tracers: a pool of fading lines -----------------------------------------
  const tracerMat = new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.9 });
  const tracers = [];
  for (let i = 0; i < 24; i += 1) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, tracerMat.clone());
    line.visible = false; line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, until: 0 });
  }
  let tracerIdx = 0;

  // --- muzzle flash: a sprite + a brief point light ------------------------------
  const flashMat = new THREE.SpriteMaterial({ color: 0xffc46a, transparent: true, opacity: 0, depthWrite: false });
  const flashSprite = new THREE.Sprite(flashMat);
  flashSprite.scale.setScalar(0.9);
  scene.add(flashSprite);
  const flashLight = new THREE.PointLight(0xffb347, 0, 9, 2);
  scene.add(flashLight);
  let flashUntil = 0;

  // --- impact sparks: small point clouds -----------------------------------------
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(30 * 3), 3));
  const sparkMat = new THREE.PointsMaterial({ color: 0xffd27a, size: 0.09, transparent: true, opacity: 0.95 });
  const sparks = new THREE.Points(sparkGeo, sparkMat);
  sparks.visible = false; sparks.frustumCulled = false;
  scene.add(sparks);
  let sparkUntil = 0;

  // --- smoke clouds ---------------------------------------------------------------
  const smokeMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, transparent: true, opacity: 0.42, roughness: 1, depthWrite: false });
  const smokes = []; // {mesh, until, pos}
  const smokeGeo = new THREE.SphereGeometry(1, 14, 10);

  // --- explosion flash --------------------------------------------------------------
  const boomMat = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0, depthWrite: false });
  const boom = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), boomMat);
  scene.add(boom);
  const boomLight = new THREE.PointLight(0xff8c1a, 0, 18, 1.6);
  scene.add(boomLight);
  let boomUntil = 0;

  const tmp = new THREE.Vector3();

  return {
    tracer(from, to, t) {
      const tr = tracers[tracerIdx];
      tracerIdx = (tracerIdx + 1) % tracers.length;
      const p = tr.line.geometry.attributes.position.array;
      p[0] = from.x; p[1] = from.y; p[2] = from.z;
      p[3] = to.x; p[4] = to.y; p[5] = to.z;
      tr.line.geometry.attributes.position.needsUpdate = true;
      tr.line.visible = true;
      tr.line.material.opacity = 0.85;
      tr.until = t + 0.07;
    },
    muzzle(pos, t) {
      flashSprite.position.copy(pos);
      flashSprite.material.opacity = 0.95;
      flashLight.position.copy(pos);
      flashLight.intensity = 26;
      flashUntil = t + 0.05;
    },
    impact(point, t, count = 4) {
      const arr = sparkGeo.attributes.position.array;
      for (let i = 0; i < 30; i += 1) {
        const j = i * 3;
        if (i < count) {
          arr[j] = point.x + (Math.random() - 0.5) * 0.3;
          arr[j + 1] = point.y + (Math.random() - 0.5) * 0.3;
          arr[j + 2] = point.z + (Math.random() - 0.5) * 0.3;
        } else { arr[j] = point.x; arr[j + 1] = point.y - 99; arr[j + 2] = point.z; }
      }
      sparkGeo.attributes.position.needsUpdate = true;
      sparks.visible = true;
      sparkUntil = t + 0.25;
    },
    smoke(pos, t, life) {
      const mesh = new THREE.Mesh(smokeGeo, smokeMat.clone());
      mesh.position.copy(pos).setY(Math.max(1.1, pos.y));
      mesh.scale.setScalar(0.4);
      scene.add(mesh);
      smokes.push({ mesh, until: t + life, born: t, pos: mesh.position.clone() });
    },
    // Live smoke spheres, for bot vision blocking.
    smokeBlockers(t) {
      return smokes.filter((s) => t < s.until);
    },
    // True when the segment a->b passes through any live smoke sphere.
    smokeBlocks(a, b, t) {
      for (const s of smokes) {
        if (t >= s.until) continue;
        const r = 3.6;
        tmp.copy(b).sub(a);
        const lenSq = tmp.lengthSq();
        if (lenSq === 0) continue;
        const u = Math.max(0, Math.min(1, s.pos.clone().sub(a).dot(tmp) / lenSq));
        const closest = tmp.clone().multiplyScalar(u).add(a);
        if (closest.distanceTo(s.pos) < r) return true;
      }
      return false;
    },
    explode(pos, t) {
      boom.position.copy(pos);
      boom.scale.setScalar(0.5);
      boomMat.opacity = 0.9;
      boomLight.position.copy(pos);
      boomLight.intensity = 80;
      boomUntil = t + 0.35;
    },
    update(dt, t) {
      for (const tr of tracers) {
        if (tr.line.visible && t > tr.until) tr.line.visible = false;
      }
      if (t > flashUntil) {
        flashSprite.material.opacity = 0;
        flashLight.intensity = 0;
      }
      if (sparks.visible && t > sparkUntil) sparks.visible = false;
      if (t < boomUntil) {
        const k = (boomUntil - t) / 0.35;
        boom.scale.setScalar(0.5 + (1 - k) * 5.5);
        boomMat.opacity = 0.9 * k;
        boomLight.intensity = 80 * k;
      } else {
        boomMat.opacity = 0;
        boomLight.intensity = 0;
      }
      for (let i = smokes.length - 1; i >= 0; i -= 1) {
        const s = smokes[i];
        if (t >= s.until) {
          scene.remove(s.mesh);
          smokes.splice(i, 1);
          continue;
        }
        const age = t - s.born;
        const grow = Math.min(1, age / 1.2);
        s.mesh.scale.setScalar(0.4 + grow * 3.4);
        s.mesh.material.opacity = 0.42 * Math.min(1, (s.until - t) / 2);
      }
    },
  };
}

// Camera shake helper shared by the main loop.
export function cameraQuatHolder() {
  return { current: new THREE.Quaternion() };
}
