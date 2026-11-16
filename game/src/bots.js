// Bots: the other eight agents. Each bot is a box-built soldier with a head and a
// torso a bullet can tell apart, a route through the waypoint graph, and a small
// state machine: route to its objective, hold a position, engage what it sees,
// investigate what it hears, plant the spike or defuse it. Vision is a raycast
// (walls really block sight), hearing is a radius around a gunshot, and shooting
// is bursts with a reaction delay and an error that grows with distance and with
// how fast the target is moving, so a still, aiming player wins the duel.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { WEAPON_DEFS } from './weapons.js';
import { findRoute, nearestNode } from './map.js';
import { pick, range } from './rng.js';

const BOT_NAMES = {
  atk: ['Rook', 'Fang', 'Dune'],
  def: ['Vex', 'Sable', 'Hawk', 'Ibis'],
};
const BOT_HEALTH = 100;
const WALK_SPEED = 4.2;
const ENGAGE_SPEED = 2.6;
const VISION_RANGE = 42;
const HEAR_RADIUS = 26;

export function createBots(scene, map, mover, random) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = VISION_RANGE + 5;
  const toTarget = new THREE.Vector3();
  const eyePos = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const wish = new THREE.Vector3();
  const bots = [];
  const hitMeshes = [];

  function buildMesh(team) {
    const group = new THREE.Group();
    const cloth = new THREE.MeshStandardMaterial({
      color: new THREE.Color(team === 'atk' ? '#5a6b7d' : '#6b5a3a'), roughness: 0.85,
    });
    const skin = new THREE.MeshStandardMaterial({ color: new THREE.Color('#c9a06a'), roughness: 0.7 });
    const visor = new THREE.MeshStandardMaterial({
      color: new THREE.Color(team === 'atk' ? PALETTE.ally : PALETTE.enemy),
      roughness: 0.3, metalness: 0.3, emissive: new THREE.Color(team === 'atk' ? PALETTE.ally : PALETTE.enemy),
      emissiveIntensity: 0.5,
    });
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.78, 0.18), cloth);
    legL.position.set(-0.11, 0.39, 0);
    const legR = legL.clone();
    legR.position.x = 0.11;
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.72, 0.3), cloth);
    torso.position.y = 1.14;
    const vest = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.4, 0.34), visor);
    vest.position.y = 1.18;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.26), skin);
    head.position.y = 1.68;
    const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.3), cloth);
    helmet.position.y = 1.82;
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.55), new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.dark), roughness: 0.5, metalness: 0.4 }));
    gun.position.set(0.2, 1.25, -0.3);
    group.add(legL, legR, torso, vest, head, helmet, gun);
    group.traverse((mesh) => {
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    return { group, torso, head, cloth };
  }

  function spawnBot(team, index, spawnPos, weaponId, role, site) {
    const name = BOT_NAMES[team][index % BOT_NAMES[team].length];
    const parts = buildMesh(team);
    parts.group.position.copy(spawnPos);
    scene.add(parts.group);
    const def = WEAPON_DEFS[weaponId];
    const bot = {
      id: `${team}-${index}`,
      name,
      team,
      role,
      site,
      isPlayer: false,
      pos: spawnPos.clone(),
      vel: new THREE.Vector3(),
      yaw: team === 'atk' ? 0 : Math.PI,
      pitch: 0,
      eye: 1.6,
      height: 1.72,
      radius: 0.34,
      onGround: true,
      crouching: false,
      health: BOT_HEALTH,
      alive: true,
      flashTime: 0,
      fall: 0,
      weapon: {
        def, mag: def.mag, reserve: def.reserve, cooldown: 0, reloadLeft: 0,
      },
      grenades: 0,
      mesh: parts.group,
      torsoMesh: parts.torso,
      headMesh: parts.head,
      cloth: parts.cloth,
      state: 'route',
      target: null,
      route: [],
      routeIndex: 0,
      holdNode: null,
      investigateAt: null,
      investigateUntil: 0,
      reactionAt: 0,
      burstLeft: 0,
      burstPause: 0,
      thinkAt: 0,
      clearSince: 0,
      strafeDir: 1,
      strafeAt: 0,
      lastHeard: null,
    };
    parts.torso.userData.agent = bot;
    parts.torso.userData.part = 'torso';
    parts.head.userData.agent = bot;
    parts.head.userData.part = 'head';
    hitMeshes.push(parts.torso, parts.head);
    bots.push(bot);
    return bot;
  }

  function canSee(bot, enemy) {
    eyePos.set(bot.pos.x, bot.pos.y + bot.eye, bot.pos.z);
    toTarget.set(enemy.pos.x, enemy.pos.y + 1.2, enemy.pos.z).sub(eyePos);
    const distance = toTarget.length();
    if (distance > VISION_RANGE) return false;
    forward.set(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
    toTarget.normalize();
    if (forward.dot(toTarget) < 0.25) return false;
    raycaster.set(eyePos, toTarget);
    raycaster.far = distance;
    const hits = raycaster.intersectObjects(map.shootables, false);
    return hits.length === 0;
  }

  function nearestVisible(bot, enemies) {
    let best = null;
    let bestDistance = Infinity;
    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      const d = bot.pos.distanceTo(enemy.pos);
      if (d >= bestDistance) continue;
      if (!canSee(bot, enemy)) continue;
      best = enemy;
      bestDistance = d;
    }
    return best ? { enemy: best, distance: bestDistance } : null;
  }

  function setRoute(bot, toId) {
    const from = nearestNode(map.nodes, bot.pos);
    bot.route = findRoute(map.nodes, from.id, toId);
    bot.routeIndex = 0;
  }

  function pickObjective(bot, game) {
    if (bot.team === 'atk') {
      const site = bot.site;
      return site === 'A' ? 'siteA' : 'siteB';
    }
    return bot.holdNode;
  }

  function think(bot, game, ctx) {
    const enemies = bot.team === 'atk' ? ctx.defenders : ctx.attackers;
    const seen = nearestVisible(bot, enemies);
    if (seen) {
      if (bot.state !== 'engage') {
        bot.state = 'engage';
        bot.target = seen.enemy;
        bot.reactionAt = ctx.time + 0.35 + seen.distance * 0.008 + random() * 0.25;
        bot.burstLeft = 0;
        bot.burstPause = 0;
      } else {
        bot.target = seen.enemy;
      }
      return;
    }
    if (bot.state === 'engage') {
      bot.state = 'route';
      bot.target = null;
      bot.clearSince = ctx.time;
    }
    // Bomb duties come before wandering.
    if (game.bomb.state === 'planted' && bot.team === 'def') {
      const site = game.bomb.site;
      const sitePos = map.sites[site].center;
      if (bot.pos.distanceTo(sitePos) < 2.5 && ctx.time - bot.clearSince > 1) {
        bot.state = 'defuse';
        return;
      }
      setRoute(bot, site === 'A' ? 'siteA' : 'siteB');
      bot.state = 'route';
      return;
    }
    if (game.bomb.state === 'carried' && bot.team === 'atk' && game.bomb.carrier === bot) {
      const sitePos = map.sites[bot.site].center;
      if (bot.pos.distanceTo(sitePos) < 2.5 && ctx.time - bot.clearSince > 1.5) {
        bot.state = 'plant';
        return;
      }
    }
    if (bot.investigateAt && ctx.time < bot.investigateUntil) {
      if (bot.state !== 'investigate') {
        const node = nearestNode(map.nodes, bot.investigateAt);
        setRoute(bot, node.id);
        bot.state = 'investigate';
      }
      return;
    }
    bot.investigateAt = null;
    if (bot.team === 'def') {
      if (bot.state !== 'hold') {
        setRoute(bot, bot.holdNode);
        bot.state = 'route';
      }
      return;
    }
    if (bot.state !== 'route' && bot.state !== 'hold') bot.state = 'route';
    if (bot.route.length === 0) setRoute(bot, pickObjective(bot, game));
  }

  function aimAt(bot, point, error) {
    const dx = point.x - bot.pos.x;
    const dy = point.y + 1.2 - (bot.pos.y + bot.eye);
    const dz = point.z - bot.pos.z;
    const length = Math.hypot(dx, dy, dz) || 1;
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
    bot.yaw = yaw + (random() * 2 - 1) * error;
    bot.pitch = pitch + (random() * 2 - 1) * error;
  }

  function fireBurst(bot, ctx, dt) {
    const weapon = bot.weapon;
    weapon.cooldown = Math.max(0, weapon.cooldown - dt);
    if (weapon.reloadLeft > 0) {
      weapon.reloadLeft -= dt;
      if (weapon.reloadLeft <= 0) {
        const need = weapon.def.mag - weapon.mag;
        const take = Math.min(need, weapon.reserve);
        weapon.mag += take;
        weapon.reserve -= take;
      }
      return;
    }
    if (weapon.mag === 0) {
      weapon.reloadLeft = weapon.def.reloadTime;
      return;
    }
    if (bot.burstPause > 0) {
      bot.burstPause -= dt;
      return;
    }
    if (bot.burstLeft <= 0) {
      bot.burstLeft = 3 + Math.floor(random() * 3);
      bot.burstPause = 0;
    }
    if (weapon.cooldown > 0 || !bot.target || !bot.target.alive) return;
    const target = bot.target;
    const distance = bot.pos.distanceTo(target.pos);
    const targetSpeed = Math.hypot(target.vel.x, target.vel.z);
    const error = 0.014 + distance * 0.00035 + targetSpeed * 0.0022;
    toTarget.set(target.pos.x, target.pos.y + 1.2, target.pos.z);
    aimAt(bot, toTarget, error);
    forward.set(-Math.sin(bot.yaw) * Math.cos(bot.pitch), Math.sin(bot.pitch), -Math.cos(bot.yaw) * Math.cos(bot.pitch));
    weapon.mag -= 1;
    weapon.cooldown = weapon.def.fireGap;
    bot.burstLeft -= 1;
    if (bot.burstLeft === 0) bot.burstPause = 0.5 + random() * 0.4;
    const result = ctx.combat.fire(bot, forward, 0.004, random, ctx.hitMeshes);
    ctx.onShotFired(bot, result);
  }

  function stepBot(bot, game, ctx, dt) {
    if (!bot.alive) {
      bot.fall = Math.min(1, bot.fall + dt / 0.4);
      bot.mesh.rotation.x = -bot.fall * 1.45;
      bot.mesh.position.y = bot.pos.y - bot.fall * 0.08;
      return;
    }
    bot.flashTime = Math.max(0, bot.flashTime - dt);
    bot.cloth.emissive = new THREE.Color(bot.flashTime > 0 ? PALETTE.danger : '#000000');
    if (ctx.time >= bot.thinkAt) {
      bot.thinkAt = ctx.time + 0.15;
      think(bot, game, ctx);
    }

    wish.set(0, 0, 0);
    let speed = 0;
    if (bot.state === 'engage' && bot.target && bot.target.alive) {
      if (ctx.time >= bot.reactionAt) {
        fireBurst(bot, ctx, dt);
        if (ctx.time >= bot.strafeAt) {
          bot.strafeAt = ctx.time + 0.7 + random() * 0.8;
          bot.strafeDir = random() < 0.5 ? -1 : 1;
        }
        const side = Math.sin(bot.yaw) * bot.strafeDir;
        const sideZ = -Math.cos(bot.yaw) * bot.strafeDir;
        wish.set(side, 0, sideZ);
        speed = ENGAGE_SPEED;
      }
    } else if (bot.state === 'route' || bot.state === 'investigate') {
      const nodeId = bot.route[bot.routeIndex];
      if (nodeId) {
        const node = map.nodes.get(nodeId);
        toTarget.set(node.pos.x - bot.pos.x, 0, node.pos.z - bot.pos.z);
        const distance = toTarget.length();
        if (distance < 0.9) {
          bot.routeIndex += 1;
          if (bot.routeIndex >= bot.route.length) {
            bot.route = [];
            if (bot.state === 'investigate') {
              bot.investigateAt = null;
              bot.state = bot.team === 'def' ? 'hold' : 'route';
            } else if (bot.team === 'def') {
              bot.state = 'hold';
            } else {
              setRoute(bot, pickObjective(bot, game));
            }
          }
        } else {
          toTarget.normalize();
          wish.copy(toTarget);
          speed = WALK_SPEED;
          bot.yaw = Math.atan2(-toTarget.x, -toTarget.z);
        }
      }
    }
    // Keep bots from piling into each other.
    for (const other of ctx.agents) {
      if (other === bot || !other.alive) continue;
      const dx = bot.pos.x - other.pos.x;
      const dz = bot.pos.z - other.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 0.81 && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        wish.x += (dx / d) * 0.6;
        wish.z += (dz / d) * 0.6;
      }
    }
    if (wish.lengthSq() > 0) {
      wish.normalize();
      mover.step(bot, dt, wish, speed, false);
    } else {
      mover.step(bot, dt, wish, 0, false);
    }
    bot.mesh.position.set(bot.pos.x, bot.pos.y, bot.pos.z);
    bot.mesh.rotation.y = bot.yaw;
    bot.mesh.rotation.x = 0;
  }

  function hear(position, time) {
    for (const bot of bots) {
      if (!bot.alive) continue;
      if (bot.pos.distanceTo(position) > HEAR_RADIUS) continue;
      if (bot.state === 'engage' || bot.state === 'plant' || bot.state === 'defuse') continue;
      bot.investigateAt = position.clone();
      bot.investigateUntil = time + 4;
      bot.investigateAt.y = 0;
    }
  }

  function reset(round, random) {
    for (const bot of bots) {
      const spawnList = map.spawns[bot.team];
      const index = bots.indexOf(bot);
      const spawn = spawnList[index % spawnList.length];
      bot.pos.copy(spawn);
      bot.vel.set(0, 0, 0);
      bot.health = BOT_HEALTH;
      bot.alive = true;
      bot.fall = 0;
      bot.yaw = bot.team === 'atk' ? 0 : Math.PI;
      bot.pitch = 0;
      bot.state = 'route';
      bot.target = null;
      bot.route = [];
      bot.routeIndex = 0;
      bot.investigateAt = null;
      bot.clearSince = 0;
      const weaponId = bot.team === 'atk'
        ? pick(random, ['rifle', 'rifle', 'smg'])
        : pick(random, ['rifle', 'smg', 'smg']);
      const def = WEAPON_DEFS[weaponId];
      bot.weapon.def = def;
      bot.weapon.mag = def.mag;
      bot.weapon.reserve = def.reserve;
      bot.weapon.cooldown = 0;
      bot.weapon.reloadLeft = 0;
      bot.mesh.rotation.set(0, bot.yaw, 0);
      bot.mesh.position.copy(spawn);
    }
  }

  return {
    bots,
    hitMeshes,
    spawnBot,
    step(bot, game, ctx, dt) {
      stepBot(bot, game, ctx, dt);
    },
    hear,
    reset,
  };
}
