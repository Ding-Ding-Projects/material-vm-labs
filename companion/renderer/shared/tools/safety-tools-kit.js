'use strict';
// Safety tools kit: small helpers shared by the authenticator, QR pairing, toy locks, unlock ladder
// and Support Tickets. Talks to the main process through window.mvlSafety when the preload exposes
// it, and says plainly what is unavailable when it does not.
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const bridge = () => (window.mvlSafety && typeof window.mvlSafety.info === 'function' ? window.mvlSafety : null);
  const NO_BRIDGE = 'The desktop app\'s main process is not connected in this window.';

  const store = {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch { /* storage may be unavailable */ } }
  };

  let infoP = null;
  function info() {
    if (!infoP) {
      const b = bridge();
      infoP = b ? b.info().then((r) => (r && r.ok ? r : { ok: false, error: (r && r.error) || 'No answer.' }), (e) => ({ ok: false, error: e.message })) : Promise.resolve({ ok: false, error: NO_BRIDGE });
    }
    return infoP;
  }
  // Where the recovery folder is, as text: the exact path, or why it is not known here.
  async function appData() { const i = await info(); return i.ok ? { ok: true, path: i.appData } : { ok: false, reason: i.error }; }

  // Credential vault: the operating-system store through the main process, else local storage
  // with the reason stated. Values are strings.
  const LOCAL = 'mvl-safety-local:';
  async function vaultWhere() {
    const i = await info();
    if (i.ok && i.vault && i.vault.available) return { where: 'vault', text: 'Kept in the operating-system credential store.' };
    const why = i.ok ? (i.vault && i.vault.reason) || 'The credential store is not available.' : i.error;
    return { where: 'local', text: 'Kept in this app\'s local storage, because the operating-system credential store is not reachable here: ' + why };
  }
  const vault = {
    async get(key) {
      if ((await vaultWhere()).where === 'vault') { const r = await bridge().vaultGet(key); if (!r.ok) throw new Error(r.error); return r.value; }
      try { return localStorage.getItem(LOCAL + key); } catch { throw new Error('Local storage is not available.'); }
    },
    async set(key, value) {
      if ((await vaultWhere()).where === 'vault') { const r = await bridge().vaultSet(key, value); if (!r.ok) throw new Error(r.error); return; }
      try { localStorage.setItem(LOCAL + key, value); } catch { throw new Error('Local storage is not available.'); }
    },
    async del(key) {
      if ((await vaultWhere()).where === 'vault') { await bridge().vaultDelete(key); return; }
      try { localStorage.removeItem(LOCAL + key); } catch { /* nothing to remove */ }
    }
  };

  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type: type || 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = name; a.hidden = true;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  async function copy(text, okMsg) {
    let ok = false;
    try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(String(text)); ok = true; } } catch { ok = false; }
    if (!ok) {
      const t = document.createElement('textarea'); t.value = String(text); t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.append(t); t.select();
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      t.remove();
    }
    if (window.MVL) window.MVL.toast(ok ? (okMsg || 'Copied') : 'Copying was blocked here. Select the text and copy it yourself.', ok ? 'success' : 'warning');
    return ok;
  }
  const funny = (cat, text) => (window.MVLFunny ? window.MVLFunny.style(cat, text) : text);
  // School mode comes from the personal lane's MVLSchool when present, else the root data attribute.
  const school = () => { try { if (window.MVLSchool && typeof window.MVLSchool.active === 'function') return !!window.MVLSchool.active(); } catch { /* fall through */ } const v = document.documentElement.dataset.schoolMode; return v === 'on' || v === 'true'; };
  const reduced = () => (window.MVLMotion && window.MVLMotion.reduced ? window.MVLMotion.reduced() : document.documentElement.dataset.reduceMotion === 'true' || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches));
  const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

  // A non-modal panel anchored beside an element. Escape or close() removes it and returns focus.
  function popover(anchor, opts) {
    const o = opts || {};
    const el = document.createElement('section');
    el.className = 'sf-pop lk-surface' + (o.className ? ' ' + o.className : '');
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'false');
    if (o.label) el.setAttribute('aria-label', o.label);
    const host = (anchor && anchor.closest && anchor.closest('dialog[open]')) || document.body;
    host.append(el);
    let closed = false;
    function place() {
      if (!anchor || !anchor.isConnected || innerWidth <= 560) { el.classList.add('sf-pop-sheet'); el.style.left = ''; el.style.top = ''; return; }
      el.classList.remove('sf-pop-sheet');
      const r = anchor.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
      let top = r.bottom + 8; if (top + h > innerHeight - 12) top = Math.max(12, r.top - h - 8);
      el.style.left = Math.max(12, Math.min(r.left, innerWidth - w - 12)) + 'px';
      el.style.top = Math.max(12, Math.min(top, innerHeight - h - 12)) + 'px';
    }
    function close(silent) {
      if (closed) return; closed = true;
      el.remove(); removeEventListener('resize', place);
      if (o.onClose) o.onClose();
      if (!silent && anchor && anchor.isConnected && anchor.focus) anchor.focus();
    }
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } });
    addEventListener('resize', place);
    return { el, close, place, get closed() { return closed; } };
  }

  // Accessible name of any element, for lock targets and messages.
  function nameOf(el) {
    if (!el || el.nodeType !== 1) return 'this element';
    const l = el.getAttribute('aria-label') || el.getAttribute('title');
    if (l) return l.trim().slice(0, 80);
    if (el.labels && el.labels[0]) return el.labels[0].textContent.trim().slice(0, 80);
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (t) return t.slice(0, 80);
    return el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(/\s+/)[0] : '');
  }

  // Super confirmation from inside the modal Tools window. superconfirm.js appends its overlay to
  // <body>, which a modal <dialog> makes inert; move it into the topmost open dialog so both keys
  // and the slider can be operated, then give focus back to its first key.
  function confirm(ctx, opts) {
    const before = new Set(document.querySelectorAll('.superconfirm'));
    const p = ctx.confirm(opts);
    const box = [...document.querySelectorAll('.superconfirm')].find((x) => !before.has(x));
    const dlg = [...document.querySelectorAll('dialog[open]')].pop();
    if (box && dlg && !dlg.contains(box)) { dlg.append(box); const k = box.querySelector('.sc-key'); if (k) k.focus(); }
    return p;
  }

  const SAFETY_DISCLOSURE = 'Nothing here is sent anywhere. No ticket exists outside this computer, no network request is made, no data is collected, and nobody is reading it.';
  const TOY = 'Just for fun, not security. A toy lock is not encryption and does not protect anything from someone else using this computer.';

  window.MVLSafety = Object.assign(window.MVLSafety || {}, { esc, bridge, NO_BRIDGE, store, info, appData, vault, vaultWhere, download, copy, funny, school, reduced, mmss, popover, nameOf, confirm, SAFETY_DISCLOSURE, TOY });
})();
