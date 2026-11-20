'use strict';
// Front-screen provenance: the running version and when that build was made, with seconds and a
// labelled time zone, on each app's first screen. Both values come from the build's own metadata
// (generated/docs.json, written by companion/tools/prepare.mjs at build time), never from the
// launch time, a file date or the clock. Missing metadata shows an honest "unavailable" line.
//
// Placement: an element with [data-mvl-provenance] is filled when present; otherwise one line is
// added at the top of the first screen (.stage, main, then body).
// API: MVLProvenance.load() -> Promise<{ version, commit, updatedUtc, updatedKind, error }>,
//      MVLProvenance.formatLocal(isoString) -> "2026-11-20 14:03:05 UTC+08:00 (Asia/Hong_Kong)",
//      MVLProvenance.render(el).
(function () {
  let cached = null;
  const pad = (n) => String(n).padStart(2, '0');

  function formatLocal(iso) {
    const d = new Date(iso);
    if (!iso || Number.isNaN(d.getTime())) return null;
    const off = -d.getTimezoneOffset();
    const sign = off >= 0 ? '+' : '-';
    const zone = `UTC${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
    let name = '';
    try { name = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { name = ''; }
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${zone}${name ? ` (${name})` : ''}`;
  }

  function load() {
    if (cached) return cached;
    const src = window.mvlDocs && typeof window.mvlDocs.load === 'function' ? window.mvlDocs.load() : Promise.reject(new Error('This window has no build metadata service.'));
    cached = Promise.resolve(src).then((d) => {
      const version = d && typeof d.version === 'string' && /^\d+\.\d+\.\d+/.test(d.version) ? d.version : null;
      const commit = d && typeof d.commit === 'string' && /^[0-9a-f]{7,40}$/.test(d.commit) ? d.commit : null;
      // Prefer the commit time (when the source was updated); fall back to when the build was made.
      const updatedUtc = d && d.commitUtc ? d.commitUtc : d && d.generatedUtc ? d.generatedUtc : null;
      const updatedKind = d && d.commitUtc ? 'updated' : 'built';
      return { version, commit, updatedUtc, updatedKind, error: d && d.error ? String(d.error) : null };
    }).catch((e) => ({ version: null, commit: null, updatedUtc: null, updatedKind: 'built', error: e && e.message ? e.message : String(e) }));
    return cached;
  }

  // Fixed words sit in their own elements so the language switch can translate them; values stay literal.
  function parts(info) {
    const when = formatLocal(info.updatedUtc);
    if (!info.version && !when) return { ok: false, items: [['w', 'Version and build time unavailable: this build carries no version metadata.']] };
    const items = [['w', 'Version'], ['v', info.version || 'unavailable']];
    if (info.commit) items.push(['s', ' · '], ['w', 'commit'], ['v', info.commit.slice(0, 7)]);
    items.push(['s', ' · ']);
    if (when) items.push(['w', info.updatedKind === 'updated' ? 'Updated' : 'Built'], ['v', when]);
    else items.push(['w', 'Build time unavailable']);
    return { ok: !!(info.version && when), items };
  }
  const plain = (info) => parts(info).items.map(([, t]) => t).join(' ').replace(/ {2,}/g, ' ').replace(/ · /g, ' · ').trim();

  async function render(el) {
    if (!el) return;
    el.classList.add('mvl-provenance');
    el.textContent = 'Reading the version of this build…';
    const info = await load();
    const p = parts(info);
    el.replaceChildren(...p.items.map(([k, t]) => {
      const span = document.createElement('span');
      span.className = 'prov-' + k;
      span.textContent = t;
      if (k === 'v') span.setAttribute('data-i18n-skip', '');
      return span;
    }));
    el.dataset.state = p.ok ? 'ok' : 'unavailable';
    if (info.updatedUtc) el.title = `Recorded in the build as ${info.updatedUtc}`;
  }

  function place() {
    let el = document.querySelector('[data-mvl-provenance]');
    if (!el) {
      const host = document.querySelector('.stage') || document.querySelector('main') || document.body;
      if (!host) return;
      el = document.createElement('p');
      el.setAttribute('data-mvl-provenance', 'auto');
      host.prepend(el);
    }
    render(el);
  }

  window.MVLProvenance = { load, formatLocal, render, text: plain };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', place); else place();
})();
