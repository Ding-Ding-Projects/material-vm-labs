'use strict';
// Dim sum surprise, page side. Each launch draws once: a 10% chance of a small, non-blocking card
// with a dish from the public dim-sum catalogue, named in English and Cantonese, that leaves on
// its own. It never shows during first-run setup, never takes focus and never delays the app.
// Settings carries a "Dim sum surprise" switch that cannot be turned off: it slides back on and
// says so, and nothing is ever stored as off.
(function () {
  const CHANCE = 0.1;
  let drawn = false;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const firstRun = () => { try { return Object.keys(localStorage).some((k) => /^mvl\.onboarding\./.test(k) && !/"done"\s*:\s*true|"completed"\s*:\s*true/.test(localStorage.getItem(k) || '')); } catch { return false; } };
  const busy = () => !!document.querySelector('dialog[open], .takeover, .superconfirm, .scrim');

  function announce(text) {
    let live = document.getElementById('dimsum-live');
    if (!live) { live = document.createElement('div'); live.id = 'dimsum-live'; live.className = 'sr'; live.setAttribute('aria-live', 'polite'); document.body.append(live); }
    live.textContent = ''; setTimeout(() => { live.textContent = text; }, 50);
  }

  async function show(force) {
    if (!window.mvlDimsum || !window.mvlDimsum.pick) return false;
    if (!force && (busy() || firstRun())) return false;
    const dish = await window.mvlDimsum.pick();
    if (!dish) return false;
    const mode = window.MVLI18n ? window.MVLI18n.mode() : 'en';
    const name = mode === 'yue' ? `${dish.zhHant} · ${dish.en}` : `${dish.en} · ${dish.zhHant}`;
    const lead = window.MVLFunny ? window.MVLFunny.style('info', 'A dim sum surprise', { lang: mode === 'yue' ? 'yue' : 'en' }) : 'A dim sum surprise';
    const card = document.createElement('aside');
    card.className = 'dimsum-card'; card.setAttribute('aria-label', 'Dim sum surprise');
    card.innerHTML = `<img src="${dish.dataUrl}" alt="${esc(mode === 'yue' && dish.altYue ? dish.altYue : dish.altEn)}" width="72" height="72"><div><span class="dimsum-over" data-i18n-skip>${esc(lead)}</span><strong data-i18n-skip data-vocab-skip>${esc(name)}</strong></div><button type="button" class="iconbtn" aria-label="Close the dim sum surprise">&times;</button>`;
    card.querySelector('button').addEventListener('click', () => card.remove());
    document.body.append(card);
    requestAnimationFrame(() => card.classList.add('in'));
    announce(`Dim sum surprise: ${dish.en}, ${dish.zhHant}`);
    setTimeout(() => { card.classList.remove('in'); setTimeout(() => card.remove(), 400); }, 7000);
    return true;
  }

  // The once-per-launch draw, a little after the app is usable.
  function draw() {
    if (drawn) return; drawn = true;
    if (Math.random() >= CHANCE) return;
    setTimeout(() => show(false), 2500);
  }

  function control() {
    const box = document.createElement('div');
    box.className = 'dimsum-control';
    box.innerHTML = '<label class="switch-row"><span>Dim sum surprise<br><span class="small">Now and then a dish from the public dim sum catalogue says hello at startup.</span></span><input type="checkbox" role="switch" checked data-dimsum-switch></label><p class="small" role="status" data-dimsum-msg></p>';
    const sw = box.querySelector('[data-dimsum-switch]'), msg = box.querySelector('[data-dimsum-msg]');
    sw.addEventListener('change', () => {
      if (sw.checked) return;
      setTimeout(() => { sw.checked = true; }, 350);
      const text = 'Nice try. Dim sum surprise cannot be turned off.';
      msg.textContent = window.MVLFunny ? window.MVLFunny.style('info', text) : text;
    });
    return box;
  }

  if (document.readyState === 'complete') draw(); else window.addEventListener('load', draw);
  window.MVLDimsum = { show: () => show(true), control, chance: CHANCE };
})();
