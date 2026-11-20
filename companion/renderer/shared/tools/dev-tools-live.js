'use strict';
// Live activity: charts real data only. Machine counts come from the manager's own machine list
// (window.mvl.run('ls')), read when the tool opens and every 30 seconds while it stays open. Build
// run times come from the saved build receipts (window.mvl.receipts()). Readings live in memory for
// this window session; nothing is estimated, interpolated or invented, and every failure is shown.
(function () {
  if (!window.MVLTools || !window.MVLChart) return;
  const POLL_MS = 30000;
  // Readings survive closing and reopening the tool within this window session.
  const readings = []; // { t, running, idle, duty, total }
  let lastError = null;

  function countMachines(list) {
    const ms = Array.isArray(list) ? list : [];
    const running = ms.filter((m) => m && m.Power === 'running').length;
    const duty = ms.filter((m) => m && Number(m.Runners) > 0).length;
    return { total: ms.length, running, idle: ms.length - running, duty };
  }
  function buildPoints(receipts) {
    const out = { passed: [], failed: [] };
    for (const r of receipts || []) {
      if (!r || r.kind === 'install') continue; // installer receipts are not builds
      const t = Date.parse(r.finishedUtc), v = Number(r.hostMinutes);
      if (!Number.isFinite(t) || r.hostMinutes == null || !Number.isFinite(v)) continue;
      (r.verdict === 'passed' ? out.passed : out.failed).push({ t, v, label: [r.repository, r.commit ? String(r.commit).slice(0, 7) : ''].filter(Boolean).join('@') });
    }
    return out;
  }

  function mount(el, ctx) {
    const api = window.mvl;
    el.innerHTML = `<div class="dtl">
<p class="small">Real readings from this manager only. Machine counts are read now and every 30 seconds while this tool is open; build run times come from saved receipts. Nothing is estimated.</p>
<div class="row dtl-actions"><button type="button" class="btn sm" data-dt-pause aria-pressed="false">Pause</button><button type="button" class="btn sm light" data-dt-now>Read now</button><span class="small" data-dt-when role="status"></span></div>
<div class="card dtl-card" data-dt-machines></div>
<div class="card dtl-card" data-dt-builds></div>
</div>`;
    const when = el.querySelector('[data-dt-when]');
    const machines = window.MVLChart.create(el.querySelector('[data-dt-machines]'), {
      title: 'Machines over time', live: true, integer: true, zero: true, gapMs: POLL_MS * 2.5, yLabel: 'machines',
      emptyText: 'No reading yet.',
      series: [
        { id: 'running', label: 'Running', color: 'var(--md-sys-color-primary)' },
        { id: 'idle', label: 'Idle', color: 'var(--md-sys-color-secondary)' },
        { id: 'duty', label: 'Runner duty', color: 'var(--md-sys-color-tertiary)' }
      ],
      windows: [{ ms: 5 * 60e3, label: '5 min' }, { ms: 30 * 60e3, label: '30 min' }, { ms: 2 * 3600e3, label: '2 h' }, { ms: null, label: 'All' }],
      windowMs: 5 * 60e3
    });
    const builds = window.MVLChart.create(el.querySelector('[data-dt-builds]'), {
      title: 'Build run time', live: false, unit: 'min', zero: true, yLabel: 'minutes',
      emptyText: 'No build receipts with a recorded run time yet. Run a fresh build and it appears here.',
      series: [
        { id: 'passed', label: 'Passed', color: 'var(--md-sys-color-primary)' },
        { id: 'failed', label: 'Failed', color: 'var(--md-sys-color-error)' }
      ],
      windows: [{ ms: 7 * 86400e3, label: '7 days' }, { ms: 30 * 86400e3, label: '30 days' }, { ms: null, label: 'All' }],
      windowMs: null
    });

    let timer = 0, paused = false, alive = true, lastOk = readings.length ? readings[readings.length - 1].t : 0, inflight = false;
    const pushSeries = () => {
      machines.setSeries('running', readings.map((r) => ({ t: r.t, v: r.running })));
      machines.setSeries('idle', readings.map((r) => ({ t: r.t, v: r.idle })));
      machines.setSeries('duty', readings.map((r) => ({ t: r.t, v: r.duty })));
    };
    const stamp = (t) => new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    function updateWhen() {
      if (!alive) return;
      if (paused) { when.textContent = 'Paused. Readings stop until you resume; the gap stays visible.'; return; }
      when.textContent = lastOk ? `Last read at ${stamp(lastOk)}. Next read in about ${Math.max(0, Math.round((lastOk + POLL_MS - Date.now()) / 1000))} s.` : (lastError ? '' : 'Reading the machine list.');
    }
    async function poll() {
      if (!alive || paused || inflight) return;
      if (!api || typeof api.run !== 'function') { machines.setStatus({ state: 'error', text: 'The manager bridge is not available in this window, so machine counts cannot be read.' }); return; }
      inflight = true;
      try {
        const res = await api.run('ls');
        if (!alive) return;
        if (!res || res.ok === false) throw new Error((res && (res.error || res.message)) || 'the machine list could not be read');
        const c = countMachines(res.data);
        readings.push(Object.assign({ t: Date.now() }, c));
        if (readings.length > 2880) readings.splice(0, readings.length - 2880);
        lastOk = Date.now(); lastError = null;
        pushSeries();
        machines.setStatus({ state: 'ok', text: '' });
      } catch (e) {
        lastError = String(e && e.message || e);
        machines.setStatus(readings.length ? { state: 'stale', text: `the last read failed (${lastError}); showing readings up to ${stamp(lastOk)}` } : { state: 'error', text: `Machine counts are unavailable: ${lastError}` });
      } finally { inflight = false; updateWhen(); }
    }
    async function loadBuilds() {
      if (!api || typeof api.receipts !== 'function') { builds.setStatus({ state: 'error', text: 'The manager bridge is not available in this window, so receipts cannot be read.' }); return; }
      try {
        const res = await api.receipts();
        if (!alive) return;
        if (res && res.error) throw new Error(res.error);
        const pts = buildPoints(res && res.receipts);
        builds.setSeries('passed', pts.passed); builds.setSeries('failed', pts.failed);
        builds.setStatus({ state: pts.passed.length + pts.failed.length ? 'ok' : 'empty', text: '' });
      } catch (e) { builds.setStatus({ state: 'error', text: `Receipts could not be read: ${String(e && e.message || e)}` }); }
    }
    // Stale when two reads in a row have been missed.
    const clock = setInterval(() => {
      updateWhen();
      if (!paused && lastOk && Date.now() - lastOk > POLL_MS * 2.5 && !lastError) machines.setStatus({ state: 'stale', text: `no reading since ${stamp(lastOk)}` });
    }, 1000);
    if (readings.length) pushSeries();
    machines.setStatus({ state: readings.length ? 'ok' : 'loading', text: '' });
    poll(); loadBuilds();
    timer = setInterval(poll, POLL_MS);

    el.querySelector('[data-dt-pause]').addEventListener('click', (e) => {
      paused = !paused;
      e.currentTarget.setAttribute('aria-pressed', String(paused));
      e.currentTarget.textContent = paused ? 'Resume' : 'Pause';
      if (paused) machines.setStatus({ state: 'paused', text: 'readings are stopped' });
      else { machines.setStatus({ state: readings.length ? 'ok' : 'loading', text: '' }); poll(); }
      updateWhen();
    });
    el.querySelector('[data-dt-now]').addEventListener('click', () => { if (paused) { ctx.toast('Resume first: readings are paused.', 'info'); return; } poll(); loadBuilds(); });
    updateWhen();

    return () => { alive = false; clearInterval(timer); clearInterval(clock); machines.destroy(); builds.destroy(); };
  }

  let teardown = null;
  window.MVLTools.register({
    id: 'live-activity', title: 'Live activity', group: 'Developer tools',
    summary: 'Live charts of running, idle and runner-duty machines, and build run times from receipts',
    mount(el, ctx) { if (teardown) teardown(); teardown = mount(el, ctx); },
    unmount() { if (teardown) { teardown(); teardown = null; } }
  });
  window.MVLDevLive = { countMachines, buildPoints };
})();
