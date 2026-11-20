'use strict';
// Built-in Material VM Labs extension: receipt summary.
// Protocol: one JSON request line on standard input, one JSON answer line on standard output.
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  let req;
  try { req = JSON.parse(raw.split('\n').find((l) => l.trim()) || '{}'); } catch { return answer({ summary: 'The request was not JSON.' }); }
  const r = (req.input && req.input.receipt) || null;
  if (!r) return answer({ summary: 'No receipt was handed over.' });
  const ok = r.verdict === 'passed';
  const short = String(r.commit || '').slice(0, 12) || 'unknown commit';
  const lines = [];
  lines.push(`## ${ok ? 'Fresh build passed' : 'Fresh build ' + (r.verdict || 'result unknown')}`);
  lines.push('');
  lines.push(`**${r.repository || 'Unknown repository'}** at \`${short}\`${r.finishedUtc ? ', finished ' + r.finishedUtc : ''}.`);
  lines.push('');
  if (r.entrypoints && r.entrypoints.length) {
    lines.push('### Entrypoints');
    for (const e of r.entrypoints) {
      const passed = e.exitCode === 0 || e.result === 'passed';
      lines.push(`- ${passed ? ':white_check_mark:' : ':x:'} \`${e.name || 'entrypoint'}\` exit ${e.exitCode == null ? 'unknown' : e.exitCode}${e.result ? ' (' + e.result + ')' : ''}`);
    }
    lines.push('');
  }
  const m = r.machine;
  if (m) lines.push(`Ran on **${m.name || 'a lab machine'}**${m.guestOs ? ' (' + m.guestOs + ')' : ''}${m.hypervisor ? ' under ' + m.hypervisor : ''}${m.memoryMB ? ', ' + Math.round(m.memoryMB / 1024) + ' GB' : ''}${m.cpus ? ', ' + m.cpus + ' vCPU' : ''}${m.network ? ', ' + m.network : ''}.`);
  if (m) lines.push('');
  if (r.hostMinutes != null) lines.push(`Host time: ${r.hostMinutes} minutes.`);
  const d = r.dependencies;
  if (d) {
    lines.push('');
    lines.push('### What the build had to fetch');
    lines.push(`- ${d.tools || 0} new tools on PATH, ${d.programs || 0} installed programs, ${d.choco || 0} Chocolatey packages`);
    lines.push(`- ${d.folders || 0} new folders, about ${d.megabytes || 0} MB`);
    if ((d.tools || 0) + (d.programs || 0) + (d.choco || 0) === 0) lines.push('- Nothing extra: the build needed no undeclared dependencies. :tada:');
  }
  lines.push('');
  lines.push('_Summarised by the built-in Receipt summary extension from the receipt\'s own fields._');
  answer({ summary: `${ok ? 'Passed' : 'Not passed'}: ${r.repository || 'receipt'} at ${short}`, report: lines.join('\n') });
});
function answer(a) { process.stdout.write(JSON.stringify(Object.assign({ type: 'answer' }, a)) + '\n'); }
