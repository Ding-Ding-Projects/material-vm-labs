'use strict';
// Fresh-host builds: real Build, Build and run, and Build installer over the root build.bat and build-installer.bat.
// Used by the standalone Build exe and by the Build tab of the manager.
(function () {
  const { esc, ring } = window.MVL;
  const ACTIONS = [['build', 'Build'], ['run', 'Build and run'], ['installer', 'Installer']];
  const HELP = {
    build: 'Runs build.bat /s.',
    run: 'Runs build.bat /s, then opens mvl.bat tui in a new console.',
    installer: 'Runs build-installer.bat /s and makes an unsigned Squirrel.Windows installer.'
  };

  function mount(root, api, opts) {
    opts = opts || {};
    const rail = opts.rail || null; // opt-in standalone layout: rail owned by the standalone page
    const cellsEl = rail && rail.querySelector('.cells'), gaugeEl = rail && rail.querySelector('.gauge');
    const phaseCells = [];
    let action = 'build', timer = null, startedAt = 0, activePhase = null, lines = 0, running = false;
    const standalone = `<div class="bsa">
  <header class="bhead">
    <span class="over" data-eyebrow></span>
    <h1 data-title></h1>
    <p class="sub" data-sub></p>
    <div class="bbtns"><button type="button" class="btn primary xl" data-go>Start</button><button type="button" class="btn danger" data-cancel disabled>Cancel</button><button type="button" class="btn sm" data-folder>Open dist folder</button></div>
    <p class="small" data-help></p>
  </header>
  <div class="bcols">
    <section class="bphases" aria-label="Phases"><h2>Phases</h2><ol class="phases" aria-label="Build phases"><li class="empty-note">Phases appear here as the build reports them.</li></ol>
      <p class="small mono" data-source>Looking for the checkout&hellip;</p><p class="small" data-embedded></p></section>
    <section class="blive" aria-label="Live output"><div class="row"><span class="chipst" data-verdict>Idle</span><span class="small mono" data-timer></span><span class="small mono" data-exit></span></div>
      <div class="bar" role="progressbar" aria-label="Build activity" aria-valuetext="idle"><i></i></div>
      <pre class="log" tabindex="0" role="log" aria-live="off" data-log></pre></section>
  </div>
</div>`;
    root.innerHTML = rail ? standalone : `<div class="bbay">
  <section class="left" aria-label="Actions and phases">
    <div class="seg" role="group" aria-label="Build action">${ACTIONS.map(([id, l]) => `<button type="button" data-act="${id}" aria-pressed="${id === action}">${l}</button>`).join('')}</div>
    <button type="button" class="btn primary xl" data-go>Start</button>
    <p class="small" data-help></p>
    <ol class="phases" aria-label="Build phases"><li class="empty-note">Phases appear here as the build reports them.</li></ol>
    <div class="row"><button type="button" class="btn sm" data-folder>Open dist folder</button></div>
    <p class="small mono" data-source>Looking for the checkout&hellip;</p>
    <p class="small" data-embedded></p>
  </section>
  <section class="right" aria-label="Live output">
    <div class="row"><span class="chipst" data-verdict>Idle</span><span class="small mono" data-timer></span><span class="small mono" data-exit></span><button type="button" class="btn danger grow-none" data-cancel disabled style="margin-left:auto">Cancel</button></div>
    <div class="bar" role="progressbar" aria-label="Build activity" aria-valuetext="idle"><i></i></div>
    <pre class="log" tabindex="0" role="log" aria-live="off" data-log></pre>
  </section>
</div>`;
    const q = (s) => root.querySelector(s);
    const log = q('[data-log]'), phases = q('.phases'), verdict = q('[data-verdict]'), bar = q('.bar');
    if (cellsEl) cellsEl.innerHTML = ACTIONS.map(([id, l], i) => `<button type="button" class="tab" data-act="${id}" aria-pressed="${id === action}"><b>${i + 1}</b><span class="lbl">${l}</span></button>`).join('');
    const actBtns = [...(cellsEl || root).querySelectorAll('[data-act]')];
    const goBtn = q('[data-go]'), cancelBtn = q('[data-cancel]');
    const setHelp = () => {
      q('[data-help]').textContent = HELP[action];
      if (rail) { const l = ACTIONS.find((a) => a[0] === action)[1]; q('[data-eyebrow]').textContent = HELP[action].replace(/^Runs /, 'Runs ').replace(/\.$/, ''); q('[data-title]').textContent = l; goBtn.textContent = 'Start ' + l.toLowerCase(); updSub(); }
    };
    function updSub() { if (!rail) return; const n = phaseCells.length; q('[data-sub]').textContent = (n ? n + ' phase' + (n === 1 ? '' : 's') + ' reported' : 'No phases yet') + (running || startedAt ? ' · ' + elapsed() : ''); }
    function elapsed() { const s = Math.floor((Date.now() - startedAt) / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') + ' elapsed'; }
    function gauge() {
      if (!gaugeEl) return;
      gaugeEl.innerHTML = phaseCells.map((c) => '<i class="' + c + '"></i>').join('');
      const done = phaseCells.filter((c) => c === 'idle').length;
      gaugeEl.setAttribute('aria-label', 'Build phases: ' + done + ' done of ' + phaseCells.length + ' reported');
    }
    setHelp();
    for (const b of actBtns) b.addEventListener('click', () => { if (running) return; action = b.dataset.act; for (const x of actBtns) x.setAttribute('aria-pressed', String(x === b)); setHelp(); });

    function ringIcon(color, frac) { return ring(30, frac, color, ''); }
    function setVerdict(text, cls) { verdict.textContent = text; verdict.className = 'chipst ' + (cls || ''); }
    function setRunning(on) {
      running = on; goBtn.disabled = on; cancelBtn.disabled = !on;
      for (const b of actBtns) b.disabled = on;
      if (on) { startedAt = Date.now(); timer = setInterval(tick, 500); tick(); } else { clearInterval(timer); timer = null; }
    }
    function tick() { const s = Math.floor((Date.now() - startedAt) / 1000); q('[data-timer]').textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') + ' elapsed'; updSub(); }
    function addPhase(text) {
      if (phases.querySelector('.empty-note')) phases.textContent = '';
      if (activePhase) { activePhase.className = ''; activePhase.querySelector('svg').outerHTML = ringIcon('var(--ok)', 1); phaseCells[phaseCells.length - 1] = 'idle'; }
      const li = document.createElement('li'); li.className = 'active';
      li.innerHTML = ringIcon('var(--busy)', 0.6) + '<span class="grow">' + esc(text) + '</span>';
      phases.append(li); activePhase = li;
      if (phaseCells.length) { /* previous phase finished */ } phaseCells.push('run'); markGauge();
    }
    function endPhase(ok) {
      if (!activePhase) return;
      activePhase.className = ok ? '' : 'bad';
      activePhase.querySelector('svg').outerHTML = ringIcon(ok ? 'var(--ok)' : 'var(--bad)', ok ? 1 : 0.4);
      phaseCells[phaseCells.length - 1] = ok ? 'idle' : 'bad';
      activePhase = null; markGauge();
    }
    function markGauge() { gauge(); updSub(); }
    function addLine(p) {
      const div = document.createElement('div');
      if (p.stream === 'err') div.className = 'err';
      div.textContent = p.text;
      const stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 30;
      log.append(div);
      if (++lines > 6000) { log.firstChild.remove(); lines--; }
      if (stick) log.scrollTop = log.scrollHeight;
      const m = /\[(\.\.|ok)\]\s+(.*)$/.exec(p.text); // build.ps1 style: "[..] message" starts a phase, "[ok]" finishes it
      if (m) { if (m[1] === '..') addPhase(m[2]); else endPhase(true); }
    }
    function onState(s) {
      if (s.state === 'running') {
        log.textContent = ''; lines = 0; phases.textContent = ''; activePhase = null; phaseCells.length = 0; gauge(); q('[data-exit]').textContent = '';
        setRunning(true); setVerdict('Running ' + s.action, 'cyan'); bar.className = 'bar run'; bar.setAttribute('aria-valuetext', 'running');
        return;
      }
      setRunning(false);
      endPhase(s.state === 'succeeded');
      q('[data-exit]').textContent = 'exit ' + (s.code === null || s.code === undefined ? 'none' : s.code) + ' after ' + s.seconds + ' s';
      if (s.state === 'succeeded') { setVerdict('Succeeded', 'lime'); bar.className = 'bar done'; }
      else if (s.state === 'cancelled') { setVerdict('Cancelled, build incomplete', 'amber'); bar.className = 'bar fail'; }
      else { setVerdict('Failed', 'red'); bar.className = 'bar fail'; }
      bar.setAttribute('aria-valuetext', s.state);
      const note = document.createElement('div'); note.className = s.state === 'succeeded' ? '' : 'err'; note.textContent = '[gui] ' + s.message;
      log.append(note); log.scrollTop = log.scrollHeight;
    }
    api.onLine(addLine); api.onState(onState);
    goBtn.addEventListener('click', async () => {
      const r = await api.start(action);
      if (!r.ok) { setVerdict('Could not start', 'red'); const d = document.createElement('div'); d.className = 'err'; d.textContent = '[gui] ' + r.error; log.append(d); }
    });
    cancelBtn.addEventListener('click', () => { api.cancel(); setVerdict('Cancelling', 'amber'); });
    q('[data-folder]').addEventListener('click', () => api.openFolder('dist'));
    api.info().then((i) => {
      q('[data-source]').textContent = i.repo ? i.repo : 'No source available';
      q('[data-embedded]').textContent = (i.repo ? '' : 'Builds are disabled. ') + (i.repoNote || '') + (i.embedded ? '. This exe embeds ' + i.embedded.files + ' tracked files of commit ' + String(i.embedded.commit).slice(0, 12) + '.' : '');
      if (!i.repo) goBtn.disabled = true;
      if (i.running) { running = true; goBtn.disabled = true; cancelBtn.disabled = false; setVerdict('Running ' + i.running, 'cyan'); }
    });
  }
  window.MvlBuildPanel = { mount };
})();
