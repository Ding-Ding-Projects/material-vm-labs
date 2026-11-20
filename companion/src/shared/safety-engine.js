'use strict';
// Safety engine: the attempt budget, lockout clock and unlock ladder for toy locks. It runs in the
// main process (safety-ipc.js) so the page never grades its own ladder answers. Pure logic with an
// injectable clock and random source, so node tests can drive every rule.
//
// The five rules the ladder must keep:
//  1. Winning clears the WAIT only. It never unlocks anything; the person still needs the credential.
//  2. It never refunds more attempts than serving the wait does (both refill the same budget).
//  3. At most BUDGET_PER_HOUR waits may be skipped per rolling hour, across every lock.
//  4. The lockout still escalates (doubling, capped) and clearing leaves that count untouched.
//  5. Every challenge is generated and graded here against a single-use nonce that expires.
// Plus: a whack-a-mole round cannot be submitted before it has run its full length, and each mole
// counts once, only for a hit in its own cell while it was visible.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MVLSafetyEngine = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  const ATTEMPTS = 5;
  const BASE_WAIT = 30 * 1000;
  const MAX_WAIT = 15 * 60 * 1000;
  const BUDGET_PER_HOUR = 3;
  const HOUR = 60 * 60 * 1000;
  const DIM_SUM_TRIES = 5;
  const SUMS = 10;
  const MOLE = { cells: 9, duration: 20000, leadIn: 3000, moles: 14, visible: 1100, need: 7, slack: 150 };

  // Dishes for the first rung: the clue describes the dish, the four choices are names.
  const DISHES = [
    { en: 'Har gow', yue: '蝦餃', clue: 'Shrimp dumpling with a thin, see-through wrapper, steamed in a basket.', clueYue: '薄皮透明、蒸籠蒸嘅蝦餃子。' },
    { en: 'Siu mai', yue: '燒賣', clue: 'Open-topped pork and shrimp dumpling in a yellow wrapper, often with a dot of roe on top.', clueYue: '黃色皮、開口、豬肉蝦肉餡，面頭通常有啲魚籽。' },
    { en: 'Char siu bao', yue: '叉燒包', clue: 'Fluffy white steamed bun filled with sweet barbecued pork.', clueYue: '鬆軟白色蒸包，入面係甜叉燒。' },
    { en: 'Cheung fun', yue: '腸粉', clue: 'Silky rolled rice noodle sheet with sweet soy sauce poured over.', clueYue: '滑溜溜嘅米漿卷，淋上甜豉油。' },
    { en: 'Lo mai gai', yue: '糯米雞', clue: 'Sticky rice with chicken, wrapped in a lotus leaf and steamed.', clueYue: '用荷葉包住糯米同雞肉蒸出嚟。' },
    { en: 'Egg tart', yue: '蛋撻', clue: 'Small pastry shell with a smooth baked egg custard.', clueYue: '細細個酥皮，入面係焗到滑嘅蛋漿。' },
    { en: 'Phoenix claws', yue: '鳳爪', clue: 'Chicken feet braised soft in black bean sauce.', clueYue: '豉汁炆到腍晒嘅雞腳。' },
    { en: 'Turnip cake', yue: '蘿蔔糕', clue: 'Pan-fried slab of grated radish cake with bits of sausage.', clueYue: '煎香咗嘅蘿蔔絲糕，有臘腸粒。' },
    { en: 'Ma lai go', yue: '馬拉糕', clue: 'Tall, spongy brown steamed cake.', clueYue: '高高鬆鬆嘅啡色蒸糕。' },
    { en: 'Ham sui gok', yue: '鹹水角', clue: 'Deep-fried glutinous rice dumpling, crisp outside and chewy inside.', clueYue: '炸糯米角，外脆內煙韌。' },
    { en: 'Wu gok', yue: '芋角', clue: 'Deep-fried taro dumpling with a lacy, crunchy shell.', clueYue: '炸芋頭角，外殼似蜂巢咁脆。' },
    { en: 'Lau sa bao', yue: '流沙包', clue: 'Steamed bun with a molten salted egg yolk custard centre.', clueYue: '蒸包入面係會流出嚟嘅鹹蛋黃奶黃。' },
    { en: 'Pai gwat', yue: '豉汁排骨', clue: 'Small pieces of pork rib steamed with black beans.', clueYue: '豉汁蒸細細件排骨。' },
    { en: 'Ngau yuk kau', yue: '牛肉球', clue: 'Steamed beef meatballs on a bed of bean curd skin.', clueYue: '腐皮墊底嘅蒸牛肉丸。' }
  ];

  // One function decides the first rung. Under School mode the dim-sum rung is absent.
  const startRung = (school) => (school ? 'sums' : 'dimsum');

  function defaultRandom() {
    if (globalThis.crypto && globalThis.crypto.getRandomValues) { const a = new Uint32Array(1); globalThis.crypto.getRandomValues(a); return a[0] / 4294967296; }
    return Math.random();
  }
  function hexNonce(random) { let s = ''; for (let i = 0; i < 32; i++) s += Math.floor(random() * 16).toString(16); return s; }

  function createEngine(opts) {
    const o = opts || {};
    const now = o.now || (() => Date.now());
    const random = o.random || defaultRandom;
    const st = { keys: {}, clears: [] };
    if (o.state && typeof o.state === 'object') { st.keys = o.state.keys || {}; st.clears = Array.isArray(o.state.clears) ? o.state.clears.filter(Number.isFinite) : []; }
    const pending = new Map(); // nonce -> challenge record (never persisted)
    const int = (n) => Math.floor(random() * n);
    const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = int(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };

    function rec(key) {
      if (!st.keys[key]) st.keys[key] = { fails: 0, lockouts: 0, until: 0, ladder: null };
      const r = st.keys[key];
      if (r.until && now() >= r.until) { r.until = 0; r.fails = 0; r.ladder = null; } // the wait was served: budget refills
      return r;
    }
    function budgetLeft() {
      const t = now();
      st.clears = st.clears.filter((c) => t - c < HOUR);
      return Math.max(0, BUDGET_PER_HOUR - st.clears.length);
    }
    function nextBudgetAt() { return st.clears.length ? Math.min(...st.clears) + HOUR : 0; }
    function ladderInfo(r) {
      if (!r.until) return { available: false, reason: 'not-locked' };
      if (!r.ladder) return { available: false, reason: 'not-locked' };
      if (r.ladder.rung === 'clock') return { available: false, rung: 'clock', reason: r.ladder.reason || 'fell-to-clock' };
      if (budgetLeft() <= 0) return { available: false, rung: 'clock', reason: 'hourly-budget-spent', budgetBackAt: nextBudgetAt() };
      return { available: true, rung: r.ladder.rung };
    }
    function status(key) {
      const r = rec(key);
      return { key, locked: !!r.until, until: r.until, waitMs: r.until ? r.until - now() : 0, remaining: ATTEMPTS - r.fails, attempts: ATTEMPTS, lockouts: r.lockouts, budgetLeft: budgetLeft(), budgetPerHour: BUDGET_PER_HOUR, ladder: ladderInfo(r) };
    }
    function waitFor(lockouts) { return Math.min(MAX_WAIT, BASE_WAIT * 2 ** Math.max(0, lockouts - 1)); }

    // Records one checked attempt. ok=true resets the budget and the escalation.
    function attempt(key, ok) {
      const r = rec(key);
      if (r.until) return Object.assign(status(key), { refused: true });
      if (ok) { r.fails = 0; r.lockouts = 0; return status(key); }
      r.fails += 1;
      if (r.fails >= ATTEMPTS) {
        r.lockouts += 1;
        r.until = now() + waitFor(r.lockouts);
        r.ladder = { rung: null, dimWrong: 0 };
      }
      return status(key);
    }
    function dropPendingFor(key) { for (const [n, c] of pending) if (c.key === key) pending.delete(n); }

    function challenge(key, copts) {
      const r = rec(key);
      if (!r.until) return { ok: false, error: 'not-locked' };
      const info = ladderInfo(r);
      if (!info.available) return { ok: false, error: info.reason, budgetBackAt: info.budgetBackAt };
      const school = !!(copts && copts.school);
      if (!r.ladder.rung || (school && r.ladder.rung === 'dimsum')) r.ladder.rung = startRung(school);
      dropPendingFor(key);
      const nonce = hexNonce(random), t = now();
      let c;
      if (r.ladder.rung === 'dimsum') {
        const pick = shuffle(DISHES.slice()).slice(0, 4), ans = int(4);
        c = { rung: 'dimsum', expiresAt: t + 60000, answer: pick[ans].en, public: { clue: pick[ans].clue, clueYue: pick[ans].clueYue, choices: pick.map((d) => ({ en: d.en, yue: d.yue })), triesLeft: DIM_SUM_TRIES - r.ladder.dimWrong } };
      } else if (r.ladder.rung === 'sums') {
        const items = [];
        for (let i = 0; i < SUMS; i++) {
          const op = ['+', '-', 'x'][int(3)];
          let a, b;
          if (op === 'x') { a = 2 + int(8); b = 2 + int(8); } else { a = 1 + int(49); b = 1 + int(49); if (op === '-' && b > a) [a, b] = [b, a]; }
          items.push({ a, b, op, v: op === '+' ? a + b : op === '-' ? a - b : a * b });
        }
        c = { rung: 'sums', expiresAt: t + 180000, answer: items.map((x) => x.v), public: { sums: items.map((x) => ({ a: x.a, b: x.b, op: x.op })) } };
      } else {
        const moles = [];
        for (let i = 0; i < MOLE.moles; i++) {
          for (let tries = 0; tries < 50; tries++) {
            const at = int(MOLE.duration - MOLE.visible), cell = int(MOLE.cells);
            if (moles.some((m) => m.cell === cell && Math.abs(m.at - at) < MOLE.visible + 200)) continue;
            moles.push({ id: i, cell, at, dur: MOLE.visible }); break;
          }
        }
        moles.sort((a, b) => a.at - b.at);
        const startAt = t + MOLE.leadIn;
        c = { rung: 'mole', startAt, endAt: startAt + MOLE.duration, expiresAt: startAt + MOLE.duration + 30000, moles, public: { cells: MOLE.cells, durationMs: MOLE.duration, leadInMs: MOLE.leadIn, need: MOLE.need, moles: moles.map((m) => ({ cell: m.cell, at: m.at, dur: m.dur })) } };
      }
      c.key = key;
      pending.set(nonce, c);
      return Object.assign({ ok: true, nonce, rung: c.rung, expiresInMs: c.expiresAt - t }, c.public);
    }

    function fall(r, rung, reason) { r.ladder.rung = rung; if (reason) r.ladder.reason = reason; }
    function clear(key, r) {
      r.until = 0; r.fails = 0; r.ladder = null; // same refill as serving the wait; lockouts (escalation) untouched
      st.clears.push(now());
    }

    function answer(key, nonce, ans) {
      const c = pending.get(nonce);
      if (!c || c.key !== key) return { ok: false, error: 'unknown-or-used-nonce' };
      pending.delete(nonce); // consumed before grading: never retried, never replayed
      const r = rec(key);
      if (!r.until || !r.ladder) return { ok: false, error: 'not-locked' };
      const t = now();
      if (t > c.expiresAt) return Object.assign({ ok: false, error: 'expired' }, status(key));
      if (c.rung === 'dimsum') {
        const right = typeof ans === 'string' && ans === c.answer;
        if (right) { clear(key, r); return Object.assign({ ok: true, correct: true, cleared: true }, status(key)); }
        r.ladder.dimWrong += 1;
        if (r.ladder.dimWrong >= DIM_SUM_TRIES) fall(r, 'sums');
        return Object.assign({ ok: true, correct: false, cleared: false, right: c.answer }, status(key));
      }
      if (c.rung === 'sums') {
        const valid = Array.isArray(ans) && ans.length === SUMS;
        const wrong = [];
        for (let i = 0; i < SUMS; i++) if (!valid || !Number.isInteger(ans[i]) || ans[i] !== c.answer[i]) wrong.push(i);
        if (!wrong.length) { clear(key, r); return Object.assign({ ok: true, correct: true, cleared: true }, status(key)); }
        fall(r, 'mole');
        return Object.assign({ ok: true, correct: false, cleared: false, wrong }, status(key));
      }
      // Whack-a-mole
      if (t < c.endAt) { fall(r, 'clock', 'submitted-early'); return Object.assign({ ok: true, correct: false, cleared: false, early: true, hits: 0 }, status(key)); }
      const hitSet = new Set();
      if (Array.isArray(ans)) {
        for (const h of ans.slice(0, 400)) {
          if (!h || !Number.isInteger(h.cell) || !Number.isFinite(h.t)) continue;
          const m = c.moles.find((x) => x.cell === h.cell && !hitSet.has(x.id) && h.t >= x.at - MOLE.slack && h.t <= x.at + x.dur + MOLE.slack);
          if (m) hitSet.add(m.id);
        }
      }
      const hits = hitSet.size;
      if (hits >= MOLE.need) { clear(key, r); return Object.assign({ ok: true, correct: true, cleared: true, hits }, status(key)); }
      fall(r, 'clock', 'lost-round');
      return Object.assign({ ok: true, correct: false, cleared: false, hits }, status(key));
    }

    function forget(key) { delete st.keys[key]; dropPendingFor(key); }
    const exportState = () => JSON.parse(JSON.stringify({ keys: st.keys, clears: st.clears }));
    return { attempt, status, challenge, answer, forget, exportState, budgetLeft };
  }

  return { createEngine, startRung, DISHES, ATTEMPTS, BASE_WAIT, MAX_WAIT, BUDGET_PER_HOUR, MOLE, SUMS, DIM_SUM_TRIES };
});
