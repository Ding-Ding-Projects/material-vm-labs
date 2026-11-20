'use strict';
// Built-in Material VM Labs extension: machine name policy.
// Reads one JSON request line, answers with a list of checks. Edit this file to change the policy;
// once you edit it, Material VM Labs stops updating it for you.
const RESERVED = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9', 'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9', 'LOCALHOST', 'WORKGROUP', 'DOMAIN'];
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  let req;
  try { req = JSON.parse(raw.split('\n').find((l) => l.trim()) || '{}'); } catch { return answer({ summary: 'The request was not JSON.', checks: [] }); }
  const p = (req.input && req.input.plan) || {};
  const name = String(p.name || '');
  const checks = [];
  const add = (status, title, detail) => checks.push({ status, title, detail });
  if (/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(name)) add('pass', 'Name format', `"${name}" uses letters, digits, dash and underscore, up to 40 characters.`);
  else add('fail', 'Name format', 'Use 1 to 40 letters, digits, dash or underscore, starting with a letter or digit.');
  if (name !== name.toLowerCase()) add('warn', 'Lower case', 'Mixed case works, but lower-case names are easier to type in mvl commands and match in scripts.');
  if (/^\d+$/.test(name)) add('fail', 'Not only digits', 'Windows refuses a computer name made only of digits.');
  if (RESERVED.includes(name.toUpperCase())) add('fail', 'Reserved name', `${name.toUpperCase()} is reserved by Windows or networking and causes confusing failures.`);
  if (p.os === 'windows' && name.length > 15) add('warn', 'Windows short name', `Windows keeps only the first 15 characters ("${name.slice(0, 15)}") for its NetBIOS name, so two long names that start alike can clash on the network.`);
  if (name.includes('_')) add('warn', 'Underscore', 'An underscore is not valid in a DNS host name. Prefer a dash if anything will look the machine up by name.');
  if (!p.project || p.project === 'general') add('warn', 'Project tag', 'The project is "general". Naming the repository you are proving keeps receipts easy to find.');
  else add('pass', 'Project tag', `Tagged with "${p.project}".`);
  if (p.network === 'bridged' && p.usesDefaultSignIn) add('fail', 'Bridged with the default sign-in', 'Anyone on your LAN could sign in. Choose a password or a random one, or stay on NAT.');
  else if (p.network === 'bridged') add('warn', 'Bridged network', 'The guest is reachable from your LAN. That is fine with a strong password.');
  const fails = checks.filter((c) => c.status === 'fail').length, warns = checks.filter((c) => c.status === 'warn').length;
  answer({ summary: fails ? `${fails} problem${fails === 1 ? '' : 's'} to fix` : warns ? `Fine, with ${warns} note${warns === 1 ? '' : 's'}` : 'Everything checks out', checks });
});
function answer(a) { process.stdout.write(JSON.stringify(Object.assign({ type: 'answer' }, a)) + '\n'); }
