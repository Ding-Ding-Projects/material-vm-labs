'use strict';
// Two-key super confirmation for destructive actions. MVLSuperConfirm.ask({ action, affected, anchor })
// resolves true only after both keys are turned and the slider reaches the end; Emergency exit,
// Escape or a click outside resolve false. Focus returns to the originating control either way.
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const KEY_SVG = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7.5" cy="15.5" r="4.5"></circle><path d="m10.7 12.3 9.8-9.8M17 5l3 3M14 8l2 2"></path></svg>';

  function ask(opts) {
    const anchor = opts.anchor || document.activeElement;
    return new Promise((resolve) => {
      const id = 'sc' + Math.random().toString(36).slice(2, 7);
      const box = document.createElement('div');
      box.className = 'superconfirm';
      box.setAttribute('role', 'alertdialog'); box.setAttribute('aria-modal', 'true');
      box.setAttribute('aria-labelledby', id + 't'); box.setAttribute('aria-describedby', id + 'd');
      box.innerHTML = `<div class="sc-card">
  <span class="sc-over">Destructive action</span>
  <h2 id="${id}t">${window.MVLFunny ? window.MVLFunny.emojiHTML('destructive') : ''}${esc(opts.action)}</h2>
  <p id="${id}d" class="sc-affected">${window.MVLFunny ? window.MVLFunny.html('destructive', opts.affected) : esc(opts.affected)}</p>
  <p class="small">Turn both keys, then slide all the way to confirm. Nothing happens until you do.</p>
  <div class="sc-keys" role="group" aria-label="Safety keys">
    <button type="button" class="sc-key" data-key="1" aria-pressed="false">${KEY_SVG}<span>Key 1</span></button>
    <button type="button" class="sc-key" data-key="2" aria-pressed="false">${KEY_SVG}<span>Key 2</span></button>
  </div>
  <label class="sc-slide"><span>Slide to confirm</span><input type="range" min="0" max="100" step="1" value="0" disabled aria-valuetext="Locked until both keys are turned"></label>
  <div class="sc-meter" aria-hidden="true"><i></i></div>
  <p class="sc-status" role="status">Locked: no key turned.</p>
  <div class="row"><button type="button" class="btn danger" data-sc-exit>Emergency exit</button></div>
</div>`;
      const keys = [...box.querySelectorAll('.sc-key')], slider = box.querySelector('input[type=range]'), status = box.querySelector('.sc-status'), meter = box.querySelector('.sc-meter i');
      let done = false;
      function finish(ok) {
        if (done) return; done = true;
        box.classList.add(ok ? 'confirmed' : 'leaving');
        setTimeout(() => { box.remove(); if (anchor && anchor.isConnected) anchor.focus(); resolve(ok); }, ok ? (window.MVLMotion && window.MVLMotion.reduced() ? 0 : 700) : 0);
      }
      function sync() {
        const both = keys.every((k) => k.getAttribute('aria-pressed') === 'true');
        const n = keys.filter((k) => k.getAttribute('aria-pressed') === 'true').length;
        slider.disabled = !both;
        if (!both && slider.value !== '0') { slider.value = '0'; meter.style.width = '0%'; }
        slider.setAttribute('aria-valuetext', both ? `${slider.value} percent` : 'Locked until both keys are turned');
        status.textContent = !n ? 'Locked: no key turned.' : !both ? 'One key turned. Turn the other key too.' : +slider.value >= 100 ? 'Confirmed.' : `Both keys turned. Slide to the end to confirm (${slider.value}%).`;
        box.classList.toggle('armed', both);
      }
      keys.forEach((k) => k.addEventListener('click', () => { k.setAttribute('aria-pressed', String(k.getAttribute('aria-pressed') !== 'true')); sync(); }));
      slider.addEventListener('input', () => { meter.style.width = slider.value + '%'; box.style.setProperty('--sc-p', slider.value / 100); sync(); });
      slider.addEventListener('change', () => { if (+slider.value >= 100 && !slider.disabled) finish(true); else if (+slider.value < 100) { slider.value = '0'; meter.style.width = '0%'; sync(); } });
      box.querySelector('[data-sc-exit]').addEventListener('click', () => finish(false));
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
        if (e.key === 'Tab') { const f = [...box.querySelectorAll('button, input:not([disabled])')]; const i = f.indexOf(document.activeElement); if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); } }
      });
      box.addEventListener('mousedown', (e) => { if (e.target === box) finish(false); });
      document.body.append(box);
      if (window.MVLNarrator) window.MVLNarrator.say('destructive', opts.action + '. ' + opts.affected);
      // Anchor the card beside the control when there is room; otherwise it centres.
      const card = box.querySelector('.sc-card');
      if (anchor && anchor.getBoundingClientRect && innerWidth > 720) {
        const r = anchor.getBoundingClientRect(), c = card.getBoundingClientRect();
        box.classList.add('anchored');
        card.style.left = Math.max(16, Math.min(r.left, innerWidth - c.width - 16)) + 'px';
        card.style.top = Math.max(16, Math.min(r.bottom + 8, innerHeight - c.height - 16)) + 'px';
      }
      keys[0].focus();
      sync();
    });
  }
  window.MVLSuperConfirm = { ask };
})();
