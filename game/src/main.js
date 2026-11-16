// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the display's
// rate. This file wires the systems together and owns the parts only it can see:
// the player's trigger finger, the spike carrier, the round resets and the
// deterministic ?shot= staging for screenshots. ?shot=start|play|end with &seed=N
// sets up a staged frame, renders it twice, then freezes it and sets
// window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32, pick } from './rng.js';
import { createState } from './state.js';
import { buildMap } from './map.js';
import { createMover } from './mover.js';
import { createInput } from './input.js';
import { createWeapon, WEAPON_DEFS } from './weapons.js';
import { createBots } from './bots.js';
import { createCombat } from './combat.js';
import { createRounds, BUY_ITEMS } from './rounds.js';
import { createHud } from './hud.js';
import { ensureAudio, sfx } from './audio.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.fog), 22, 58);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const state = createState();
const map = buildMap(scene);
state.sites = map.sites;
const mover = createMover(map.colliders);
const hud = createHud();
const input = createInput(renderer.domElement, onLockChange);
const bots = createBots(scene, map, mover, random);

// The player: one agent among the others, with a camera for a head.
const player = {
  id: 'player', name: 'You', team: 'atk', isPlayer: true,
  pos: new THREE.Vector3(0, 0, 16), vel: new THREE.Vector3(),
  yaw: 0, pitch: 0, eye: 1.6, height: 1.72, radius: 0.34,
  onGround: true, crouching: false, health: 100, alive: true,
  flashTime: 0, shake: 0, grenades: 0, weapon: null, lastAttacker: null,
};
player.weapon = createWeapon(camera, 'pistol');
state.agents = [player];

// Teams: the player plus three Vanguard bots against four Jackals.
const attackers = [player];
const defenders = [];
for (let i = 0; i < 3; i += 1) {
  const site = i < 2 ? 'A' : 'B';
  const bot = bots.spawnBot('atk', i, map.spawns.atk[i + 1], i === 2 ? 'smg' : 'rifle', 'attacker', site);
  bot.holdNode = site === 'A' ? 'siteA' : 'siteB';
  attackers.push(bot);
}
const defHolds = ['defAHold', 'defBHold', 'defAHold', 'defMidHold'];
for (let i = 0; i < 4; i += 1) {
  const bot = bots.spawnBot('def', i, map.spawns.def[i], i % 2 === 0 ? 'rifle' : 'smg', 'defender', null);
  bot.holdNode = defHolds[i];
  defenders.push(bot);
}
state.agents.push(...attackers.slice(1), ...defenders);

const combat = createCombat(scene, map, player);
const hitMeshes = bots.hitMeshes;
const rounds = createRounds(state, hud, camera);

const aimDir = new THREE.Vector3();
const wish = new THREE.Vector3();
const spectateEye = new THREE.Vector3();
let frozen = false;
let started = false;
let accumulator = 0;
let lastTime = performance.now();
let stepCount = 0;
let lastBuyRound = 0;

function allAgents() {
  return state.agents;
}

function onKill(victim, killer) {
  const killerName = killer ? killer.name : 'The yard';
  const victimName = victim.name;
  hud.killfeed(`${killerName}  ▸  ${victimName}`);
  if (victim.isPlayer) {
    hud.damageFlash();
    sfx.hurt();
  } else if (killer && killer.isPlayer) {
    sfx.kill();
  }
  if (victim.isPlayer && state.bomb.state === 'carried') {
    state.bomb.carrier = nearestAttackerBot();
  }
  rounds.onKill(victim, killer);
}

function nearestAttackerBot() {
  for (const bot of attackers) {
    if (!bot.isPlayer && bot.alive) return bot;
  }
  return null;
}

function onShotFired(shooter, result) {
  const distance = shooter.pos.distanceTo(player.pos);
  if (shooter.isPlayer) {
    sfx.shot(shooter.weapon.def.kind);
    bots.hear(shooter.pos, state.time);
  } else if (distance < 40) {
    sfx.distantShot();
    bots.hear(shooter.pos, state.time);
  }
  if (result.hit === 'agent') {
    if (shooter.isPlayer) {
      hud.hitMarker(result.killed, shot ? 4000 : 90);
      sfx.hit();
    } else if (result.victim.isPlayer) {
      hud.damageFlash();
      sfx.hurt();
    }
    if (result.killed) onKill(result.victim, shooter);
  }
}

function playerShoot() {
  const weapon = player.weapon;
  if (!weapon.takeRound()) {
    sfx.dryFire();
    weapon.pullTrigger();
    return;
  }
  camera.getWorldDirection(aimDir);
  const speed = Math.hypot(player.vel.x, player.vel.z);
  const result = combat.fire(player, aimDir, weapon.spread(speed), random, hitMeshes);
  weapon.pullTrigger();
  player.pitch = Math.min(1.45, player.pitch + weapon.def.kick * (0.8 + random() * 0.4));
  player.yaw += (random() * 2 - 1) * weapon.def.kick * 0.4;
  onShotFired(player, result);
}

function detonate() {
  const point = state.bomb.position;
  if (!point) return;
  combat.spawnSparks(new THREE.Vector3(point.x, point.y + 1, point.z), 40, 7);
  sfx.explosion();
  const blast = new THREE.Mesh(
    new THREE.SphereGeometry(3.2, 16, 12),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.amber), transparent: true, opacity: 0.5 }),
  );
  blast.position.set(point.x, point.y + 1, point.z);
  scene.add(blast);
  setTimeout(() => scene.remove(blast), 600);
  for (const agent of allAgents()) {
    if (!agent.alive) continue;
    const d = point.distanceTo(new THREE.Vector3(agent.pos.x, agent.pos.y + 1, agent.pos.z));
    if (d < 7) {
      const killed = combat.damageAgent(agent, Math.max(20, Math.round(130 * (1 - d / 7))), null);
      if (killed) onKill(agent, null);
    }
  }
}

function resetAgentsForRound() {
  const wasAlive = player.alive;
  player.pos.set(0, 0, 16);
  player.vel.set(0, 0, 0);
  player.yaw = 0;
  player.pitch = 0;
  player.health = 100;
  player.alive = true;
  player.eye = 1.6;
  player.height = 1.72;
  player.grenades = 0;
  player.shake = 0;
  // The fallen lose the gun they bought; survivors keep theirs.
  if (!wasAlive && player.weapon.def.id !== 'pistol') {
    player.weapon.dispose();
    player.weapon = createWeapon(camera, 'pistol');
  }
  player.weapon.refill();
  bots.reset(state.round, random);
  state.bomb.carrier = player;
  state.bomb.state = 'carried';
}

rounds.setOnRoundEnd(() => {
  resetAgentsForRound();
  hud.setScore(state.score.atk, state.score.def);
  hud.setMoney(state.money);
  hud.setAlive(4, 4);
  hud.setHealth(player.health);
  hud.setAmmo(player.weapon.state.mag, player.weapon.state.reserve, player.weapon.def.name);
});
rounds.setOnMatchEnd(() => {
  if (document.pointerLockElement) document.exitPointerLock();
});

function channeler() {
  if (state.phase !== 'play') return null;
  if (player.alive && input.state.keys.has('KeyE') && state.bomb.state === 'carried') return player;
  if (state.bomb.state === 'planted') {
    for (const bot of defenders) {
      if (bot.alive && bot.state === 'defuse') return bot;
    }
  }
  if (state.bomb.state === 'carried') {
    for (const bot of attackers) {
      if (!bot.isPlayer && bot.alive && bot.state === 'plant') return bot;
    }
  }
  return null;
}

function step(dt) {
  state.time += dt;
  stepCount += 1;
  // Player movement.
  const keys = input.state.keys;
  const crouching = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
  if (crouching && !player.crouching) {
    player.crouching = true;
    player.height = 1.12;
  } else if (!crouching && player.crouching && mover.clearAbove(player, 1.72)) {
    player.crouching = false;
    player.height = 1.72;
  }
  player.eye += ((player.crouching ? 1.02 : 1.6) - player.eye) * Math.min(1, dt * 12);
  const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  wish.set(0, 0, 0);
  if ((forward || strafe) && player.alive) {
    const sin = Math.sin(player.yaw);
    const cos = Math.cos(player.yaw);
    wish.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe).normalize();
  }
  const speed = player.crouching ? 2.4 : player.weapon.def.moveSpeed;
  mover.step(player, dt, wish, speed, keys.has('Space') && player.alive);
  if (player.alive && wish.lengthSq() > 0 && stepCount % 24 === 0) sfx.step();
  player.weapon.step(dt, wish.lengthSq() > 0);
  player.flashTime = Math.max(0, player.flashTime - dt);
  player.shake = Math.max(0, player.shake - dt * 2.2);

  // Bots.
  const ctx = {
    time: state.time, attackers, defenders, agents: allAgents(),
    combat, hitMeshes, onShotFired,
  };
  for (const bot of bots.bots) bots.step(bot, state, ctx, dt);

  combat.step(dt, allAgents(), (victim, killer) => onKill(victim, killer));
  rounds.stepChannels(dt, channeler());
  rounds.step(dt, { detonate });
  syncHud();
}

function syncHud() {
  hud.setHealth(player.health);
  hud.setAmmo(player.weapon.state.mag, player.weapon.state.reserve, player.weapon.def.name);
  hud.setTimer(state.phase === 'buy' ? Math.max(0, state.timer) : Math.max(0, state.phase === 'play' ? state.timer : 0), state.phase);
  hud.setScore(state.score.atk, state.score.def);
  hud.setMoney(state.money);
  hud.setAlive(
    attackers.filter((a) => a.alive).length,
    defenders.filter((a) => a.alive).length,
  );
  const bomb = state.bomb;
  if (bomb.state === 'planted') hud.setBombProgress(0);
  else if (bomb.state === 'carried' && bomb.planter) hud.setBombProgress(bomb.plantProgress);
  else if (bomb.state === 'planted' && bomb.defuser) hud.setBombProgress(bomb.defuseProgress);
  else hud.setBombProgress(0);
  if (bomb.state === 'planted' && bomb.defuser) {
    hud.setBomb(`Defusing — ${Math.ceil(bomb.defuseProgress * 5)}s left`);
  }
  hud.setSpread(player.weapon.spread(Math.hypot(player.vel.x, player.vel.z)));
  const buyRound = document.getElementById('buy-round');
  if (buyRound && lastBuyRound !== state.round) {
    lastBuyRound = state.round;
    buyRound.textContent = String(state.round);
  }
  for (const item of BUY_ITEMS) {
    if (item.id === 'grenade') {
      hud.setBuyRow(item.id, state.money >= item.price && player.grenades < 2, false);
    } else {
      hud.setBuyRow(item.id, state.money >= item.price, player.weapon.def.id === item.id);
    }
  }
}

function syncCamera() {
  let eye = player.eye;
  let yaw = player.yaw;
  let pitch = player.pitch;
  let pos = player.pos;
  if (!player.alive) {
    const target = attackers.find((a) => !a.isPlayer && a.alive) || defenders.find((a) => a.alive);
    if (target) {
      pos = target.pos;
      eye = target.eye;
      yaw = target.yaw;
      pitch = target.pitch;
    }
  }
  const shake = player.shake * 0.02;
  camera.position.set(
    pos.x + (random() * 2 - 1) * shake,
    pos.y + eye + (random() * 2 - 1) * shake,
    pos.z,
  );
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    if (player.alive) {
      player.yaw -= look.x * 0.0022;
      player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - look.y * 0.0022));
    }
    if (input.state.firing && player.alive && player.weapon.ready() && (state.phase === 'play' || state.phase === 'buy')) {
      playerShoot();
    }
    if (input.consumePressed('KeyR') && player.alive) {
      if (player.weapon.reload()) sfx.reload();
    }
    if (input.consumePressed('KeyG') && player.alive && (state.phase === 'play' || state.phase === 'buy')) {
      camera.getWorldDirection(aimDir);
      combat.throwGrenade(player, aimDir);
    }
    if (input.consumePressed('KeyB') && state.phase === 'buy') {
      hud.showBuy(document.getElementById('buy-menu').hidden);
    }
    for (const code of ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5']) {
      if (input.consumePressed(code) && state.phase === 'buy') {
        const item = ['pistol', 'smg', 'rifle', 'sniper', 'grenade'][Number(code.slice(5)) - 1];
        if (rounds.buy(item, player)) {
          hud.setAmmo(player.weapon.state.mag, player.weapon.state.reserve, player.weapon.def.name);
        }
      }
    }
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function onLockChange(locked) {
  if (shot) return;
  ensureAudio();
  if (locked) {
    started = true;
    hud.hideOverlay();
    hud.showBuy(state.phase === 'buy');
  } else if (state.phase === 'matchEnd') {
    hud.showOverlay('matchEnd', '');
  } else if (state.phase === 'roundEnd') {
    hud.showOverlay('roundEnd', `${state.roundReason} Vanguard ${state.score.atk} — ${state.score.def} Jackals.`);
  } else if (!started) {
    hud.showOverlay('start', '');
  } else {
    hud.showOverlay('paused', '');
  }
}

hud.onPlay(() => {
  if (shot) return;
  ensureAudio();
  if (state.phase === 'matchEnd') {
    rounds.startMatch();
    resetAgentsForRound();
    hud.setScore(0, 0);
    hud.setMoney(state.money);
    hud.setAlive(4, 4);
  }
  if (state.phase === 'menu') {
    state.phase = 'buy';
    state.timer = 15;
    rounds.startMatch();
    resetAgentsForRound();
    hud.showBuy(true);
  }
  input.requestLock();
});
hud.onBuy((itemId) => {
  if (rounds.buy(itemId, player)) {
    hud.setAmmo(player.weapon.state.mag, player.weapon.state.reserve, player.weapon.def.name);
    hud.setMoney(state.money);
  }
});

function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function aimPlayerAt(point) {
  const dx = point.x - player.pos.x;
  const dy = point.y + 1.2 - (player.pos.y + player.eye);
  const dz = point.z - player.pos.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  player.yaw = Math.atan2(-dx, -dz);
  player.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function runShot(name) {
  hud.hideOverlay();
  hud.hideBanner();
  state.phase = 'play';
  if (name === 'start') {
    player.pos.set(0, 0, 16);
    player.yaw = 0;
    player.pitch = 0.02;
    state.timer = 100;
    state.round = 1;
    settle(30);
    syncCamera();
    hud.showOverlay('start', '');
    paintTwiceThenReady();
    return;
  }
  if (name === 'play') {
    // Mid-combat in the mid doors: the player is trading fire with a Jackal.
    player.pos.set(-1.5, 0, 7.5);
    player.health = 82;
    state.timer = 78;
    state.money = 2150;
    const jackal = defenders[1];
    jackal.pos.set(-3.5, 0, -3.5);
    jackal.yaw = Math.PI;
    jackal.mesh.position.copy(jackal.pos);
    jackal.mesh.rotation.y = jackal.yaw;
    const fallen = defenders[0];
    fallen.pos.set(-4.5, 0, 2.5);
    fallen.alive = false;
    fallen.health = 0;
    fallen.fall = 1;
    fallen.mesh.position.copy(fallen.pos);
    fallen.mesh.rotation.x = -1.45;
    fallen.mesh.position.y = -0.08;
    const mate = attackers[1];
    mate.pos.set(-5, 0, 10);
    mate.yaw = 0;
    mate.mesh.position.copy(mate.pos);
    mate.mesh.rotation.y = 0;
    settle(10);
    aimPlayerAt(new THREE.Vector3(jackal.pos.x, jackal.pos.y + 1.2, jackal.pos.z));
    playerShoot();
    settle(2);
    aimPlayerAt(new THREE.Vector3(jackal.pos.x, jackal.pos.y + 1.2, jackal.pos.z));
    playerShoot();
    settle(2);
    hud.setHealth(player.health);
    hud.setAmmo(player.weapon.state.mag, player.weapon.state.reserve, player.weapon.def.name);
    syncCamera();
    paintTwiceThenReady();
    return;
  }
  // end: the round is won, the spike blew at site A.
  state.phase = 'roundEnd';
  state.score.atk = 1;
  state.score.def = 0;
  state.bomb.state = 'detonated';
  state.bomb.site = 'A';
  player.pos.set(-8, 0, -6);
  player.health = 64;
  settle(10);
  aimPlayerAt(new THREE.Vector3(-15, 1.5, -13));
  combat.spawnSparks(new THREE.Vector3(-15, 1.2, -13), 40, 7);
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(2.2, 16, 12),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.amber), transparent: true, opacity: 0.35 }),
  );
  glow.position.set(-15, 1.2, -13);
  scene.add(glow);
  hud.showBanner('VANGUARD WINS THE ROUND', 'Spike detonated at Site A.', 9000);
  hud.setScore(1, 0);
  hud.setMoney(4050);
  syncCamera();
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

hud.setAmmo(player.weapon.state.mag, player.weapon.state.reserve, player.weapon.def.name);
hud.setScore(0, 0);
hud.setMoney(state.money);
hud.setAlive(4, 4);
hud.setHealth(player.health);
hud.setTimer(100, 'menu');
syncCamera();
if (shot) runShot(shot);
else requestAnimationFrame(frame);
