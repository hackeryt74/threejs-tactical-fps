// The DOM HUD: health, ammunition, timer, score, money, bomb state, killfeed,
// buy menu and round banners. It never touches the simulation; main.js pushes
// numbers in and reads the play/buy callbacks out. Every setter skips a DOM write
// when the value did not change, so the HUD costs nothing on a quiet frame.
const COPY = {
  start: {
    title: 'EMBERLINE',
    copy: 'A dusk freight yard, two sites, one spike. Plant it at A or B, or clear the yard. Click to play.',
    action: 'Click to play',
  },
  paused: {
    title: 'EMBERLINE',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  roundEnd: {
    title: 'Round over',
    copy: '',
    action: 'Next round',
  },
  matchEnd: {
    title: 'Match over',
    copy: '',
    action: 'Play again',
  },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const healthFill = $('health-fill');
  const healthValue = $('health-value');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const timerValue = $('timer-value');
  const scoreAtk = $('score-atk');
  const scoreDef = $('score-def');
  const moneyValue = $('money-value');
  const aliveAtk = $('alive-atk');
  const aliveDef = $('alive-def');
  const bombStatus = $('bomb-status');
  const bombBar = $('bomb-bar');
  const bombFill = $('bomb-fill');
  const feed = $('feed');
  const banner = $('banner');
  const bannerText = $('banner-text');
  const bannerSub = $('banner-sub');
  const buyMenu = $('buy-menu');
  const buyMoney = $('buy-money');
  const hitmarker = $('hitmarker');
  const damage = $('damage');
  const crosshair = $('crosshair');
  let hitTimer = 0;
  let bannerTimer = 0;
  let last = {};

  function setText(node, key, value) {
    if (last[key] === value) return;
    last[key] = value;
    node.textContent = value;
  }

  return {
    setHealth(value) {
      const rounded = Math.max(0, Math.ceil(value));
      setText(healthValue, 'health', String(rounded));
      const width = `${rounded}%`;
      if (last.healthWidth !== width) {
        last.healthWidth = width;
        healthFill.style.width = width;
        healthFill.classList.toggle('low', rounded <= 30);
      }
    },
    setAmmo(mag, reserve, name) {
      setText(ammoMag, 'mag', String(mag));
      setText(ammoReserve, 'reserve', `/ ${reserve}`);
      setText(weaponName, 'weapon', name);
      const empty = mag === 0;
      if (last.empty !== empty) {
        last.empty = empty;
        ammoMag.parentElement.classList.toggle('empty', empty);
      }
    },
    setTimer(seconds, phase) {
      const text = seconds >= 60 ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : String(Math.ceil(seconds));
      setText(timerValue, 'timer', text);
      const danger = seconds <= 10 && phase === 'play';
      if (last.timerDanger !== danger) {
        last.timerDanger = danger;
        timerValue.classList.toggle('danger', danger);
      }
    },
    setScore(atk, def) {
      setText(scoreAtk, 'scoreAtk', String(atk));
      setText(scoreDef, 'scoreDef', String(def));
    },
    setMoney(value) {
      setText(moneyValue, 'money', `$${value}`);
      setText(buyMoney, 'buyMoney', `$${value}`);
    },
    setAlive(atk, def) {
      setText(aliveAtk, 'aliveAtk', String(atk));
      setText(aliveDef, 'aliveDef', String(def));
    },
    setBomb(text) {
      setText(bombStatus, 'bomb', text);
    },
    setBombProgress(value) {
      const percent = Math.round(value * 100);
      if (last.bombProgress === percent) return;
      last.bombProgress = percent;
      bombBar.hidden = percent <= 0 || percent >= 100;
      bombFill.style.width = `${percent}%`;
    },
    setSpread(spread) {
      const gap = Math.round(4 + spread * 260);
      if (last.gap === gap) return;
      last.gap = gap;
      crosshair.style.setProperty('--gap', `${gap}px`);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    damageFlash() {
      damage.classList.remove('on');
      void damage.offsetWidth;
      damage.classList.add('on');
    },
    killfeed(text) {
      const line = document.createElement('div');
      line.className = 'feed-line';
      line.textContent = text;
      feed.prepend(line);
      while (feed.children.length > 5) feed.removeChild(feed.lastChild);
      setTimeout(() => line.classList.add('fade'), 4200);
    },
    showBanner(text, sub, holdMs = 2600) {
      bannerText.textContent = text;
      bannerSub.textContent = sub;
      banner.hidden = false;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => {
        banner.hidden = true;
      }, holdMs);
    },
    hideBanner() {
      banner.hidden = true;
      clearTimeout(bannerTimer);
    },
    showOverlay(mode, scoreText) {
      const text = COPY[mode];
      title.textContent = text.title;
      copy.textContent = mode === 'roundEnd' || mode === 'matchEnd' ? scoreText : text.copy;
      play.textContent = text.action;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
    showBuy(show) {
      buyMenu.hidden = !show;
    },
    setBuyRow(id, affordable, owned) {
      const row = document.getElementById(`buy-${id}`);
      if (!row) return;
      row.classList.toggle('poor', !affordable && !owned);
      row.classList.toggle('owned', owned);
    },
    onBuy(handler) {
      buyMenu.addEventListener('click', (event) => {
        const row = event.target.closest('[data-buy]');
        if (row) handler(row.dataset.buy);
      });
    },
  };
}
