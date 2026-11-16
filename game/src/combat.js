// Combat: hitscan shots, damage, tracers, impact sparks and frag grenades. One
// ray decides a shot: the first thing it meets is either a wall (sparks) or an
// agent (damage, head shots paying more). Tracers and sparks come from fixed pools
// reused every shot, so a firefight allocates nothing. Grenades are real
// projectiles with gravity, bounces and a fuse.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { sfx } from './audio.js';

const TRACER_COUNT = 10;
const SPARK_COUNT = 96;
const GRENADE_RADIUS = 7;
const GRENADE_MAX_DAMAGE = 120;

export function createCombat(scene, world, player) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 140;
  const direction = new THREE.Vector3();
  const muzzle = new THREE.Vector3();
  const hitPoint = new THREE.Vector3();

  // Tracer pool: ten reusable lines, each with a short life.
  const tracers = [];
  const tracerMaterial = new THREE.LineBasicMaterial({
    color: new THREE.Color(PALETTE.amber), transparent: true, opacity: 0.85,
  });
  for (let i = 0; i < TRACER_COUNT; i += 1) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geometry, tracerMaterial.clone());
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerIndex = 0;

  // Spark pool: one Points cloud, slots recycled as impacts happen.
  const sparkGeometry = new THREE.BufferGeometry();
  const sparkPositions = new Float32Array(SPARK_COUNT * 3);
  sparkGeometry.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
  const sparks = new THREE.Points(sparkGeometry, new THREE.PointsMaterial({
    color: new THREE.Color(PALETTE.amber), size: 0.09, transparent: true, opacity: 0.95,
  }));
  sparks.frustumCulled = false;
  scene.add(sparks);
  const sparkVel = new Float32Array(SPARK_COUNT * 3);
  const sparkLife = new Float32Array(SPARK_COUNT);
  let sparkIndex = 0;

  const grenades = [];
  const grenadeMeshes = [];
  const grenadeGeometry = new THREE.SphereGeometry(0.09, 10, 8);
  const grenadeMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.dark), roughness: 0.5, metalness: 0.5 });
  const grenadeBox = new THREE.Box3();
  const probe = new THREE.Vector3();

  function spawnSparks(point, count, speed) {
    for (let n = 0; n < count; n += 1) {
      const i = sparkIndex;
      sparkIndex = (sparkIndex + 1) % SPARK_COUNT;
      sparkPositions[i * 3] = point.x;
      sparkPositions[i * 3 + 1] = point.y;
      sparkPositions[i * 3 + 2] = point.z;
      sparkVel[i * 3] = (Math.random() * 2 - 1) * speed;
      sparkVel[i * 3 + 1] = Math.random() * speed * 0.8;
      sparkVel[i * 3 + 2] = (Math.random() * 2 - 1) * speed;
      sparkLife[i] = 0.3 + Math.random() * 0.25;
    }
    sparkGeometry.attributes.position.needsUpdate = true;
  }

  function showTracer(from, to) {
    const tracer = tracers[tracerIndex];
    tracerIndex = (tracerIndex + 1) % TRACER_COUNT;
    const positions = tracer.line.geometry.attributes.position.array;
    positions[0] = from.x; positions[1] = from.y; positions[2] = from.z;
    positions[3] = to.x; positions[4] = to.y; positions[5] = to.z;
    tracer.line.geometry.attributes.position.needsUpdate = true;
    tracer.line.visible = true;
    tracer.life = 0.07;
  }

  function eyeOf(agent) {
    return new THREE.Vector3(agent.pos.x, agent.pos.y + agent.eye, agent.pos.z);
  }

  // Shoots one round from an agent along aimDir (a unit vector). Returns what the
  // bullet did: { hit: 'agent'|'world'|null, victim, part, killed, point }.
  function fire(shooter, aimDir, spread, random, hitMeshes) {
    const def = shooter.weapon.def;
    direction.copy(aimDir);
    direction.x += (random() * 2 - 1) * spread;
    direction.y += (random() * 2 - 1) * spread;
    direction.z += (random() * 2 - 1) * spread;
    direction.normalize();
    const origin = eyeOf(shooter);
    raycaster.set(origin, direction);
    const hits = raycaster.intersectObjects(world.shootables.concat(hitMeshes), false);
    const hit = hits[0];
    muzzle.copy(origin).addScaledVector(direction, 0.6);
    if (!hit) {
      hitPoint.copy(origin).addScaledVector(direction, def.range);
      showTracer(muzzle, hitPoint);
      return { hit: null, point: hitPoint };
    }
    hitPoint.copy(hit.point);
    showTracer(muzzle, hitPoint);
    const agentMesh = hit.object.userData.agent;
    if (agentMesh && agentMesh.alive && agentMesh !== shooter) {
      const distance = hit.distance;
      const falloff = 1 - Math.min(0.4, (distance / def.range) * 0.4);
      const part = hit.object.userData.part;
      const amount = Math.round(def.damage * (part === 'head' ? def.headMult : 1) * falloff);
      const killed = damageAgent(agentMesh, amount, shooter);
      return { hit: 'agent', victim: agentMesh, part, killed, amount, point: hitPoint };
    }
    spawnSparks(hitPoint, 8, 2.4);
    return { hit: 'world', point: hitPoint };
  }

  function damageAgent(agent, amount, attacker) {
    if (!agent.alive) return false;
    agent.health -= amount;
    agent.lastAttacker = attacker;
    agent.flashTime = 0.12;
    if (agent.health <= 0) {
      agent.health = 0;
      agent.alive = false;
      agent.fall = 0;
      return true;
    }
    return false;
  }

  function throwGrenade(agent, aimDir) {
    if (agent.grenades <= 0) return false;
    agent.grenades -= 1;
    const mesh = new THREE.Mesh(grenadeGeometry, grenadeMaterial);
    mesh.position.copy(eyeOf(agent)).addScaledVector(aimDir, 0.5);
    scene.add(mesh);
    grenadeMeshes.push(mesh);
    grenades.push({
      mesh,
      pos: mesh.position,
      vel: aimDir.clone().multiplyScalar(16).add(new THREE.Vector3(0, 4.5, 0)),
      fuse: 2.2,
      owner: agent,
    });
    sfx.grenadePin();
    return true;
  }

  function explodeGrenade(index, agents, onKill) {
    const grenade = grenades[index];
    const point = grenade.pos;
    spawnSparks(point, 40, 7);
    sfx.explosion();
    const distanceToPlayer = point.distanceTo(eyeOf(player));
    if (distanceToPlayer < 14) player.shake = Math.min(1, (14 - distanceToPlayer) / 10);
    for (const agent of agents) {
      if (!agent.alive) continue;
      const d = point.distanceTo(new THREE.Vector3(agent.pos.x, agent.pos.y + 1, agent.pos.z));
      if (d > GRENADE_RADIUS) continue;
      const amount = Math.max(15, Math.round(GRENADE_MAX_DAMAGE * (1 - d / GRENADE_RADIUS)));
      if (damageAgent(agent, amount, grenade.owner)) onKill(agent, grenade.owner);
    }
    scene.remove(grenade.mesh);
    grenades.splice(index, 1);
    grenadeMeshes.splice(index, 1);
  }

  function stepGrenades(dt, agents, onKill) {
    for (let i = grenades.length - 1; i >= 0; i -= 1) {
      const grenade = grenades[i];
      grenade.vel.y -= 12 * dt;
      grenade.pos.addScaledVector(grenade.vel, dt);
      // Bounce off the world: test each axis and reflect the component that hit.
      grenadeBox.min.set(grenade.pos.x - 0.09, grenade.pos.y - 0.09, grenade.pos.z - 0.09);
      grenadeBox.max.set(grenade.pos.x + 0.09, grenade.pos.y + 0.09, grenade.pos.z + 0.09);
      for (const collider of world.colliders) {
        if (!grenadeBox.intersectsBox(collider)) continue;
        probe.copy(grenade.pos);
        const dx = Math.min(Math.abs(probe.x - collider.min.x), Math.abs(probe.x - collider.max.x));
        const dz = Math.min(Math.abs(probe.z - collider.min.z), Math.abs(probe.z - collider.max.z));
        const dy = Math.min(Math.abs(probe.y - collider.min.y), Math.abs(probe.y - collider.max.y));
        if (dy <= dx && dy <= dz) {
          grenade.pos.y = grenade.vel.y > 0 ? collider.min.y - 0.09 : collider.max.y + 0.09;
          grenade.vel.y *= -0.45;
        } else if (dx <= dz) {
          grenade.pos.x = grenade.vel.x > 0 ? collider.min.x - 0.09 : collider.max.x + 0.09;
          grenade.vel.x *= -0.45;
        } else {
          grenade.pos.z = grenade.vel.z > 0 ? collider.min.z - 0.09 : collider.max.z + 0.09;
          grenade.vel.z *= -0.45;
        }
        grenade.vel.multiplyScalar(0.7);
      }
      if (grenade.pos.y < 0.09) {
        grenade.pos.y = 0.09;
        grenade.vel.y *= -0.45;
      }
      grenade.fuse -= dt;
      if (grenade.fuse <= 0) explodeGrenade(i, agents, onKill);
    }
  }

  function step(dt, agents, onKill) {
    for (const tracer of tracers) {
      if (tracer.life <= 0) continue;
      tracer.life -= dt;
      if (tracer.life <= 0) tracer.line.visible = false;
    }
    for (let i = 0; i < SPARK_COUNT; i += 1) {
      if (sparkLife[i] <= 0) continue;
      sparkLife[i] -= dt;
      sparkPositions[i * 3] += sparkVel[i * 3] * dt;
      sparkPositions[i * 3 + 1] += sparkVel[i * 3 + 1] * dt;
      sparkPositions[i * 3 + 2] += sparkVel[i * 3 + 2] * dt;
      sparkVel[i * 3 + 1] -= 9 * dt;
    }
    sparkGeometry.attributes.position.needsUpdate = true;
    stepGrenades(dt, agents, onKill);
  }

  return { fire, damageAgent, throwGrenade, step, eyeOf, spawnSparks };
}
