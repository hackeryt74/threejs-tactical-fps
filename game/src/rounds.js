// Rounds and the economy: a buy phase, a round, a winner, and the money that
// carries between them. Wins come from eliminating the other team, from the spike
// detonating, or from defusing it; a round that runs out of time with no spike
// planted goes to the defenders. Kills pay $300, a round win pays $3250 and a loss
// pays $1900, and the buy menu spends it on guns and grenades.
import { WEAPON_DEFS, GRENADE_PRICE, GRENADE_MAX, createWeapon } from './weapons.js';
import { sfx } from './audio.js';

const BUY_SECONDS = 15;
const ROUND_SECONDS = 100;
const BOMB_FUSE = 35;
const PLANT_SECONDS = 3.5;
const DEFUSE_SECONDS = 5;
const KILL_REWARD = 300;
const WIN_REWARD = 3250;
const LOSS_REWARD = 1900;

export const BUY_ITEMS = [
  { id: 'pistol', label: 'P9 Sidearm', price: 0, key: '1' },
  { id: 'smg', label: 'Hornet-9 SMG', price: 1500, key: '2' },
  { id: 'rifle', label: 'VK-47 Rifle', price: 2700, key: '3' },
  { id: 'sniper', label: 'Longbow .50', price: 4750, key: '4' },
  { id: 'grenade', label: 'Frag grenade', price: 300, key: '5' },
];

export function createRounds(state, hud, camera) {
  let onRoundEnd = () => {};
  let onMatchEnd = () => {};

  function aliveCount(team) {
    return state.agents.filter((agent) => agent.alive && agent.team === team).length;
  }

  function startMatch() {
    state.score.atk = 0;
    state.score.def = 0;
    state.round = 1;
    state.money = 800;
    state.kills = 0;
    state.deaths = 0;
    state.winner = null;
    state.streak.atk = 0;
    state.streak.def = 0;
    startRound();
  }

  function startRound() {
    state.phase = 'buy';
    state.timer = BUY_SECONDS;
    state.roundTime = ROUND_SECONDS;
    state.bomb.state = 'idle';
    state.bomb.site = null;
    state.bomb.position = null;
    state.bomb.fuse = BOMB_FUSE;
    state.bomb.plantProgress = 0;
    state.bomb.defuseProgress = 0;
    state.bomb.planter = null;
    state.bomb.defuser = null;
    state.roundWinner = null;
    state.roundReason = '';
    hud.setBomb('Spike with Vanguard');
    hud.setBombProgress(0);
    hud.showBuy(true);
  }

  function endRound(winner, reason) {
    if (state.phase === 'roundEnd' || state.phase === 'matchEnd') return;
    state.roundWinner = winner;
    state.roundReason = reason;
    state.score[winner] += 1;
    state.streak[winner] += 1;
    state.streak[winner === 'atk' ? 'def' : 'atk'] = 0;
    const playerWon = winner === 'atk';
    state.money += playerWon ? WIN_REWARD : LOSS_REWARD;
    state.phase = 'roundEnd';
    state.timer = 5;
    if (playerWon) sfx.roundWin();
    else sfx.roundLose();
    hud.showBanner(
      winner === 'atk' ? 'VANGUARD WINS THE ROUND' : 'JACKALS WIN THE ROUND',
      reason,
      4200,
    );
    onRoundEnd(winner, reason);
  }

  function endMatch() {
    state.phase = 'matchEnd';
    const winner = state.score.atk > state.score.def ? 'atk' : state.score.def > state.score.atk ? 'def' : 'draw';
    state.winner = winner;
    const text = winner === 'draw'
      ? `Draw, ${state.score.atk} — ${state.score.def}.`
      : `${winner === 'atk' ? 'Vanguard' : 'Jackals'} take the match, ${state.score.atk} — ${state.score.def}. You made ${state.kills} eliminations.`;
    hud.showOverlay('matchEnd', text);
    onMatchEnd(winner);
  }

  function nextAfterRoundEnd() {
    if (state.score.atk >= state.winTarget || state.score.def >= state.winTarget || state.round >= state.maxRounds) {
      endMatch();
      return;
    }
    state.round += 1;
    startRound();
  }

  function buy(itemId, player) {
    const item = BUY_ITEMS.find((entry) => entry.id === itemId);
    if (!item || state.phase !== 'buy') return false;
    if (item.id === 'grenade') {
      if (player.grenades >= GRENADE_MAX || state.money < GRENADE_PRICE) return false;
      state.money -= GRENADE_PRICE;
      player.grenades += 1;
      sfx.buy();
      return true;
    }
    const def = WEAPON_DEFS[item.id];
    if (player.weapon.def.id === item.id && player.weapon.state.mag === def.mag) return false;
    if (state.money < def.price) return false;
    state.money -= def.price;
    if (player.weapon.def.id !== item.id) {
      player.weapon.dispose();
      player.weapon = createWeapon(camera, item.id);
    } else {
      player.weapon.refill();
    }
    sfx.buy();
    return true;
  }

  function onKill(victim, killer) {
    if (killer && killer.isPlayer && victim.team !== 'atk') {
      state.money += KILL_REWARD;
      state.kills += 1;
    }
    if (victim.isPlayer) state.deaths += 1;
    const atkAlive = aliveCount('atk');
    const defAlive = aliveCount('def');
    if (state.phase !== 'play' && state.phase !== 'buy') return;
    if (atkAlive === 0) {
      if (state.bomb.state === 'planted') return; // defenders must still defuse
      endRound('def', 'Vanguard eliminated.');
    } else if (defAlive === 0) {
      if (state.bomb.state === 'planted') return; // the spike is still ticking
      endRound('atk', 'Jackals eliminated.');
    }
  }

  // Plant and defuse channels, advanced once per fixed step. channeler is the
  // agent holding the use key (player) or the bot whose state says plant/defuse.
  function stepChannels(dt, channeler) {
    const bomb = state.bomb;
    if (state.phase !== 'play') return;
    if (bomb.state === 'carried' && channeler && channeler.alive && channeler.isPlayer) {
      const site = inSite(channeler);
      if (site && channeler.weapon.state.reloadLeft === 0) {
        bomb.site = site;
        bomb.planter = channeler;
        bomb.plantProgress = Math.min(1, bomb.plantProgress + dt / PLANT_SECONDS);
        if (Math.floor(bomb.plantProgress * 10) !== Math.floor((bomb.plantProgress - dt / PLANT_SECONDS) * 10)) sfx.plantBeep();
        if (bomb.plantProgress >= 1) {
          bomb.state = 'planted';
          bomb.position = channeler.pos.clone();
          bomb.fuse = BOMB_FUSE;
          bomb.plantProgress = 0;
          sfx.plantDone();
          hud.setBomb(`Spike planted at ${site} — ${BOMB_FUSE}s`);
        }
      } else {
        bomb.plantProgress = 0;
        bomb.planter = null;
      }
    } else if (bomb.state === 'carried' && channeler && !channeler.isPlayer) {
      bomb.site = channeler.site;
      bomb.planter = channeler;
      bomb.plantProgress = Math.min(1, bomb.plantProgress + dt / PLANT_SECONDS);
      if (bomb.plantProgress >= 1) {
        bomb.state = 'planted';
        bomb.position = channeler.pos.clone();
        bomb.fuse = BOMB_FUSE;
        bomb.plantProgress = 0;
        sfx.plantDone();
        hud.setBomb(`Spike planted at ${bomb.site} — ${BOMB_FUSE}s`);
      }
    }
    if (bomb.state === 'planted' && channeler && channeler.alive && bomb.position) {
      const distance = channeler.pos.distanceTo(bomb.position);
      if (distance < 2.2 && channeler.team === 'def') {
        bomb.defuser = channeler;
        bomb.defuseProgress = Math.min(1, bomb.defuseProgress + dt / DEFUSE_SECONDS);
        if (Math.floor(bomb.defuseProgress * 10) !== Math.floor((bomb.defuseProgress - dt / DEFUSE_SECONDS) * 10)) sfx.defuseBeep();
        if (bomb.defuseProgress >= 1) {
          bomb.state = 'defused';
          endRound('def', 'Spike defused.');
        }
      } else {
        bomb.defuseProgress = 0;
        bomb.defuser = null;
      }
    }
  }

  function inSite(agent) {
    for (const key of ['A', 'B']) {
      const site = state.sites[key];
      const dx = agent.pos.x - site.center.x;
      const dz = agent.pos.z - site.center.z;
      if (dx * dx + dz * dz < site.radius * site.radius) return key;
    }
    return null;
  }

  function step(dt, ctx) {
    if (state.phase === 'buy') {
      state.timer -= dt;
      if (state.timer <= 0) {
        state.phase = 'play';
        state.timer = state.roundTime;
        hud.showBuy(false);
        hud.setBomb(state.bomb.state === 'carried' ? 'Spike with Vanguard — plant at A or B' : 'Spike with Vanguard');
      }
      return;
    }
    if (state.phase === 'play') {
      state.timer -= dt;
      if (state.bomb.state === 'planted') {
        state.bomb.fuse -= dt;
        hud.setBomb(`Spike planted at ${state.bomb.site} — ${Math.max(0, Math.ceil(state.bomb.fuse))}s`);
        if (state.bomb.fuse <= 0) {
          state.bomb.state = 'detonated';
          ctx.detonate();
          endRound('atk', 'Spike detonated.');
          return;
        }
      }
      if (state.timer <= 0) {
        if (state.bomb.state === 'planted') return; // the fuse decides now
        endRound('def', 'Time expired — spike never planted.');
      }
      return;
    }
    if (state.phase === 'roundEnd') {
      state.timer -= dt;
      if (state.timer <= 0) nextAfterRoundEnd();
    }
  }

  return {
    startMatch,
    startRound,
    endRound,
    buy,
    onKill,
    stepChannels,
    step,
    inSite,
    aliveCount,
    setOnRoundEnd(handler) {
      onRoundEnd = handler;
    },
    setOnMatchEnd(handler) {
      onMatchEnd = handler;
    },
  };
}
