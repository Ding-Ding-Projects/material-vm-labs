'use strict';
// Notification centre, action sounds and install takeovers.
//  - MVLNotify.push({ kind: 'info'|'success'|'error', title, body }) adds a non-blocking toast and
//    keeps the message in the centre (a bell button opens it) until it is cleared.
//  - MVLNotify.success({...}) / MVLNotify.failure({...}) show the full-screen install takeovers:
//    success celebrates and leaves on a click, Escape or after a few seconds; a failure stays until
//    it is dismissed. Both carry real values only. Settings can swap takeovers for notifications.
//  - Action sounds are short synthesized tones that obey the sound switch.
(function () {
  const KEY = 'mvl-notify';
  const PREF = 'mvl-notify-prefs';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = { get(k, d) { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage may be unavailable */ } } };
  let items = store.get(KEY, []);
  let prefs = Object.assign({ takeovers: true, sounds: true }, store.get(PREF, {}));
  const listeners = new Set();
  const emit = () => { store.set(KEY, items.slice(0, 200)); for (const f of listeners) { try { f(); } catch { /* ignore */ } } };

  // ---------- sounds ----------
  let ctx = null;
  function tone(kind) {
    if (!prefs.sounds) return;
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      const notes = kind === 'success' ? [523, 659, 784] : kind === 'error' ? [392, 311] : [660];
      notes.forEach((f, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + i * 0.11;
        o.type = kind === 'error' ? 'triangle' : 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.25);
      });
    } catch { /* audio unavailable: stay silent */ }
  }

  // ---------- centre ----------
  function push(n) {
    const item = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), kind: n.kind || 'info', title: String(n.title || ''), body: String(n.body || ''), at: new Date().toISOString(), read: false };
    items.unshift(item); emit();
    if (window.MVL && window.MVL.toast) window.MVL.toast(item.title + (item.body ? ': ' + item.body.split('\n')[0] : ''), item.kind);
    if (!n.silent) tone(item.kind);
    return item.id;
  }
  const unread = () => items.filter((i) => !i.read).length;

  function bell() {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'iconbtn notify-bell'; b.setAttribute('aria-haspopup', 'dialog');
    const draw = () => { const n = unread(); b.setAttribute('aria-label', n ? `Notifications, ${n} unread` : 'Notifications'); b.title = b.getAttribute('aria-label'); b.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"></path><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"></path></svg>' + (n ? `<span class="notify-badge" aria-hidden="true">${n > 99 ? '99+' : n}</span>` : ''); };
    listeners.add(draw); draw();
    b.addEventListener('click', openCentre);
    return b;
  }

  function openCentre() {
    let dlg = document.getElementById('notifyCentre');
    if (!dlg) {
      dlg = document.createElement('dialog'); dlg.id = 'notifyCentre'; dlg.className = 'm3-dialog side-sheet notify-centre'; dlg.setAttribute('aria-labelledby', 'notifyTitle');
      dlg.addEventListener('click', (e) => {
        if (e.target === dlg) dlg.close();
        const a = e.target.closest('[data-n-act]'); if (!a) return;
        if (a.dataset.nAct === 'close') dlg.close();
        if (a.dataset.nAct === 'read') { items.forEach((i) => { i.read = true; }); emit(); render(); }
        if (a.dataset.nAct === 'clear') { items = []; emit(); render(); }
        if (a.dataset.nAct === 'drop') { items = items.filter((i) => i.id !== a.dataset.id); emit(); render(); }
      });
      document.body.append(dlg);
    }
    function render() {
      dlg.innerHTML = `<div class="row"><h2 id="notifyTitle" class="grow">Notifications</h2><button type="button" class="iconbtn" data-n-act="close" aria-label="Close notifications">&times;</button></div>
<div class="row"><button type="button" class="btn sm" data-n-act="read" ${unread() ? '' : 'disabled'}>Mark all read</button><button type="button" class="btn sm danger" data-n-act="clear" ${items.length ? '' : 'disabled'}>Clear all</button></div>
${items.length ? `<ul class="notify-list">${items.map((i) => `<li class="notify-item ${i.read ? '' : 'unread'} k-${esc(i.kind)}"><span class="dot ${i.kind === 'success' ? 'lime' : i.kind === 'error' ? 'red' : 'cyan'}" aria-hidden="true"></span><div class="grow"><strong>${esc(i.title)}</strong>${i.body ? `<p>${esc(i.body)}</p>` : ''}<time datetime="${esc(i.at)}">${esc(new Date(i.at).toLocaleString())}</time></div><button type="button" class="iconbtn" data-n-act="drop" data-id="${esc(i.id)}" aria-label="Remove ${esc(i.title)}">&times;</button></li>`).join('')}</ul>` : '<p class="empty-note">No notifications yet. Finished and failed operations show up here.</p>'}`;
    }
    render();
    if (!dlg.open) dlg.showModal();
    items.forEach((i) => { i.read = true; }); emit();
  }

  // ---------- takeovers ----------
  let lastFocus = null;
  function fmtTime(ms) { if (!Number.isFinite(ms)) return 'not recorded'; const s = Math.round(ms / 1000); return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`; }
  function closeTakeover(el) {
    if (!el || !el.isConnected) return;
    el.classList.add('leaving');
    setTimeout(() => el.remove(), window.MVLMotion && window.MVLMotion.reduced() ? 0 : 320);
    if (lastFocus && lastFocus.isConnected) lastFocus.focus();
  }
  function takeover(kind, d) {
    if (!prefs.takeovers) return push({ kind: kind === 'success' ? 'success' : 'error', title: d.title, body: [d.command, d.code != null ? 'exit code ' + d.code : '', d.ms != null ? fmtTime(d.ms) : ''].filter(Boolean).join(' · ') });
    lastFocus = document.activeElement;
    const el = document.createElement('div');
    el.className = 'takeover ' + kind; el.setAttribute('role', kind === 'success' ? 'status' : 'alertdialog'); el.setAttribute('aria-modal', kind === 'success' ? 'false' : 'true');
    el.setAttribute('aria-labelledby', 'tk-title'); el.tabIndex = -1;
    const shapes = kind === 'success' ? Array.from({ length: 18 }, (_, i) => `<i class="tk-shape s${i % 6}" style="--a:${i * 20}deg;--d:${80 + (i % 5) * 34}px"></i>`).join('') : '';
    const facts = [['What', d.what], ['Where', d.where], ['Command', d.command], ['Exit code', d.code != null ? String(d.code) : 'not recorded'], ['Time taken', fmtTime(d.ms)]].filter(([, v]) => v);
    el.innerHTML = `<div class="tk-backdrop" aria-hidden="true">${shapes}</div>
<div class="tk-card">
  <span class="tk-icon" aria-hidden="true">${kind === 'success' ? '<svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg>' : '<svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01"></path><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"></path></svg>'}</span>
  <span class="tk-over">${kind === 'success' ? 'Install finished' : 'Install stopped'}</span>
  <h2 id="tk-title">${window.MVLFunny ? window.MVLFunny.emojiHTML('takeover-' + kind) + window.MVLFunny.html(kind === 'success' ? 'success' : 'error', d.title) : esc(d.title)}</h2>
  <dl class="kv tk-facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd${k === 'Command' ? ' class="mono"' : ''}>${esc(v)}</dd>`).join('')}</dl>
  ${kind === 'failure' && d.lines && d.lines.length ? `<pre class="log tk-log" aria-label="Last lines of output">${esc(d.lines.join('\n'))}</pre>` : ''}
  <div class="row tk-actions">${kind === 'failure' ? `${d.onRetry ? '<button type="button" class="btn primary" data-tk="retry">Retry</button>' : ''}${d.onOpenLog ? '<button type="button" class="btn" data-tk="log">Open the full log</button>' : ''}<button type="button" class="btn light" data-tk="close">Dismiss</button>` : '<button type="button" class="btn primary" data-tk="close">Keep going</button><span class="small">Closes by itself in a few seconds.</span>'}</div>
</div>`;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tk]');
      if (b && b.dataset.tk === 'retry') { closeTakeover(el); d.onRetry(); }
      else if (b && b.dataset.tk === 'log') d.onOpenLog();
      else if (b && b.dataset.tk === 'close') closeTakeover(el);
      else if (kind === 'success' && !e.target.closest('.tk-card')) closeTakeover(el);
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeTakeover(el); }
      if (e.key === 'Tab' && kind === 'failure') { const f = [...el.querySelectorAll('button')]; if (!f.length) return; const i = f.indexOf(document.activeElement); if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); } }
    });
    document.body.append(el);
    if (window.MVLNarrator) window.MVLNarrator.say(kind === 'success' ? 'success' : 'error', d.title);
    requestAnimationFrame(() => el.classList.add('in'));
    (el.querySelector('[data-tk]') || el).focus();
    tone(kind === 'success' ? 'success' : 'error');
    push({ kind: kind === 'success' ? 'success' : 'error', title: d.title, body: [d.command, d.code != null ? 'exit code ' + d.code : ''].filter(Boolean).join(' · '), silent: true });
    if (kind === 'success') setTimeout(() => closeTakeover(el), 6000);
    return el;
  }

  // Settings: takeovers on or off, sounds on or off.
  function control() {
    const box = document.createElement('div');
    box.className = 'notify-control';
    box.innerHTML = `<label class="switch-row"><span>Full-screen install celebrations and alarms<br><span class="small">Off shows a notification instead.</span></span><input type="checkbox" role="switch" data-p="takeovers"></label>
<label class="switch-row"><span>Action sounds</span><input type="checkbox" role="switch" data-p="sounds"></label>
<div class="row"><button type="button" class="btn sm" data-demo="success">Preview the celebration</button><button type="button" class="btn sm" data-demo="failure">Preview the alarm</button></div>`;
    const sync = () => { for (const i of box.querySelectorAll('[data-p]')) i.checked = !!prefs[i.dataset.p]; };
    box.addEventListener('change', (e) => { const p = e.target.dataset.p; if (!p) return; prefs[p] = e.target.checked; store.set(PREF, prefs); });
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-demo]'); if (!b) return;
      const sample = { title: 'Preview: nothing was installed', what: 'Example only', where: 'Example only', command: 'mvl install example --file Setup.exe', code: b.dataset.demo === 'success' ? 0 : 1603, ms: 42000, lines: ['Example output line 1', 'Example output line 2'] };
      takeover(b.dataset.demo, sample);
    });
    sync();
    return box;
  }

  window.MVLNotify = { push, success: (d) => takeover('success', d), failure: (d) => takeover('failure', d), bell, openCentre, control, tone, onChange: (f) => listeners.add(f), list: () => items.slice() };
})();
