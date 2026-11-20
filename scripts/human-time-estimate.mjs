#!/usr/bin/env node
// human-time-estimate.mjs: an ESTIMATE of how long a person would take to write this project by
// hand, derived only from the line counter's own breakdown (scripts/count-lines.mjs --json).
// Generated files, lock files, fonts, images, PDFs and design frames are already excluded by the
// counter; documentation and "other" rows are left out here too. It prints Markdown with the
// inputs, the assumed rates and one line of arithmetic, so a reader can disagree with the
// assumptions rather than with the conclusion.
//   node scripts/count-lines.mjs --json > lines.json
//   node scripts/human-time-estimate.mjs lines.json
// With no file argument it runs the counter itself.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Non-blank lines a person writes per hour of finished, tested work: [fast, slow].
export const RATES = { source: [40, 20], tests: [80, 40], markup: [120, 60] };
export const HOURS_PER_WEEK = 40;

export function estimate({ source = 0, tests = 0, markup = 0 }) {
  for (const [k, v] of Object.entries({ source, tests, markup })) {
    if (!Number.isInteger(v) || v < 0) throw new Error(`${k} must be a whole number of lines, not ${v}`);
  }
  const lowHours = source / RATES.source[0] + tests / RATES.tests[0] + markup / RATES.markup[0];
  const highHours = source / RATES.source[1] + tests / RATES.tests[1] + markup / RATES.markup[1];
  return { source, tests, markup, lowHours, highHours, lowWeeks: lowHours / HOURS_PER_WEEK, highWeeks: highHours / HOURS_PER_WEEK };
}

export function fromCounter(json) {
  const rows = (json && json.rows) || {};
  const nb = (k) => (rows[k] ? rows[k].nonBlank : 0);
  return { commit: json && json.commit, input: { source: nb('source'), tests: nb('tests'), markup: nb('styles and markup') } };
}

const n = (x) => Math.round(x).toLocaleString('en-US');
const w = (x) => (Math.round(x * 10) / 10).toLocaleString('en-US');

export function formatEstimate(e, commit) {
  return [
    `This is an estimate, not a measurement: nobody wrote this project by hand${commit ? `, and the inputs are the counter's figures at \`${commit}\`` : ''}. ` +
      `A person would take roughly **${n(e.lowHours)} to ${n(e.highHours)} hours** (about ${w(e.lowWeeks)} to ${w(e.highWeeks)} working weeks of ${HOURS_PER_WEEK} hours).`,
    '',
    '| Input (non-blank lines) | Lines | Assumed rate, lines per hour |',
    '| --- | ---: | ---: |',
    `| Source | ${n(e.source)} | ${RATES.source[0]} to ${RATES.source[1]} |`,
    `| Tests | ${n(e.tests)} | ${RATES.tests[0]} to ${RATES.tests[1]} |`,
    `| Styles and markup (includes the design canvases) | ${n(e.markup)} | ${RATES.markup[0]} to ${RATES.markup[1]} |`,
    '',
    `Arithmetic: ${n(e.source)}/${RATES.source[0]} + ${n(e.tests)}/${RATES.tests[0]} + ${n(e.markup)}/${RATES.markup[0]} = ${n(e.lowHours)} hours; ` +
      `${n(e.source)}/${RATES.source[1]} + ${n(e.tests)}/${RATES.tests[1]} + ${n(e.markup)}/${RATES.markup[1]} = ${n(e.highHours)} hours. No multiplier is applied.`,
    '',
    'Left out, exactly as the line count leaves them out: generated files, lock files, fonts, images, PDFs and design frames. Documentation and other files are also left out of the estimate.'
  ].join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const file = process.argv[2];
  let json;
  if (file) json = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
  else {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    json = JSON.parse(execFileSync(process.execPath, [join(root, 'scripts', 'count-lines.mjs'), '--json'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 }));
  }
  const { commit, input } = fromCounter(json);
  console.log(formatEstimate(estimate(input), commit));
}
