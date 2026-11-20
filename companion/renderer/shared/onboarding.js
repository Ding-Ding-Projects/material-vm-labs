'use strict';
// First-run setup wizard shared by the manager, the docs reader and the build GUI.
// Each app supplies its steps; every step performs a real action and records the real result.
// Progress, the current step and every result are saved, so closing the app resumes where it stopped.
// Nothing here marks a step done on its own: a step is done only when its action reported success.
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MARK = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4" width="17" height="7" rx="2"></rect><rect x="3.5" y="13" width="17" height="7" rx="2"></rect><path d="M7.5 7.5h.01M7.5 16.5h.01"></path></svg>';
  const TICK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"></path></svg>';
  const STATUS = { ok: ['Done', 'lime'], fail: ['Needs attention', 'red'], skip: ['Skipped', 'amber'], run: ['Running', 'cyan'], stale: ['Not finished', 'amber'], info: ['Read', 'lime'] };

  // o: { id, app, subtitle, steps: [{ id, label, note, title, intro, optional, info, render(body, ctx), onNext(ctx) }],
  //      finishLabel, onFinish(results), skipHint }
  function create(o) {
    const key = 'mvl.onboarding.' + o.id;
    const read = () => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
    let st = read();
    if (!st || st.v !== 1) st = { v: 1, step: 0, done: false, results: {}, data: {}, seen: 0 };
    // A step that was still running when the app closed has no known result now.
    for (const r of Object.values(st.results)) if (r && r.status === 'run') { r.status = 'stale'; r.text = 'This was still running when the app closed. Check it again to see the real result.'; }
    const save = () => { try { localStorage.setItem(key, JSON.stringify(st)); } catch { /* storage unavailable: progress lasts for this session */ } };
    const steps = o.steps.concat([{ id: '_done', label: 'Finish', note: 'Review and open the app', title: 'Review your setup', done: true }]);
    let root = null, prevFocus = null, busy = false;

    const result = (id) => st.results[id] || null;
    const stepDone = (s) => { const r = result(s.id); return !!r && (r.status === 'ok' || r.status === 'info' || r.status === 'skip'); };
    function canNext(s) {
      if (s.done || s.info || s.optional) return true;
      const r = result(s.id);
      return !!r && r.status !== 'run' && r.status !== 'stale';
    }

    let ctxs = new Map(); // one context per step, so a step's render and its Next share state
    function ctxFor(s) {
      if (ctxs.has(s.id)) return ctxs.get(s.id);
      const c = {
        get result() { return result(s.id); },
        data: (st.data[s.id] = st.data[s.id] || {}),
        save,
        setResult(status, text) {
          st.results[s.id] = { status, text: String(text || ''), at: new Date().toISOString() };
          save(); if (root) refresh();
        },
        next: () => go(st.step + 1)
      };
      ctxs.set(s.id, c);
      return c;
    }

    function build() {
      root = document.createElement('div');
      root.className = 'onb';
      root.setAttribute('role', 'dialog');
      root.setAttribute('aria-modal', 'true');
      root.setAttribute('aria-labelledby', 'onbStepTitle');
      root.innerHTML = `<div class="onb-frame">
<header class="onb-top"><span class="onb-mark">${MARK}</span><span class="onb-name"><strong></strong><span class="small"></span></span><span class="grow"></span><button type="button" class="btn sm onb-later" data-later>Save and finish later</button></header>
<div class="onb-prog"><div class="row"><span class="onb-ptext" data-ptext></span><span class="grow"></span><span class="small" data-pdone></span></div><div class="onb-bar" role="progressbar" aria-label="Setup progress" aria-valuemin="0"><i></i></div></div>
<div class="onb-body"><ol class="onb-steps" aria-label="Setup steps"></ol><section class="onb-card" aria-live="off"><h2 id="onbStepTitle" tabindex="-1"></h2><p class="onb-intro"></p><div class="onb-content"></div><div class="onb-result" role="status" aria-live="polite"></div></section></div>
<footer class="onb-foot"><button type="button" class="btn" data-back>Back</button><span class="grow"></span><span class="small onb-why" data-why></span><button type="button" class="btn" data-skip>Skip for now</button><button type="button" class="btn primary" data-next>Next</button></footer>
</div>`;
      root.querySelector('.onb-name strong').textContent = o.app;
      root.querySelector('.onb-name .small').textContent = o.subtitle || 'First-run setup';
      root.querySelector('[data-later]').addEventListener('click', later);
      root.querySelector('[data-back]').addEventListener('click', () => go(st.step - 1));
      root.querySelector('[data-skip]').addEventListener('click', () => {
        const s = steps[st.step];
        st.results[s.id] = { status: 'skip', text: o.skipHint ? o.skipHint(s) : 'Skipped. You can do this later.', at: new Date().toISOString() };
        save(); go(st.step + 1);
      });
      root.querySelector('[data-next]').addEventListener('click', next);
      root.querySelector('.onb-steps').addEventListener('click', (e) => {
        const b = e.target.closest('[data-goto]'); if (b && !b.disabled) go(Number(b.dataset.goto));
      });
      root.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !document.querySelector('.scrim')) { e.preventDefault(); later(); return; }
        if (e.key === 'Tab') {
          const f = [...root.querySelectorAll('button,input,select,textarea,a[href],[tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && x.offsetParent !== null);
          if (!f.length) return;
          const first = f[0], last = f[f.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      });
      document.body.append(root);
      document.documentElement.classList.add('onb-open');
    }

    function refresh() {
      const s = steps[st.step], n = steps.length;
      const doneN = steps.filter((x) => !x.done && stepDone(x)).length;
      root.querySelector('[data-ptext]').textContent = `Step ${st.step + 1} of ${n}: ${s.label}`;
      root.querySelector('[data-pdone]').textContent = doneN + ' of ' + (n - 1) + ' done';
      const bar = root.querySelector('.onb-bar');
      bar.setAttribute('aria-valuemax', String(n - 1)); bar.setAttribute('aria-valuenow', String(st.step));
      bar.setAttribute('aria-valuetext', `Step ${st.step + 1} of ${n}, ${doneN} done`);
      bar.firstElementChild.style.width = Math.round((st.step / (n - 1)) * 100) + '%';
      root.querySelector('.onb-steps').innerHTML = steps.map((x, i) => {
        const r = result(x.id), cur = i === st.step;
        const mark = r && (r.status === 'ok' || r.status === 'info') ? `<span class="onb-dot ok">${TICK}</span>` : r && r.status === 'fail' ? '<span class="onb-dot bad">!</span>' : `<span class="onb-dot">${i + 1}</span>`;
        const sub = r && STATUS[r.status] && !cur ? STATUS[r.status][0] : (x.optional ? 'Optional' : x.note || '');
        return `<li><button type="button" class="onb-step" data-goto="${i}" ${cur ? 'aria-current="step"' : ''} ${i > (st.seen || 0) ? 'disabled' : ''}>${mark}<span class="onb-sl"><span>${esc(x.label)}</span><span class="small">${esc(sub)}</span></span></button></li>`;
      }).join('');
      const r = result(s.id);
      const box = root.querySelector('.onb-result');
      if (r && !s.done && r.status !== 'info') {
        const [lab, cls] = STATUS[r.status] || ['', ''];
        box.innerHTML = `<span class="pill ${cls}">${esc(lab)}</span><span class="grow">${esc(r.text)}</span>`;
        box.hidden = false;
      } else { box.innerHTML = ''; box.hidden = true; }
      const back = root.querySelector('[data-back]'), skip = root.querySelector('[data-skip]'), nx = root.querySelector('[data-next]'), why = root.querySelector('[data-why]');
      back.disabled = st.step === 0 || busy;
      skip.hidden = !s.optional || (r && r.status === 'ok');
      nx.textContent = s.done ? (o.finishLabel || 'Open the app') : 'Next';
      nx.disabled = busy || !canNext(s);
      why.textContent = !busy && !canNext(s) ? (r && r.status === 'run' ? 'Waiting for the result' : 'Finish this step to continue') : '';
      if (s.done) renderSummary();
    }

    function renderSummary() {
      const list = steps.filter((x) => !x.done && !x.info);
      const box = root.querySelector('.onb-content');
      box.innerHTML = '<ul class="onb-sum">' + list.map((x) => {
        const r = result(x.id);
        const [lab, cls] = r ? (STATUS[r.status] || ['', '']) : ['Not done', 'amber'];
        return `<li><span class="pill ${cls}">${esc(lab)}</span><span class="grow"><strong>${esc(x.label)}</strong><br><span class="small">${esc(r ? r.text : (x.optional ? 'Not done. It is optional.' : 'Not done yet.'))}</span></span>${!r || r.status !== 'ok' ? `<button type="button" class="btn sm" data-goto-step="${steps.indexOf(x)}">Go to step</button>` : ''}</li>`;
      }).join('') + '</ul>';
      for (const b of box.querySelectorAll('[data-goto-step]')) b.addEventListener('click', () => go(Number(b.dataset.gotoStep)));
    }

    function show() {
      const s = steps[st.step];
      st.seen = Math.max(st.seen || 0, st.step);
      root.querySelector('#onbStepTitle').textContent = s.title || s.label;
      const intro = root.querySelector('.onb-intro');
      intro.textContent = s.done ? 'Every result below is what actually happened. Steps that need attention can be finished now or later from Settings.' : (s.intro || '');
      intro.hidden = !intro.textContent;
      const content = root.querySelector('.onb-content');
      content.innerHTML = '';
      root.querySelector('.onb-card').classList.remove('onb-enter'); void root.offsetWidth; root.querySelector('.onb-card').classList.add('onb-enter');
      if (s.render) { try { s.render(content, ctxFor(s)); } catch (e) { content.innerHTML = `<div class="errbox" role="alert">${esc('This step could not be shown: ' + (e && e.message))}</div>`; } }
      save(); refresh();
      root.querySelector('#onbStepTitle').focus({ preventScroll: true });
    }

    function go(i) {
      if (i < 0 || i >= steps.length || busy) return;
      st.step = i; show();
    }

    async function next() {
      const s = steps[st.step];
      if (s.done) return finish();
      if (s.info && !result(s.id)) st.results[s.id] = { status: 'info', text: 'Read', at: new Date().toISOString() };
      if (s.onNext) {
        busy = true; refresh();
        let ok = false;
        try { ok = await s.onNext(ctxFor(s)); } catch (e) { ctxFor(s).setResult('fail', (e && e.message) || String(e)); }
        busy = false;
        if (!ok) { refresh(); return; }
      }
      if (!canNext(s)) { refresh(); return; }
      go(st.step + 1);
    }

    function close() {
      if (!root) return;
      root.remove(); root = null;
      document.documentElement.classList.remove('onb-open');
    }
    function later() {
      save(); close();
      if (window.MVL && window.MVL.toast) window.MVL.toast('Setup saved. It continues where you left off next time, or from Settings, Run setup again.');
      if (o.onLater) o.onLater();
      else if (prevFocus && prevFocus.isConnected) prevFocus.focus();
    }
    function finish() {
      st.done = true; st.finishedAt = new Date().toISOString(); save(); close();
      if (o.onFinish) o.onFinish(Object.assign({}, st.results), Object.assign({}, st.data));
    }

    return {
      isDone: () => !!st.done,
      state: () => JSON.parse(JSON.stringify(st)),
      // start(again): open the wizard; again=true starts over with fresh results ("Run setup again").
      start(again) {
        if (again) { st = { v: 1, step: 0, done: false, results: {}, data: st.data || {}, seen: 0 }; ctxs = new Map(); save(); }
        if (root) { show(); return; }
        prevFocus = document.activeElement;
        build(); show();
      },
      // Start on first run, or resume an unfinished setup.
      startIfNeeded() { if (!st.done) this.start(false); return !st.done; },
      close
    };
  }

  window.MVLOnboarding = { create };
})();
