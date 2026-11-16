// Emberline Yard: a dusk freight yard, 44 x 40 m, built only from boxes. Two bomb
// sites (A west, B east), three lanes (A-long, mid doors, B-long), and cover that
// breaks every sightline into a fight worth taking. Every box is a collider for
// movement and a surface a bullet stops on. The waypoint graph at the end is what
// the bots walk: nodes at spawns, lane junctions, site entries and hold spots.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// [width, height, depth, x, y, z, material]
const BOXES = [
  // Ground and perimeter: floor, then walls 4.6 m high.
  [44.4, 0.4, 40.4, 0, -0.2, 0, 'ground'],
  [0.4, 4.6, 40.4, -22.2, 2.3, 0, 'wall'],
  [0.4, 4.6, 40.4, 22.2, 2.3, 0, 'wall'],
  [44.4, 4.6, 0.4, 0, 2.3, -20.2, 'wall'],
  [44.4, 4.6, 0.4, 0, 2.3, 20.2, 'wall'],
  // Mid wall at z = 0: two leaves and a pillar, leaving two 3.4 m doors.
  [16, 3.4, 0.6, -14, 1.7, 0, 'wall'],
  [16, 3.4, 0.6, 14, 1.7, 0, 'wall'],
  [1.2, 3.4, 1.4, 0, 1.7, 0, 'dark'],
  // Site A (west): raised pad, container, crates, sandbags.
  [8, 0.5, 6, -15, 0.25, -13, 'sand'],
  [6, 2.4, 2.4, -17.5, 1.2, -15.5, 'container'],
  [2.4, 2.4, 2.4, -11.5, 1.2, -16.5, 'containerB'],
  [1.2, 1.2, 1.2, -12.5, 0.6, -11, 'crate'],
  [1.2, 1.2, 1.2, -13.7, 0.6, -11, 'crate'],
  [1.2, 1.2, 1.2, -13.1, 1.8, -11, 'crate'],
  [3.2, 1.1, 0.6, -16.5, 0.55, -9.5, 'dark'],
  // Site B (east): stacked containers, crates, sandbags.
  [8, 0.5, 6, 15, 0.25, -13, 'sand'],
  [6, 2.4, 2.4, 17.5, 1.2, -15.5, 'containerB'],
  [2.4, 2.4, 2.4, 11.5, 1.2, -16.5, 'container'],
  [2.4, 2.4, 2.4, 11.5, 3.6, -16.5, 'containerB'],
  [1.2, 1.2, 1.2, 12.5, 0.6, -11, 'crate'],
  [1.2, 1.2, 1.2, 13.7, 0.6, -11, 'crate'],
  [3.2, 1.1, 0.6, 16.5, 0.55, -9.5, 'dark'],
  // A-long (west corridor): corner block and a low wall to peek over.
  [1.6, 2.6, 1.6, -19.5, 1.3, 6, 'dark'],
  [3.4, 1.1, 0.8, -19.5, 0.55, -3, 'dark'],
  [1.2, 1.2, 1.2, -18, 0.6, -8, 'crate'],
  // B-long (east corridor): container wall and crates.
  [1.6, 2.6, 1.6, 19.5, 1.3, 6, 'dark'],
  [2.4, 2.4, 2.4, 19, 1.2, -3, 'container'],
  [1.2, 1.2, 1.2, 18, 0.6, -8, 'crate'],
  // Mid: watchtower legs and platform, a container, sandbags on both sides.
  [0.5, 3.2, 0.5, -7.5, 1.6, 4.5, 'dark'],
  [0.5, 3.2, 0.5, -4.5, 1.6, 4.5, 'dark'],
  [0.5, 3.2, 0.5, -7.5, 1.6, 7.5, 'dark'],
  [0.5, 3.2, 0.5, -4.5, 1.6, 7.5, 'dark'],
  [3.6, 0.3, 3.6, -6, 3.35, 6, 'dark'],
  [6, 2.4, 2.4, 8, 1.2, 5, 'container'],
  [3.2, 1.1, 0.6, -8, 0.55, -4, 'dark'],
  [3.2, 1.1, 0.6, 8, 0.55, -4, 'dark'],
  // South (attacker) half: crates and a pipe run to break the open ground.
  [1.2, 1.2, 1.2, -6, 0.6, 12, 'crate'],
  [1.2, 1.2, 1.2, -4.8, 0.6, 12, 'crate'],
  [1.2, 1.2, 1.2, 6, 0.6, 12, 'crate'],
  [1.2, 1.2, 1.2, 7.2, 0.6, 12, 'crate'],
  [1.2, 1.2, 1.2, 6.6, 1.8, 12, 'crate'],
  [0.6, 0.6, 12, -21, 0.3, 10, 'dark'],
  [0.6, 0.6, 12, 21, 0.3, 10, 'dark'],
  // North (defender) half: low walls guarding the site approaches.
  [3.4, 1.1, 0.8, -6, 0.55, -10, 'dark'],
  [3.4, 1.1, 0.8, 6, 0.55, -10, 'dark'],
];

// Waypoint graph: id -> [x, z]. Edges are listed as pairs of ids.
const NODES = {
  atkSpawn: [0, 16],
  atkMid: [0, 10],
  atkALong: [-19, 12],
  atkALongMid: [-19, 0],
  atkAEntry: [-15, -8],
  atkBLong: [19, 12],
  atkBLongMid: [19, 0],
  atkBEntry: [15, -8],
  midWest: [-2, 0],
  midEast: [2, 0],
  midNorth: [0, -8],
  siteA: [-15, -13],
  siteA2: [-11, -10],
  siteB: [15, -13],
  siteB2: [11, -10],
  defSpawn: [0, -16],
  defAHold: [-12, -9],
  defBHold: [12, -9],
  defMidHold: [0, -6],
  westLow: [-10, 6],
  eastLow: [10, 6],
  westHigh: [-10, -4],
  eastHigh: [10, -4],
};
const EDGES = [
  ['atkSpawn', 'atkMid'], ['atkSpawn', 'atkALong'], ['atkSpawn', 'atkBLong'],
  ['atkMid', 'westLow'], ['atkMid', 'eastLow'], ['atkMid', 'midWest'], ['atkMid', 'midEast'],
  ['atkALong', 'atkALongMid'], ['atkALongMid', 'westLow'], ['atkALongMid', 'atkAEntry'],
  ['atkBLong', 'atkBLongMid'], ['atkBLongMid', 'eastLow'], ['atkBLongMid', 'atkBEntry'],
  ['westLow', 'westHigh'], ['eastLow', 'eastHigh'],
  ['westHigh', 'atkAEntry'], ['eastHigh', 'atkBEntry'],
  ['midWest', 'midNorth'], ['midEast', 'midNorth'],
  ['midNorth', 'defMidHold'], ['midNorth', 'westHigh'], ['midNorth', 'eastHigh'],
  ['atkAEntry', 'siteA'], ['atkAEntry', 'siteA2'], ['siteA', 'siteA2'], ['siteA2', 'defAHold'],
  ['atkBEntry', 'siteB'], ['atkBEntry', 'siteB2'], ['siteB', 'siteB2'], ['siteB2', 'defBHold'],
  ['defAHold', 'defSpawn'], ['defBHold', 'defSpawn'], ['defMidHold', 'defSpawn'],
  ['defAHold', 'westHigh'], ['defBHold', 'eastHigh'],
];

export const SITES = {
  A: { center: new THREE.Vector3(-15, 0.5, -13), radius: 4.2 },
  B: { center: new THREE.Vector3(15, 0.5, -13), radius: 4.2 },
};

export const SPAWNS = {
  atk: [
    new THREE.Vector3(-3, 0, 16), new THREE.Vector3(-1, 0, 17),
    new THREE.Vector3(1, 0, 17), new THREE.Vector3(3, 0, 16),
  ],
  def: [
    new THREE.Vector3(-3, 0, -16), new THREE.Vector3(-1, 0, -17),
    new THREE.Vector3(1, 0, -17), new THREE.Vector3(3, 0, -16),
  ],
};

export function buildMap(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'amber' ? 0.5 : 0.92,
      metalness: name === 'container' || name === 'containerB' ? 0.25 : 0.03,
    });
  }

  const colliders = [];
  const shootables = [];
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  for (const [w, h, d, x, y, z, material] of BOXES) {
    const mesh = new THREE.Mesh(unitBox, materials[material]);
    mesh.scale.set(w, h, d);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
  }

  // Bomb-site plates: emissive floor markers so a site reads at a glance.
  const plates = [];
  for (const [key, color] of [['A', 'accent'], ['B', 'amber']]) {
    const plate = new THREE.Mesh(
      new THREE.CircleGeometry(SITES[key].radius * 0.55, 24),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE[color]), transparent: true, opacity: 0.28 }),
    );
    plate.rotation.x = -Math.PI / 2;
    plate.position.copy(SITES[key].center).setY(0.52);
    group.add(plate);
    plates.push(plate);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.4, 8), materials.dark);
    pole.position.set(SITES[key].center.x + 3.4, 1.7, SITES[key].center.z - 2.4);
    pole.castShadow = true;
    group.add(pole);
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 10, 8),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE[color]) }),
    );
    lamp.position.set(SITES[key].center.x + 3.4, 3.5, SITES[key].center.z - 2.4);
    group.add(lamp);
    const light = new THREE.PointLight(new THREE.Color(PALETTE[color]), 14, 12);
    light.position.copy(lamp.position);
    group.add(light);
  }

  // Skyline silhouettes beyond the walls, so the yard does not end in fog alone.
  const skyline = new THREE.Group();
  const silhouette = new THREE.MeshStandardMaterial({ color: new THREE.Color('#141a29'), roughness: 1 });
  for (const [x, z, w, h] of [
    [-30, -28, 10, 9], [-14, -30, 8, 13], [4, -29, 12, 7], [20, -28, 9, 11],
    [-28, 26, 9, 8], [26, 24, 10, 10], [10, 30, 8, 6],
  ]) {
    const block = new THREE.Mesh(unitBox, silhouette);
    block.scale.set(w, h, 2);
    block.position.set(x, h / 2, z);
    skyline.add(block);
  }
  scene.add(skyline);

  // Light: a low amber sun from the west, a cool indigo fill, and the dusk sky.
  const sky = new THREE.HemisphereLight(new THREE.Color('#5a6b9e'), new THREE.Color('#3a2c20'), 0.9);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffb36b'), 2.4);
  sun.position.set(-26, 12, 6);
  sun.target.position.set(4, 0, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -26;
  sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 26;
  sun.shadow.camera.bottom = -26;
  sun.shadow.camera.far = 70;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#7d8fc9'), 0.5);
  fill.position.set(14, 10, 14);
  scene.add(fill);

  const nodes = new Map();
  for (const [id, [x, z]] of Object.entries(NODES)) {
    nodes.set(id, { id, pos: new THREE.Vector3(x, 0, z), links: [] });
  }
  for (const [a, b] of EDGES) {
    nodes.get(a).links.push(b);
    nodes.get(b).links.push(a);
  }

  return { colliders, shootables, group, plates, nodes, sites: SITES, spawns: SPAWNS };
}

// Breadth-first route through the waypoint graph, returned as node ids.
export function findRoute(nodes, fromId, toId) {
  if (fromId === toId) return [toId];
  const came = new Map([[fromId, null]]);
  const queue = [fromId];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const next of nodes.get(current).links) {
      if (came.has(next)) continue;
      came.set(next, current);
      if (next === toId) {
        const path = [toId];
        let step = current;
        while (step !== null) {
          path.unshift(step);
          step = came.get(step);
        }
        return path;
      }
      queue.push(next);
    }
  }
  return [toId];
}

export function nearestNode(nodes, position) {
  let best = null;
  let bestDistance = Infinity;
  for (const node of nodes.values()) {
    const d = (node.pos.x - position.x) ** 2 + (node.pos.z - position.z) ** 2;
    if (d < bestDistance) {
      bestDistance = d;
      best = node;
    }
  }
  return best;
}
