// Weapons: the numbers and the view models. Four guns and a frag grenade, each
// with its own damage, fire rate, magazine, spread and price, so the buy menu is a
// real choice and not a reskin. A weapon instance owns its ammunition and its
// timing; main.js owns the ray and the damage. View models are plain box assemblies
// on the camera, one silhouette per gun.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPON_DEFS = {
  pistol: {
    id: 'pistol', name: 'P9 Sidearm', kind: 'pistol', price: 0,
    damage: 34, headMult: 3, mag: 12, reserve: 36, fireGap: 0.16, auto: false,
    reloadTime: 1.4, spreadStill: 0.004, spreadMove: 0.02, range: 60,
    kick: 0.006, moveSpeed: 5.4,
  },
  smg: {
    id: 'smg', name: 'Hornet-9', kind: 'smg', price: 1500,
    damage: 26, headMult: 3, mag: 30, reserve: 120, fireGap: 0.075, auto: true,
    reloadTime: 1.8, spreadStill: 0.006, spreadMove: 0.03, range: 45,
    kick: 0.005, moveSpeed: 5.2,
  },
  rifle: {
    id: 'rifle', name: 'VK-47', kind: 'rifle', price: 2700,
    damage: 36, headMult: 4, mag: 30, reserve: 90, fireGap: 0.105, auto: true,
    reloadTime: 2.1, spreadStill: 0.0025, spreadMove: 0.028, range: 80,
    kick: 0.011, moveSpeed: 5.0,
  },
  sniper: {
    id: 'sniper', name: 'Longbow .50', kind: 'sniper', price: 4750,
    damage: 110, headMult: 2, mag: 5, reserve: 15, fireGap: 1.1, auto: false,
    reloadTime: 2.8, spreadStill: 0.001, spreadMove: 0.05, range: 120,
    kick: 0.03, moveSpeed: 4.6,
  },
};

export const GRENADE_PRICE = 300;
export const GRENADE_MAX = 2;

const GRIP = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.dark), roughness: 0.7, metalness: 0.2 });
const STEEL = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.45, metalness: 0.4 });
const ACCENT = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.2 });

function box(w, h, d, x, y, z, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  return mesh;
}

// One view model per gun, all built the same way: a receiver, a barrel, a grip and
// a sight, in different proportions so each gun reads at a glance.
function buildModel(def) {
  const model = new THREE.Group();
  if (def.id === 'pistol') {
    model.add(
      box(0.05, 0.07, 0.2, 0, 0, -0.08, STEEL),
      box(0.045, 0.09, 0.06, 0, -0.06, 0.04, GRIP),
      box(0.02, 0.02, 0.05, 0, 0.045, -0.12, ACCENT),
    );
  } else if (def.id === 'smg') {
    model.add(
      box(0.07, 0.08, 0.34, 0, 0, -0.1, STEEL),
      box(0.04, 0.04, 0.22, 0, 0.02, -0.32, GRIP),
      box(0.05, 0.12, 0.05, 0, -0.08, -0.02, GRIP),
      box(0.06, 0.05, 0.1, 0, -0.03, 0.12, GRIP),
      box(0.02, 0.02, 0.04, 0, 0.05, -0.2, ACCENT),
    );
  } else if (def.id === 'sniper') {
    model.add(
      box(0.06, 0.07, 0.55, 0, 0, -0.16, STEEL),
      box(0.04, 0.04, 0.34, 0, 0.02, -0.52, GRIP),
      box(0.09, 0.05, 0.09, 0, 0.06, -0.1, GRIP),
      box(0.05, 0.1, 0.05, 0, -0.07, 0.02, GRIP),
      box(0.02, 0.02, 0.04, 0, 0.05, -0.3, ACCENT),
    );
  } else {
    model.add(
      box(0.09, 0.1, 0.42, 0, 0, -0.1, STEEL),
      box(0.045, 0.045, 0.4, 0, 0.025, -0.46, GRIP),
      box(0.075, 0.08, 0.22, 0, -0.02, 0.22, GRIP),
      box(0.05, 0.12, 0.05, 0, -0.09, -0.04, GRIP),
      box(0.02, 0.03, 0.06, 0, 0.06, -0.18, ACCENT),
    );
  }
  model.position.set(0.24, -0.2, -0.42);
  return model;
}

export function createWeapon(camera, defId) {
  const def = WEAPON_DEFS[defId];
  const model = buildModel(def);
  camera.add(model);
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(PALETTE.amber), transparent: true, opacity: 0.9,
      depthWrite: false, side: THREE.DoubleSide,
    }),
  );
  flash.position.set(0.24, -0.18, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.amber), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  const state = {
    def, mag: def.mag, reserve: def.reserve,
    cooldown: 0, reloadLeft: 0, flash: 0, kick: 0, bobPhase: 0,
  };

  function step(dt, moving) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    state.bobPhase += dt * (moving ? 11 : 0);
    const bob = moving ? Math.sin(state.bobPhase) * 0.006 : 0;
    model.position.z = -0.42 + state.kick;
    model.position.y = -0.2 + bob;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.min(1, (def.reloadTime - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const need = def.mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
  }

  return {
    state,
    model,
    def,
    step,
    dispose() {
      camera.remove(model, flash, flashLight);
    },
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = def.fireGap;
      state.flash = 0.06;
      state.kick = def.id === 'sniper' ? 0.09 : 0.055;
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    reload() {
      if (state.reloadLeft > 0 || state.mag === def.mag || state.reserve === 0) return false;
      state.reloadLeft = def.reloadTime;
      return true;
    },
    spread(speed) {
      return def.spreadStill + Math.min(1, speed / 5.2) * def.spreadMove;
    },
    refill() {
      state.mag = def.mag;
      state.reserve = def.reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
    },
  };
}
