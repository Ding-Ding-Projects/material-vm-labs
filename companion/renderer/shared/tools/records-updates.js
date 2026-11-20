'use strict';
// Updates tool and the update-ready banner. Everything that touches the network, the disk or the
// installer runs in the main process (companion/src/shared/updates-ipc.js) behind window.mvlUpdates;
// this file only shows the state it is given and sends the person's choices back.
//  - The Updates tool: the running version, the update state, Check for updates, the automatic
//    updates switch and "Update coming soon" with the in-flight build's real stages.
//  - The banner: a persistent, non-blocking region shown when an update is staged, naming the
//    version, linking the release notes, saying plainly that the update is unsigned, and offering
//    "Restart to install update" and "Later". Nothing restarts without that choice.
//  - MVLUpdates.addUnsavedCheck(fn): fn() returns a description of unsaved work or nothing; any
//    answer makes the restart ask for confirmation first.
(function () {
  const api = window.mvlUpdates || null;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const unsavedChecks = new Set();
  const listeners = new Set();
  let state = null;
  let bannerEl = null;
  let lastFocus = null;
  let lastRunning = '';
  let lastBannerKey = '';
  const pad = (n) => String(n).padStart(2, '0');

  // 24-hour local time with seconds.
  function clock(iso) {
    const d = new Date(iso);
    if (!iso || Number.isNaN(d.getTime())) return '';
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
  function stamp(iso) {
    if (window.MVLProvenance) return window.MVLProvenance.formatLocal(iso) || '';
    return clock(iso);
  }
  function duration(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '';
    const s = Math.round(ms / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return h ? `${h} h ${pad(m)} min` : m ? `${m} min ${pad(r)} s` : `${r} s`;
  }
  const mb = (n) => (Number(n) / 1048576).toFixed(1);
  const versionLabel = (o) => (o ? `${o.version}${o.build ? ` (build ${o.build})` : ''}` : '');

  // ---------- unsaved work ----------
  function unsavedWork() {
    const out = [];
    for (const fn of unsavedChecks) { try { const r = fn(); if (r) out.push(String(r)); } catch { /* a broken check never blocks the person */ } }
    return out;
  }
  async function confirm(action, affected) {
    if (window.MVLSuperConfirm) return window.MVLSuperConfirm.ask({ action, affected });
    return window.confirm(`${action}\n${affected}`);
  }

  async function restart() {
    if (!api) return;
    const work = unsavedWork();
    if (work.length && !(await confirm('Restart to install the update with unsaved work', `This will close: ${work.join('; ')}`))) return;
    let r = await api.restart({});
    if (r && r.needsConfirm === 'jobs') {
      const ok = await confirm('Cancel running jobs and restart to install the update', r.reason || `${r.jobs} running job(s) will be cancelled and recorded as incomplete.`);
      if (!ok) { set(r); return; }
      r = await api.restart({ confirmedJobs: true });
    }
    set(r);
  }
  function later() {
    if (!api) return;
    api.later().then(set);
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  }

  // ---------- state text ----------
  function describe(s) {
    const o = s.offer;
    switch (s.status) {
      case 'idle': return { title: 'Not checked yet', body: s.auto ? 'The first check runs shortly after the app starts.' : 'Automatic checks are off. Use Check for updates.' };
      case 'checking': return { title: 'Checking for updates…', body: 'Reading the latest release from GitHub.' };
      case 'none': return { title: 'You have the latest version', body: s.note || '' };
      case 'available': return { title: `Version ${versionLabel(o)} is available`, body: s.auto ? 'It downloads in the background and is checked before it is offered.' : 'Automatic downloads are off. Download it when you are ready.' };
      case 'downloading': return { title: `Downloading version ${versionLabel(o)}`, body: s.total ? `${mb(s.received || 0)} of ${mb(s.total)} MB. You can keep working.` : 'Starting the download.' };
      case 'ready': return { title: `Version ${versionLabel(o)} is ready to install`, body: 'It was checked against the SHA-256 hash in the release notes and the installer feed.' };
      case 'restarting': return { title: 'Installing the update', body: 'The app restarts by itself when the installer has finished.' };
      case 'offline': return { title: 'Offline', body: `Could not reach GitHub, so nothing changed. ${s.reason || ''}`.trim() };
      case 'invalid': return { title: 'Update refused: its details did not check out', body: `Nothing was installed. ${s.reason || ''}`.trim() };
      case 'corrupt': return { title: 'The download was damaged', body: `Nothing was installed. ${s.reason || ''}`.trim() };
      case 'cancelled': return { title: 'Download cancelled', body: 'Nothing was installed.' };
      case 'rolledback': return { title: 'The update was not applied; this version stays', body: s.reason || '' };
      case 'unsupported': return { title: o ? `Version ${versionLabel(o)} is available, but this copy cannot update itself` : 'This copy cannot update itself', body: s.reason || '' };
      case 'blocked': return { title: `Version ${versionLabel(o)} cannot be applied automatically`, body: s.reason || '' };
      case 'error': return { title: 'The update check failed', body: s.reason || '' };
      default: return { title: s.status, body: '' };
    }
  }
  function actions(s) {
    const b = [];
    if (['idle', 'none', 'offline', 'invalid', 'corrupt', 'cancelled', 'rolledback', 'error', 'unsupported', 'blocked', 'available'].includes(s.status)) b.push(['check', 'Check for updates', '']);
    if (s.squirrel && ['available', 'cancelled', 'corrupt', 'offline'].includes(s.status) && s.offer) b.unshift(['download', s.status === 'available' ? 'Download update' : 'Download again', 'primary']);
    if (s.status === 'downloading') b.push(['cancel', 'Cancel download', '']);
    if (s.status === 'ready') b.push(['restart', 'Restart to install update', 'primary'], ['later', 'Later', '']);
    if (s.offer) b.push(['notes', 'Release notes', '']);
    return b;
  }

  // ---------- coming soon ----------
  const STATE_WORD = { waiting: 'Waiting', running: 'Running', done: 'Done', failed: 'Failed', skipped: 'Skipped' };
  function comingHtml(s) {
    const c = s.coming;
    const info = s.comingInfo || {};
    if (!c) {
      if (info.status === 'offline') return `<section class="ru-coming" aria-labelledby="ruComingT"><h3 id="ruComingT">Update coming soon</h3><p class="ru-muted">Build progress is unknown while offline. ${esc(info.reason || '')}</p></section>`;
      if (info.status === 'unknown') return `<section class="ru-coming" aria-labelledby="ruComingT"><h3 id="ruComingT">Update coming soon</h3><p class="ru-muted">Build progress is unknown. ${esc(info.reason || '')}</p></section>`;
      return ''; // no build in flight: the block is absent, not empty
    }
    const phase = {
      building: c.stalled ? 'Taking much longer than usual; it may be stalled.' : 'Being built now.',
      publishing: 'Built. Waiting for the release to be published.',
      failed: 'This build failed, so it will not be offered. The version you have keeps working.',
      replaced: 'A newer build replaced this one.',
      unknown: 'Its state is unknown.'
    }[c.phase] || '';
    const doneN = c.stages.filter((x) => x.state === 'done' || x.state === 'skipped').length;
    const total = c.stages.length;
    const est = c.estimate ? `<p class="ru-est"><strong>Estimate:</strong> about ${esc(duration(c.estimate.leftMs))} left, from the median of the last ${esc(c.estimate.from)} successful builds (${esc(duration(c.estimate.typicalMs))}). It is an estimate, not a promise.</p>` : (c.phase === 'building' ? '<p class="ru-est"><strong>Estimate:</strong> not available yet: there are no earlier successful builds to compare with.</p>' : '');
    const stages = c.stages.map((x) => `<li class="ru-stage" data-state="${esc(x.state)}"><span class="ru-dot" aria-hidden="true"></span><span class="ru-sname">${esc(x.name)}</span><span class="ru-sstate">${esc(STATE_WORD[x.state] || x.state)}</span></li>`).join('');
    const contains = (c.contains || []).length ? `<details class="ru-contains"><summary>What it will contain (${c.contains.length})</summary><ul>${c.contains.map((m) => `<li data-i18n-skip>${esc(m)}</li>`).join('')}</ul></details>` : '';
    return `<section class="ru-coming" aria-labelledby="ruComingT" data-phase="${esc(c.phase)}">
      <h3 id="ruComingT">Update coming soon: build ${esc(c.build)}</h3>
      <p class="ru-phase">${esc(phase)}${c.replacedFrom ? ` It replaced build ${esc(c.replacedFrom)}.` : ''}</p>
      <dl class="kv ru-kv"><dt>Started</dt><dd data-i18n-skip>${esc(stamp(c.startedAt) || 'not started yet')}</dd><dt>Running for</dt><dd data-i18n-skip data-ru-elapsed="${esc(c.startedAt || '')}">${esc(c.elapsedMs != null ? duration(c.elapsedMs) : '')}</dd></dl>
      ${est}
      <div class="ru-bar" role="progressbar" aria-label="Build stages finished" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${doneN}" aria-valuetext="${doneN} of ${total} stages finished"><span style="--ru-p:${total ? doneN / total : 0}"></span></div>
      <ol class="ru-stages" aria-label="Build stages">${stages}</ol>
      ${contains}
      <p class="ru-muted">Read from the public GitHub Actions record${info.checkedAt ? ` at ${esc(clock(info.checkedAt))}` : ''}. Nothing is downloaded or installed until the build is published.</p>
      <div class="ru-actions"><button type="button" class="btn" data-ru="coming-refresh">Refresh build progress</button>${c.url ? '<button type="button" class="btn" data-ru="open-build">Open the build on GitHub</button>' : ''}</div>
    </section>`;
  }

  // ---------- tool view ----------
  let mounted = null;
  function toolHtml(s) {
    const d = describe(s);
    const pct = s.status === 'downloading' && s.total ? Math.min(100, Math.round(((s.received || 0) / s.total) * 100)) : null;
    const contains = s.offer && Array.isArray(s.offer.commits) && s.offer.commits.length ? `<details class="ru-contains"><summary>What changed (${s.offer.commits.length})</summary><ul>${s.offer.commits.map((m) => `<li data-i18n-skip>${esc(m)}</li>`).join('')}</ul></details>` : '';
    return `
      <p class="mvl-provenance-host" data-ru-prov></p>
      <section class="card ru-card" aria-labelledby="ruStateT" data-status="${esc(s.status)}">
        <h3 id="ruStateT">${esc(d.title)}</h3>
        ${d.body ? `<p>${esc(d.body)}</p>` : ''}
        ${pct !== null ? `<div class="ru-bar" role="progressbar" aria-label="Download" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="--ru-p:${pct / 100}"></span></div>` : ''}
        ${s.status === 'ready' || s.offer ? '<p class="warn ru-unsigned">Unsigned update: the files are not code-signed, so Windows cannot confirm who published them and may show an unknown-publisher warning. Integrity is checked with HTTPS and the published SHA-256 and SHA-1 hashes.</p>' : ''}
        ${contains}
        ${s.checkedAt ? `<p class="ru-muted">Last checked ${esc(stamp(s.checkedAt))}.</p>` : ''}
        <div class="ru-actions">${actions(s).map(([k, label, cls]) => `<button type="button" class="btn ${cls}" data-ru="${k}">${esc(label)}</button>`).join('')}</div>
      </section>
      <div class="switch-row ru-switch"><label for="ruAuto">Check for and download updates automatically<span class="ru-muted"> Checks at startup and every 4 hours. Installing always waits for you.</span></label><input type="checkbox" role="switch" id="ruAuto" ${s.auto ? 'checked' : ''}></div>
      ${comingHtml(s)}
      <p class="ru-sr" aria-live="polite" data-ru-live></p>`;
  }
  function unavailableHtml() {
    return `<p class="mvl-provenance-host" data-ru-prov></p><section class="card ru-card" data-status="unavailable"><h3>Updates are unavailable in this window</h3><p>This window is not connected to the update service, so it cannot check, download or install anything. Updates run in the installed manager app.</p></section>`;
  }
  function paint() {
    if (!mounted) return;
    const focusKey = document.activeElement && mounted.contains(document.activeElement) ? (document.activeElement.dataset.ru || document.activeElement.id) : null;
    const live = mounted.querySelector('[data-ru-live]');
    const liveText = live ? live.textContent : '';
    mounted.innerHTML = api && state ? toolHtml(state) : unavailableHtml();
    const prov = mounted.querySelector('[data-ru-prov]');
    if (prov && window.MVLProvenance) window.MVLProvenance.render(prov);
    const nl = mounted.querySelector('[data-ru-live]'); if (nl) nl.textContent = liveText;
    if (focusKey) { const f = mounted.querySelector(`[data-ru="${focusKey}"]`) || mounted.querySelector(`#${CSS.escape(focusKey)}`); if (f) f.focus(); }
  }
  function onClick(e) {
    const b = e.target.closest('[data-ru]');
    if (!b || !api) return;
    lastFocus = b;
    const k = b.dataset.ru;
    if (k === 'check') api.check().then(set);
    else if (k === 'download') api.download().then(set);
    else if (k === 'cancel') api.cancel().then(set);
    else if (k === 'restart') restart();
    else if (k === 'later') later();
    else if (k === 'notes') api.openNotes();
    else if (k === 'coming-refresh') api.refreshComing().then(set);
    else if (k === 'open-build') api.openBuild();
  }
  function onChange(e) {
    if (e.target.id === 'ruAuto' && api) api.setAuto(!!e.target.checked).then(set);
  }

  // ---------- banner ----------
  function paintBanner() {
    const s = state;
    const show = !!(api && s && (s.status === 'ready' || s.status === 'restarting') && !s.dismissed);
    if (!show) { if (bannerEl) { bannerEl.remove(); bannerEl = null; lastBannerKey = ''; } return; }
    const key = `${s.status}|${s.offer && s.offer.tag}|${s.reason || ''}`;
    if (bannerEl && key === lastBannerKey) return;
    const first = !bannerEl;
    if (!bannerEl) {
      bannerEl = document.createElement('section');
      bannerEl.className = 'ru-banner';
      bannerEl.setAttribute('role', 'region');
      bannerEl.setAttribute('aria-labelledby', 'ruBannerT');
      bannerEl.addEventListener('click', (e) => { const b = e.target.closest('[data-ru]'); if (!b) return; if (b.dataset.ru === 'restart') restart(); else if (b.dataset.ru === 'later') later(); else if (b.dataset.ru === 'notes') api.openNotes(); });
      document.body.append(bannerEl);
      lastFocus = document.activeElement;
    }
    lastBannerKey = key;
    const busy = s.status === 'restarting';
    bannerEl.innerHTML = `
      <div class="ru-banner-text">
        <h2 id="ruBannerT">Update ready: version ${esc(versionLabel(s.offer))}</h2>
        <p>Unsigned update: it is not code-signed, so Windows cannot confirm who published it. It was checked against the release's published SHA-256 hash before it was staged.</p>
        ${s.reason ? `<p class="ru-reason" role="alert">${esc(s.reason)}</p>` : ''}
      </div>
      <div class="ru-banner-actions">
        <button type="button" class="btn" data-ru="notes">Release notes</button>
        <button type="button" class="btn" data-ru="later" ${busy ? 'disabled' : ''}>Later</button>
        <button type="button" class="btn primary" data-ru="restart" ${busy ? 'disabled aria-busy="true"' : ''}>${busy ? 'Installing…' : 'Restart to install update'}</button>
      </div>`;
    if (first) announce(`Update ready: version ${versionLabel(s.offer)}. Restart to install update, or Later.`);
  }

  let liveRegion = null;
  function announce(msg) {
    if (!liveRegion) { liveRegion = document.createElement('p'); liveRegion.className = 'ru-sr'; liveRegion.setAttribute('aria-live', 'polite'); document.body.append(liveRegion); }
    liveRegion.textContent = '';
    setTimeout(() => { liveRegion.textContent = msg; }, 50);
  }

  function set(s) {
    if (!s) return;
    const prevComing = state && state.coming;
    const prevStatus = state && state.status;
    state = s;
    const running = s.coming && s.coming.stages ? (s.coming.stages.find((x) => x.state === 'running') || {}).name || '' : '';
    if (s.coming && running !== lastRunning) { if (running) announce(`Build ${s.coming.build}: ${running} is running.`); lastRunning = running; }
    if (prevComing && !s.coming && s.status === 'available' && window.MVLNotify) window.MVLNotify.push({ kind: 'info', title: 'Update published', body: `Version ${versionLabel(s.offer)} is now available.` });
    if (prevStatus && prevStatus !== s.status && ['offline', 'invalid', 'corrupt', 'rolledback', 'error'].includes(s.status)) announce(describe(s).title);
    paint();
    paintBanner();
    for (const f of listeners) { try { f(s); } catch { /* listener errors stay local */ } }
  }

  // Elapsed time ticks from the recorded start; stages only change when the record changes.
  setInterval(() => {
    if (!mounted) return;
    for (const el of mounted.querySelectorAll('[data-ru-elapsed]')) { const t = Date.parse(el.dataset.ruElapsed); if (Number.isFinite(t)) el.textContent = duration(Date.now() - t); }
  }, 1000);

  if (api) {
    api.state().then(set).catch(() => {});
    if (typeof api.onState === 'function') api.onState(set);
  }

  function mount(el) {
    mounted = el;
    el.classList.add('ru-tool');
    el.addEventListener('click', onClick);
    el.addEventListener('change', onChange);
    paint();
  }
  function unmount() { if (mounted) { mounted.removeEventListener('click', onClick); mounted.removeEventListener('change', onChange); } mounted = null; }

  if (window.MVLTools) window.MVLTools.register({ id: 'updates', title: 'Updates', group: 'App', summary: 'Check for updates, install a staged update and see a build that is on its way.', mount, unmount });
  if (window.MVLPalette && api) window.MVLPalette.register({ id: 'updates-check', title: 'Check for updates', group: 'App', keywords: ['update', 'version', 'release'], run: () => { api.check().then(set); if (window.MVLTools) window.MVLTools.open('updates'); } });

  window.MVLUpdates = {
    addUnsavedCheck: (fn) => { if (typeof fn === 'function') unsavedChecks.add(fn); return () => unsavedChecks.delete(fn); },
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    state: () => state,
    check: () => (api ? api.check().then(set) : Promise.resolve(null))
  };
})();
