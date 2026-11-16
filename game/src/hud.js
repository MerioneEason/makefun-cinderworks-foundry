// Cinderworks Foundry: the DOM HUD. All reads go through update(); the buy
// panel is built once from the weapon table and refreshed by refreshBuy().
import { WEAPONS, GRENADES, ARMOUR_PRICE } from './weapons.js';

// In ?shot= mode the frame is frozen for capture, so timed fades must not run.
const SHOT = () => !!window.__shotMode;

function el(id) { return document.getElementById(id); }

export function createHud(callbacks) {
  const buyGrid = el('buy-grid');
  const items = [];
  // Build the buy grid from the tables so prices never drift from the code.
  for (const w of Object.values(WEAPONS)) {
    if (w.id === 'pistol') continue;
    items.push({ id: w.id, label: `${w.name}`, price: w.price, key: '' });
  }
  items.push({ id: 'armour', label: 'VEST & HELM', price: ARMOUR_PRICE, key: '' });
  for (const g of Object.values(GRENADES)) {
    items.push({ id: g.id, label: `${g.name} GRENADE`, price: g.price, key: '' });
  }
  const keyFor = { smg: '1', shotgun: '2', rifle: '3', marksman: '4', armour: '5', frag: '6', flash: '7', smoke: '8' };
  for (const item of items) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'buy-item';
    btn.dataset.id = item.id;
    btn.innerHTML = `<span class="buy-key">${keyFor[item.id] || ''}</span><span class="buy-label">${item.label}</span><span class="buy-price">$${item.price}</span>`;
    btn.addEventListener('click', () => callbacks.onBuy(item.id));
    buyGrid.appendChild(btn);
    items[items.indexOf(item)].el = btn;
  }
  el('play-btn').addEventListener('click', () => callbacks.onPlay());
  window.addEventListener('keydown', (e) => {
    if (el('buy').hidden) return;
    const map = { Digit1: 'smg', Digit2: 'shotgun', Digit3: 'rifle', Digit4: 'marksman', Digit5: 'armour', Digit6: 'frag', Digit7: 'flash', Digit8: 'smoke' };
    if (map[e.code]) callbacks.onBuy(map[e.code]);
  });

  let bannerUntil = 0;
  let menuOpen = true;
  let killRows = 0;

  function fmtMoney(n) { return `$${Math.round(n)}`; }

  return {
    menuVisible() { return menuOpen; },
    showMenu(kind, won) {
      menuOpen = true;
      const menu = el('menu');
      menu.hidden = false;
      const title = el('menu-title');
      const copy = el('menu-copy');
      const btn = el('play-btn');
      if (kind === 'paused') {
        title.textContent = 'PAUSED';
        copy.textContent = 'The foundry waits. Click below to get back on the floor.';
        btn.textContent = 'RESUME';
      } else if (kind === 'end') {
        title.textContent = won ? 'EMBER TAKE THE FOUNDRY' : 'SLAG HOLD THE FOUNDRY';
        copy.textContent = won
          ? 'Seven rounds to Ember. The melt shop is yours — play again to run it back.'
          : 'Seven rounds to Slag. The charge never went through — play again to run it back.';
        btn.textContent = 'PLAY AGAIN';
      } else {
        title.textContent = 'CINDERWORKS FOUNDRY';
        copy.textContent = 'A round-based tactical FPS. You run with Ember: buy your kit, plant the charge at the Melt Shop or the Casting Bay, and hold it — or wipe Slag out. First to 7 rounds takes the foundry.';
        btn.textContent = 'CLICK TO PLAY';
      }
    },
    hideMenu() { menuOpen = false; el('menu').hidden = true; },
    update(s) {
      el('health-num').textContent = Math.max(0, Math.ceil(s.health));
      el('health-fill').style.width = `${Math.max(0, Math.min(100, s.health))}%`;
      el('armour-tag').hidden = !s.armour;
      el('ammo-mag').textContent = s.mag;
      el('ammo-reserve').textContent = `/ ${s.reserve}`;
      el('weapon-name').textContent = s.weaponName;
      el('money').textContent = fmtMoney(s.money);
      el('timer-text').textContent = s.timerText;
      el('timer-label').textContent = s.phaseLabel;
      el('timer-text').style.color = s.timerUrgent ? '#e5484d' : '';
      el('score-us').textContent = s.scoreUs;
      el('score-them').textContent = s.scoreThem;
      el('round-num').textContent = `ROUND ${s.roundNum}`;
      el('objective').textContent = s.objective;
      el('grenades').textContent = `FRAG ×${s.grenades.frag}  FLASH ×${s.grenades.flash}  SMOKE ×${s.grenades.smoke}`;
    },
    setSpread(px) {
      el('crosshair').style.setProperty('--gap', `${px}px`);
    },
    hitmarker(kill) {
      const h = el('hitmarker');
      h.style.color = kill ? '#e5484d' : '#ece7db';
      h.style.opacity = '1';
      if (!SHOT()) setTimeout(() => { h.style.opacity = '0'; }, kill ? 220 : 120);
    },
    damageFlash() {
      const v = el('damage-veil');
      v.style.opacity = '1';
      setTimeout(() => { v.style.opacity = '0'; }, 180);
    },
    flashWhite(strength) {
      const v = el('flash-veil');
      v.style.opacity = String(Math.min(1, strength));
      setTimeout(() => { v.style.opacity = '0'; }, 700);
    },
    killfeed(killer, victim, headshot, killerUs, victimUs) {
      const feed = el('killfeed');
      const row = document.createElement('div');
      row.className = 'feed-row';
      row.innerHTML = `<span class="${killerUs ? 'us' : 'them'}">${killer}</span><span>${headshot ? '◉' : '✕'}</span><span class="${victimUs ? 'us' : 'them'}">${victim}</span>`;
      feed.prepend(row);
      killRows += 1;
      while (feed.children.length > 5) feed.removeChild(feed.lastChild);
      if (!SHOT()) setTimeout(() => { if (row.parentNode) row.parentNode.removeChild(row); }, 6000);
    },
    banner(title, sub, seconds = 3) {
      el('banner-title').textContent = title;
      el('banner-sub').textContent = sub;
      el('banner').hidden = false;
      bannerUntil = performance.now() + seconds * 1000;
      if (!SHOT()) setTimeout(() => { el('banner').hidden = true; }, seconds * 1000);
    },
    setChargeBar(progress, label) {
      const bar = el('chargebar');
      if (progress === null) { bar.hidden = true; return; }
      bar.hidden = false;
      el('chargebar-label').textContent = label;
      el('chargebar-fill').style.width = `${Math.round(progress * 100)}%`;
    },
    setBuyOpen(open, s) {
      el('buy').hidden = !open;
      if (!open) return;
      this.refreshBuy(s);
    },
    refreshBuy(s) {
      el('buy-money').textContent = fmtMoney(s.money);
      el('buy-timer').textContent = `DEPLOYS IN ${Math.max(0, Math.ceil(s.timeLeft))}s — ENTER TO DEPLOY EARLY`;
      for (const item of items) {
        const owned = item.id === 'armour' ? s.armour : item.id in GRENADES ? false : !!s.owned[item.id];
        const afford = s.money >= item.price;
        const maxed = item.id in GRENADES && s.grenades[item.id] >= 2;
        item.el.disabled = owned || !afford || maxed;
        const label = item.el.querySelector('.buy-label');
        label.textContent = item.label + (owned ? ' — OWNED' : maxed ? ` — ×${s.grenades[item.id]}` : '');
      }
    },
  };
}
