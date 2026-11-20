'use strict';
// Sample Material VM Labs extension (Node.js).
// Reads ONE JSON request line from standard input and writes ONE JSON answer line to standard output.
// Optional progress lines look like {"type":"log","message":"..."}.
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', () => {
  const request = JSON.parse(raw.split('\n')[0]);
  const r = request.input.receipt;
  log(`Writing a comment for ${r.repository}`);
  const rows = (r.entrypoints || []).map((e) => `| \`${e.name}\` | ${e.exitCode === 0 ? ':white_check_mark: passed' : ':x: exit ' + e.exitCode} |`);
  const report = [
    `**Fresh-host build ${r.verdict === 'passed' ? 'passed' : 'did not pass'}** for \`${String(r.commit || '').slice(0, 12)}\`.`,
    '',
    '| Entrypoint | Result |',
    '| --- | --- |',
    ...rows,
    '',
    r.hostMinutes != null ? `Took ${r.hostMinutes} minutes on a clean Material VM Labs machine.` : ''
  ].join('\n');
  answer({ summary: `Comment ready for ${r.repository}`, report });
});
function log(message) { process.stdout.write(JSON.stringify({ type: 'log', message }) + '\n'); }
function answer(fields) { process.stdout.write(JSON.stringify(Object.assign({ type: 'answer' }, fields)) + '\n'); }
