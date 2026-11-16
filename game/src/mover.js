// One axis-aligned mover shared by the player and every bot. An agent is a box
// (radius around its feet, height to its crown); the mover accelerates it toward a
// wish direction, applies gravity, and slides it along walls one axis at a time, so
// a wall never swallows an agent and corners never snag. No allocations in step:
// the probe box and the wish vector are reused.
import * as THREE from 'three';

const GRAVITY = 20;
const JUMP_SPEED = 6.2;
const GROUND_ACCEL = 42;
const AIR_ACCEL = 9;
const FRICTION = 9;

export function createMover(colliders) {
  const probe = new THREE.Box3();
  const wish = new THREE.Vector3();

  function overlaps(x, y, z, radius, height, lift) {
    probe.min.set(x - radius, y + lift, z - radius);
    probe.max.set(x + radius, y + height - lift, z + radius);
    for (let i = 0; i < colliders.length; i += 1) {
      if (probe.intersectsBox(colliders[i])) return colliders[i];
    }
    return null;
  }

  // agent: { pos, vel, yaw, height, radius, eye, onGround, crouching }
  // wishDir: unit xz vector (or zero), speed: m/s, jump: boolean, dt: seconds.
  function step(agent, dt, wishDir, speed, jump) {
    const accel = agent.onGround ? GROUND_ACCEL : AIR_ACCEL;
    const blend = Math.min(1, (accel * dt) / speed);
    wish.copy(wishDir);
    agent.vel.x += (wish.x * speed - agent.vel.x) * blend;
    agent.vel.z += (wish.z * speed - agent.vel.z) * blend;
    if (agent.onGround && wish.lengthSq() === 0) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      agent.vel.x *= damp;
      agent.vel.z *= damp;
    }
    if (jump && agent.onGround) {
      agent.vel.y = JUMP_SPEED;
      agent.onGround = false;
    }
    agent.vel.y -= GRAVITY * dt;

    const nextX = agent.pos.x + agent.vel.x * dt;
    if (!overlaps(nextX, agent.pos.y, agent.pos.z, agent.radius, agent.height, 0.04)) {
      agent.pos.x = nextX;
    } else {
      agent.vel.x = 0;
    }
    const nextZ = agent.pos.z + agent.vel.z * dt;
    if (!overlaps(agent.pos.x, agent.pos.y, nextZ, agent.radius, agent.height, 0.04)) {
      agent.pos.z = nextZ;
    } else {
      agent.vel.z = 0;
    }

    agent.pos.y += agent.vel.y * dt;
    agent.onGround = false;
    const hit = overlaps(agent.pos.x, agent.pos.y, agent.pos.z, agent.radius, agent.height, 0);
    if (hit && agent.vel.y <= 0) {
      agent.pos.y = hit.max.y;
      agent.vel.y = 0;
      agent.onGround = true;
    } else if (hit) {
      agent.pos.y = hit.min.y - agent.height;
      agent.vel.y = 0;
    }
    if (agent.pos.y < 0) {
      agent.pos.y = 0;
      agent.vel.y = 0;
      agent.onGround = true;
    }
    agent.vel.y = Math.max(-30, agent.vel.y);
  }

  function clearAbove(agent, height) {
    return !overlaps(agent.pos.x, agent.pos.y, agent.pos.z, agent.radius, height, 0.02);
  }

  return { step, clearAbove, overlaps };
}
