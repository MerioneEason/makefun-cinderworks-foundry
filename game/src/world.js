// Cinderworks Foundry: the night steelworks. One flat hall, two charge sites,
// a central aisle, and enough steel in the way to make every angle a decision.
// All geometry and textures are generated here in code — no external assets.
import * as THREE from 'three';

// --- procedural textures -------------------------------------------------------
function canvasTexture(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function floorTexture() {
  return canvasTexture(256, (g, s) => {
    g.fillStyle = '#23262b'; g.fillRect(0, 0, s, s);
    g.strokeStyle = '#2e3238'; g.lineWidth = 2;
    for (let i = 0; i <= 4; i += 1) {
      g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, s); g.stroke();
      g.beginPath(); g.moveTo(0, i * 64); g.lineTo(s, i * 64); g.stroke();
    }
    g.fillStyle = '#1b1e22';
    for (let y = 0; y < 4; y += 1) for (let x = 0; x < 4; x += 1) {
      if ((x + y) % 2 === 0) g.fillRect(x * 64 + 4, y * 64 + 4, 56, 56);
    }
    g.fillStyle = '#3a3f46';
    for (let i = 0; i < 40; i += 1) g.fillRect((i * 53) % s, (i * 91) % s, 3, 3);
  });
}

function hazardTexture() {
  return canvasTexture(128, (g, s) => {
    g.fillStyle = '#c98a1b'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#191b1e';
    for (let i = -2; i < 6; i += 1) {
      g.beginPath();
      g.moveTo(i * 32, s); g.lineTo(i * 32 + 32, 0); g.lineTo(i * 32 + 48, 0); g.lineTo(i * 32 + 16, s);
      g.fill();
    }
  });
}

function wallTexture() {
  return canvasTexture(256, (g, s) => {
    g.fillStyle = '#2a2e33'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#24282d';
    for (let y = 0; y < 4; y += 1) g.fillRect(0, y * 64, s, 30);
    g.fillStyle = '#33383f';
    for (let y = 0; y < 4; y += 1) for (let x = 0; x < 8; x += 1) g.fillRect(x * 32 + 4, y * 64 + 6, 24, 18);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(0, s - 26, s, 26);
  });
}

// --- materials ------------------------------------------------------------------
const M = {
  floor: new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.85, metalness: 0.35 }),
  wall: new THREE.MeshStandardMaterial({ map: wallTexture(), roughness: 0.9, metalness: 0.3 }),
  steel: new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.45, metalness: 0.85 }),
  darkSteel: new THREE.MeshStandardMaterial({ color: 0x2c3036, roughness: 0.6, metalness: 0.7 }),
  rust: new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.95, metalness: 0.25 }),
  hazard: new THREE.MeshStandardMaterial({ map: hazardTexture(), roughness: 0.8, metalness: 0.2 }),
  furnace: new THREE.MeshStandardMaterial({ color: 0x3d3a38, roughness: 0.55, metalness: 0.8 }),
  molten: new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0xff5a00, emissiveIntensity: 3.2, roughness: 0.3 }),
  glowHot: new THREE.MeshStandardMaterial({ color: 0xffb347, emissive: 0xff8c1a, emissiveIntensity: 2.4, roughness: 0.4 }),
  ingot: new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.35, metalness: 0.95 }),
  crate: new THREE.MeshStandardMaterial({ color: 0x5d4a2e, roughness: 0.9, metalness: 0.15 }),
  blue: new THREE.MeshStandardMaterial({ color: 0x2e4a5c, roughness: 0.6, metalness: 0.5 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x1a2a33, roughness: 0.15, metalness: 0.9 }),
  lamp: new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffc06a, emissiveIntensity: 2.0 }),
};

// --- the hall --------------------------------------------------------------------
export const HALL = { x0: -27, x1: 27, z0: -21, z1: 21 };
export const SITES = {
  A: { name: 'MELT SHOP', pos: new THREE.Vector3(-19, 0, -12), r: 4.2 },
  B: { name: 'CASTING BAY', pos: new THREE.Vector3(19, 0, -12), r: 4.2 },
};
export const SPAWN_ATTACK = new THREE.Vector3(0, 0, 17.5);
export const SPAWN_DEFEND = new THREE.Vector3(0, 0, -17.5);

// Waypoint graph: nodes placed in open floor, edges where a straight walk is clear.
export const WAYPOINTS = [
  [-22, 16], [-11, 17], [0, 17.5], [11, 17], [22, 16],       // 0-4 south hall
  [-22, 7], [-11, 8], [0, 8], [11, 8], [22, 7],               // 5-9 mid-south
  [-22, -2], [-11, -1], [0, 0], [11, -1], [22, -2],           // 10-14 mid
  [-22, -12], [-13, -12], [-5, -12], [5, -12], [13, -12], [22, -12], // 15-20 site row
  [-22, -18], [-11, -18], [0, -18], [11, -18], [22, -18],     // 21-25 north hall
  [-16, 2], [16, 2], [-16, -7], [16, -7],                     // 26-29 flanks
];
const EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [1, 6], [2, 7], [3, 8], [4, 9],
  [5, 6], [6, 7], [7, 8], [8, 9], [5, 10], [6, 11], [7, 12], [8, 13], [9, 14],
  [10, 11], [11, 12], [12, 13], [13, 14], [10, 15], [11, 16], [12, 17], [13, 18], [14, 19],
  [15, 16], [16, 17], [17, 18], [18, 19], [19, 20], [15, 21], [16, 22], [17, 22], [18, 23],
  [19, 24], [21, 22], [22, 23], [23, 24], [24, 25], [10, 26], [14, 27],
  [26, 28], [27, 29], [28, 15], [29, 20], [26, 11], [27, 13], [28, 16], [29, 18],
];

export function createWorld(scene) {
  const colliders = [];   // {minX,maxX,minZ,maxZ,top}
  const shootMeshes = []; // meshes bullets and sight can hit
  const solid = new THREE.Group();
  scene.add(solid);

  function box(x, z, w, d, h, y0, mat, collide = true) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y0 + h / 2, z);
    m.castShadow = true; m.receiveShadow = true;
    solid.add(m); shootMeshes.push(m);
    if (collide) colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, top: y0 + h });
    return m;
  }
  function cyl(x, z, r, h, y0, mat, seg = 18, collide = true) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat);
    m.position.set(x, y0 + h / 2, z);
    m.castShadow = true; m.receiveShadow = true;
    solid.add(m); shootMeshes.push(m);
    if (collide) colliders.push({ minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r, top: y0 + h });
    return m;
  }

  // Floor and roof
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(54, 42), M.floor);
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
  floor.material.map.repeat.set(9, 7);
  solid.add(floor);
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(54, 42), new THREE.MeshStandardMaterial({ color: 0x16181c, roughness: 1 }));
  roof.rotation.x = Math.PI / 2; roof.position.y = 9;
  solid.add(roof);

  // Perimeter walls (thick, with a hazard skirt)
  box(0, -21.4, 55.6, 0.8, 9, 0, M.wall);
  box(0, 21.4, 55.6, 0.8, 9, 0, M.wall);
  box(-27.4, 0, 0.8, 43.6, 9, 0, M.wall);
  box(27.4, 0, 0.8, 43.6, 9, 0, M.wall);
  box(0, -21, 55, 0.3, 0.5, 0, M.hazard);
  box(0, 21, 55, 0.3, 0.5, 0, M.hazard);

  // --- Site A: Melt Shop (west) — the big furnace -------------------------------
  const furnace = cyl(-21.5, -13.5, 3.4, 5.4, 0, M.furnace, 24);
  furnace.castShadow = true;
  const mouth = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.9, 0.5, 18), M.molten);
  mouth.position.set(-19.2, 1.1, -11.2); mouth.rotation.z = Math.PI / 2.4;
  solid.add(mouth); shootMeshes.push(mouth);
  const stack = cyl(-21.5, -13.5, 1.1, 9, 5.4, M.darkSteel, 12, false);
  stack.position.y = 9;
  // Molten channel running from the furnace toward mid
  const channel = box(-15.5, -11.5, 6.5, 0.9, 0.5, 0, M.darkSteel);
  channel.material = M.darkSteel;
  const pour = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.12, 0.55), M.molten);
  pour.position.set(-15.5, 0.52, -11.5); solid.add(pour);
  // Crucible and slag bins around A
  cyl(-24.5, -7.5, 1.2, 1.6, 0, M.rust, 14);
  box(-24.8, -16.5, 2.2, 1.6, 1.4, 0, M.crate);
  box(-16.5, -17.5, 3.0, 1.2, 1.1, 0, M.steel);
  // Site A floor ring
  const ringA = new THREE.Mesh(new THREE.RingGeometry(3.6, 4.2, 40), M.hazard);
  ringA.rotation.x = -Math.PI / 2; ringA.position.set(-19, 0.02, -12);
  solid.add(ringA);

  // --- Site B: Casting Bay (east) — ladle crane and moulds ----------------------
  const ladle = cyl(21.5, -13.5, 2.6, 3.2, 0, M.steel, 20);
  const ladleTop = new THREE.Mesh(new THREE.CylinderGeometry(2.9, 2.6, 0.5, 20), M.darkSteel);
  ladleTop.position.set(21.5, 3.4, -13.5); solid.add(ladleTop); shootMeshes.push(ladleTop);
  box(16.5, -16.5, 3.4, 1.4, 1.3, 0, M.ingot);           // ingot stack
  box(16.5, -16.5, 3.0, 1.0, 0.9, 1.3, M.ingot);
  box(24.5, -8, 1.8, 2.4, 1.5, 0, M.crate);
  box(15.5, -8.5, 2.6, 1.2, 1.0, 0, M.blue);
  const ringB = new THREE.Mesh(new THREE.RingGeometry(3.6, 4.2, 40), M.hazard);
  ringB.rotation.x = -Math.PI / 2; ringB.position.set(19, 0.02, -12);
  solid.add(ringB);
  // Mould row — low blocks that read as cover, not walls
  box(19, -6.5, 4.5, 1.0, 0.9, 0, M.darkSteel);
  box(23, -15.5, 1.2, 3.0, 1.1, 0, M.rust);

  // --- Mid: the central aisle -----------------------------------------------------
  // Ingot stacks that split the aisle into three lanes
  box(-6, 2.5, 4.2, 1.6, 1.5, 0, M.ingot);
  box(-6, 2.5, 3.6, 1.2, 1.1, 1.5, M.ingot);
  box(6, -2.5, 4.2, 1.6, 1.5, 0, M.ingot);
  box(6, -2.5, 3.6, 1.2, 1.1, 1.5, M.ingot);
  // Slag pit (open, glowing) — visual, ringed by a low wall you can shoot over
  const pit = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 0.3, 20), M.molten);
  pit.position.set(0, 0.12, 5.5); solid.add(pit);
  const pitWall = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.18, 8, 24), M.darkSteel);
  pitWall.rotation.x = Math.PI / 2; pitWall.position.set(0, 0.3, 5.5); solid.add(pitWall);
  shootMeshes.push(pitWall);
  // Billet racks south and north
  box(-13, 12, 5, 1.4, 1.2, 0, M.steel);
  box(13, 12, 5, 1.4, 1.2, 0, M.steel);
  box(-13, -6, 1.4, 5, 1.3, 0, M.rust);
  box(13, -6, 1.4, 5, 1.3, 0, M.rust);
  // Control room (north, glass front) and billet store (south)
  box(-8, -19.5, 8, 1.2, 3.4, 0, M.blue);
  const glass = box(0, -19.5, 6, 0.2, 2.2, 0.9, M.glass);
  glass.castShadow = false;
  box(8, -19.5, 8, 1.2, 3.4, 0, M.blue);
  box(-9, 19.5, 10, 1.4, 2.6, 0, M.crate);
  box(9, 19.5, 10, 1.4, 2.6, 0, M.crate);
  // Pillars down the hall
  for (const [px, pz] of [[-16, 8], [16, 8], [-16, -2], [16, -2], [-16, -17], [16, -17]]) {
    box(px, pz, 1.1, 1.1, 8.6, 0, M.darkSteel);
  }
  // Overhead gantry crane — visual only, high above the fight
  const crane = new THREE.Group();
  const beam = new THREE.Mesh(new THREE.BoxGeometry(46, 0.9, 1.4), M.steel);
  beam.position.y = 7.6; crane.add(beam);
  const trolley = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.2, 1.8), M.darkSteel);
  trolley.position.set(4, 6.9, 0); crane.add(trolley);
  const hook = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.4, 8), M.darkSteel);
  hook.position.set(4, 4.6, 0); crane.add(hook);
  const hookBlock = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.5), M.rust);
  hookBlock.position.set(4, 2.7, 0); crane.add(hookBlock);
  crane.position.z = -4;
  solid.add(crane);
  // Catwalk along the east wall
  box(25.2, -4, 1.6, 22, 0.25, 5.4, M.darkSteel, false);
  box(24.5, -4, 0.15, 22, 1.0, 5.6, M.steel, false);
  // Hanging lamps
  for (const [lx, lz] of [[-12, 10], [12, 10], [-12, -8], [12, -8], [0, 16], [0, -16]]) {
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.5, 12, 1, true), M.darkSteel);
    shade.position.set(lx, 6.4, lz); solid.add(shade);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), M.lamp);
    bulb.position.set(lx, 6.15, lz); solid.add(bulb);
    const pl = new THREE.PointLight(0xffc06a, 18, 16, 1.8);
    pl.position.set(lx, 6.0, lz); scene.add(pl);
  }

  // --- light ----------------------------------------------------------------------
  scene.background = new THREE.Color(0x0d0f12);
  scene.fog = new THREE.Fog(0x0d0f12, 26, 62);
  const hemi = new THREE.HemisphereLight(0x2a3644, 0x1a120c, 0.9);
  scene.add(hemi);
  const moon = new THREE.DirectionalLight(0x8fa8c8, 1.1);
  moon.position.set(14, 26, 8);
  moon.castShadow = true;
  moon.shadow.mapSize.set(1024, 1024);
  moon.shadow.camera.left = -30; moon.shadow.camera.right = 30;
  moon.shadow.camera.top = 30; moon.shadow.camera.bottom = -30;
  moon.shadow.camera.far = 70;
  scene.add(moon);
  const furnaceGlow = new THREE.PointLight(0xff6a00, 60, 22, 1.7);
  furnaceGlow.position.set(-19, 2.2, -11.5);
  scene.add(furnaceGlow);
  const pitGlow = new THREE.PointLight(0xff7a1a, 26, 14, 1.8);
  pitGlow.position.set(0, 1.4, 5.5);
  scene.add(pitGlow);
  const bayGlow = new THREE.PointLight(0xff9a3c, 20, 13, 1.8);
  bayGlow.position.set(19, 2.4, -12);
  scene.add(bayGlow);

  // --- raycast ----------------------------------------------------------------------
  const ray = new THREE.Raycaster();
  function raycast(origin, dir, maxDist, objects) {
    ray.set(origin, dir);
    ray.far = maxDist;
    const hits = ray.intersectObjects(objects, false);
    return hits.length ? hits[0] : null;
  }

  return {
    colliders, shootMeshes, raycast,
    waypoints: WAYPOINTS.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    edges: EDGES,
    // Circle-vs-AABB test used by players and bots.
    blocked(x, z, r) {
      if (x < HALL.x0 + r || x > HALL.x1 - r || z < HALL.z0 + r || z > HALL.z1 - r) return true;
      for (const c of colliders) {
        if (c.top < 0.5) continue;
        const nx = Math.max(c.minX, Math.min(x, c.maxX));
        const nz = Math.max(c.minZ, Math.min(z, c.maxZ));
        const dx = x - nx, dz = z - nz;
        if (dx * dx + dz * dz < r * r) return true;
      }
      return false;
    },
    // Nearest waypoint index to a point.
    nearestNode(p) {
      let best = 0, bd = Infinity;
      for (let i = 0; i < WAYPOINTS.length; i += 1) {
        const dx = WAYPOINTS[i][0] - p.x, dz = WAYPOINTS[i][1] - p.z;
        const d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    },
  };
}
