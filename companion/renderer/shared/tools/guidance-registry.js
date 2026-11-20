'use strict';
// Hand-written guidance inventory for the manager. Three lists, all declarative:
//   CONTROLS  every guided control: where it is (CSS selector, found at run time), its stable concept
//             id, the full explanation, guided steps, a worked example and a practice playground
//             (synthetic fields plus a pure evaluate function; it never touches live values).
//   SETTINGS  every settings element, with where its value is stored, so the provenance line can say
//             truthfully whether it was written or is the compiled-in default.
//   POINTERS  every message or switch that points at Settings, with the quick-add field beside it.
//             Each pointer names the same stored key as its SETTINGS row.
//   EXEMPT    interactive elements that deliberately have no playground, each with its reason.
// guidance-forms.js reads these lists; the tests read them too (Node can require this file).
(function (root) {
  // ---------- Pure checks shared by playgrounds and quick add (same rules as the manager) ----------
  const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/; // app.js NAME_RE
  const REPO_RE = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
  const LABEL_RE = /^[A-Za-z0-9._-]{1,64}$/;
  const SAMPLE_MACHINES = ['proof-1', 'installer-check', 'linux-docker']; // synthetic, not your machines
  const NETS = { nat: 'NAT', bridged: 'Bridged', hostonly: 'Host-only' };
  const NET_HELP = {
    nat: 'NAT: the guest reaches the internet through this PC and is not visible on your LAN. The safe default.',
    bridged: 'Bridged: the guest gets its own address on your LAN, so other devices can reach it.',
    hostonly: 'Host-only: only this PC can reach the guest; the guest has no internet.'
  };
  const SIZES = { s: '8 GB memory, 4 vCPU', m: '12 GB memory, 8 vCPU', l: '16 GB memory, 12 vCPU' };

  function checkStateRoot(v) {
    v = String(v || '').trim();
    if (v.length > 400) return { ok: false, message: 'Too long: a state root path can be at most 400 characters.' };
    if (/[<>|"*?\0]/.test(v)) return { ok: false, message: 'That path has characters a Windows folder cannot contain: < > | " * ?' };
    if (!v) return { ok: true, message: 'Empty is fine: the manager uses MVL_HOME, or %LOCALAPPDATA%\\MaterialVmLabs.' };
    if (!/^([A-Za-z]:\\|\\\\|\/)/.test(v)) return { ok: true, message: 'Accepted, but it is not a full path. Use one such as D:\\Labs so it does not depend on the working folder.' };
    return { ok: true, message: `Accepted. Machines would live in ${v.replace(/[\\/]+$/, '')}\\vms and receipts in ${v.replace(/[\\/]+$/, '')}\\runs.` };
  }
  function checkName(v, taken) {
    v = String(v || '').trim();
    if (!NAME_RE.test(v)) return { ok: false, message: 'Letters, digits, dash and underscore; up to 40, starting with a letter or digit.' };
    if ((taken || SAMPLE_MACHINES).some((x) => x.toLowerCase() === v.toLowerCase())) return { ok: false, message: 'A machine with this name already exists.' };
    return { ok: true, message: `"${v}" is free. The CLI command would be: mvl new ${v}` };
  }
  function checkRepo(v) {
    v = String(v || '').trim();
    if (!v) return { ok: false, message: 'Type owner/name, for example octo-org/my-app.' };
    if (!REPO_RE.test(v)) return { ok: false, message: 'Use owner/name: letters, digits and dashes for the owner; letters, digits, dot, dash and underscore for the name.' };
    return { ok: true, message: `Fresh build would clone https://github.com/${v} at the ref you give (or its default branch).` };
  }
  function checkLabels(v) {
    const parts = String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
    const bad = parts.filter((p) => !LABEL_RE.test(p));
    if (bad.length) return { ok: false, message: `Not a valid label: ${bad.join(', ')}. Use letters, digits, dot, dash and underscore.` };
    return { ok: true, message: `runs-on: [self-hosted, ${['windows', 'x64'].concat(parts).join(', ')}]` };
  }
  function checkPassword(v) {
    v = String(v || '');
    if (!v) return { ok: true, message: 'Empty means the default password. Fine on NAT; not on a bridged network.' };
    if (v.length < 4) return { ok: false, message: 'At least 4 characters.' };
    return { ok: true, message: `Accepted: ${v.length} characters. It would be stored encrypted for this PC and never shown again.` };
  }
  function planCommand(d) {
    const parts = ['mvl new', d.name || '<name>'];
    if (d.os && d.os !== 'windows') parts.push('--os ' + d.os);
    if (d.net && d.net !== 'nat') parts.push('--net ' + d.net);
    const sz = { s: [8192, 4], m: [12288, 8], l: [16384, 12] }[d.size];
    if (sz) parts.push('--mem ' + sz[0], '--cpus ' + sz[1]); // the Create sheet always passes both
    return parts.join(' ');
  }

  const CHECKS = { checkStateRoot, checkName, checkRepo, checkLabels, checkPassword, planCommand };

  // ---------- Guided controls ----------
  // scope: a selector the target must sit inside. anchor: 'self' (default) or 'field' (the enclosing label).
  const CONTROLS = [
    // Settings page
    { id: 'settings.state-root', concept: 'state-root', scope: '#panel-settings', sel: '#sRoot', anchor: 'field', title: 'State root',
      explain: 'The folder where the manager and the mvl CLI keep everything they make: each machine\'s folder under vms, fresh-build receipts under runs, downloaded media under media and screenshots under screenshots. Changing it does not move anything; it points the manager at another folder.',
      details: { Default: 'Empty, which means MVL_HOME when that variable is set, otherwise %LOCALAPPDATA%\\MaterialVmLabs.', Effect: 'Apply state root reloads the machine list and receipts from the new folder.', Validation: 'At most 400 characters, none of < > | " * ?', Recovery: 'Clear the box and apply to go back to the default folder. Nothing is deleted either way.' },
      steps: ['Decide where lab machines should live. They are large (60 GB or more each), so pick a drive with room.', 'Type the full folder path, for example D:\\Labs, or leave it empty for the default.', 'Press Apply state root. The machine list reloads from that folder.'],
      example: { input: 'D:\\Labs', action: 'Type it into the practice box', expected: 'Accepted: machines in D:\\Labs\\vms and receipts in D:\\Labs\\runs.' },
      play: { fields: [{ name: 'v', kind: 'text', label: 'Practice state root', initial: 'D:\\Labs' }], evaluate: (d) => checkStateRoot(d.v) } },
    { id: 'settings.default-network', concept: 'network-mode', scope: '#panel-settings', sel: '#sNet', title: 'Default network',
      explain: 'Which network mode the Create sheet starts with for every new machine. You can still choose another mode for one machine on the sheet.',
      details: { Options: 'NAT, Bridged, Host-only.', Default: 'NAT.', Effect: 'Only new machines; existing machines keep their network.', Recovery: 'Pick NAT again.' },
      steps: ['Pick the mode most of your machines need. NAT suits fresh builds; Bridged suits testing from other devices on your LAN.'],
      example: { input: 'Bridged', action: 'Pick Bridged below', expected: 'The guest gets its own LAN address; choose a password for it.' },
      play: { fields: [{ name: 'net', kind: 'choice', label: 'Practice network', options: NETS, initial: 'bridged' }], evaluate: (d) => ({ ok: true, message: NET_HELP[d.net] + (d.net === 'bridged' ? ' With the default password, anyone on the LAN could sign in.' : '') }) } },
    { id: 'settings.theme', concept: 'appearance-theme', scope: '#panel-settings', sel: '[role="group"][aria-label="Theme"]', title: 'Theme',
      explain: 'Light, dark, or follow Windows. Every colour role is regenerated from your seed colour in the chosen scheme.',
      details: { Options: 'System, Light, Dark.', Default: 'System.', Effect: 'Applies at once to every companion window on this PC.', Recovery: 'Pick System.' },
      steps: ['Pick a theme. It applies immediately; there is nothing to save.'],
      example: { input: 'Dark', action: 'Pick Dark below', expected: 'The sample card turns dark; your real theme stays as it is.' },
      play: { fields: [{ name: 'mode', kind: 'choice', label: 'Practice theme', options: { light: 'Light', dark: 'Dark' }, initial: 'dark' }], evaluate: (d) => ({ ok: true, message: `The sample card shows the ${d.mode} scheme.`, sample: d.mode }) } },
    { id: 'settings.seed', concept: 'appearance-seed', scope: '#panel-settings', sel: '[role="group"][aria-label="Seed colour"]', title: 'Seed colour',
      explain: 'The colour the whole Material 3 palette is generated from: buttons, chips, the rail and highlights all derive from it.',
      details: { Options: 'The named seeds shown as swatches.', Default: 'Violet.', Effect: 'Applies at once.', Recovery: 'Pick Violet.' },
      steps: ['Click a swatch. The name is in its tooltip.'],
      example: { input: 'A swatch', action: 'Pick one in the practice row', expected: 'The sample chip takes that seed; your real colours stay.' },
      play: { fields: [{ name: 'seed', kind: 'choice', label: 'Practice seed', options: { '#6750A4': 'Violet', '#006A6A': 'Teal', '#8B5000': 'Amber' }, initial: '#006A6A' }], evaluate: (d) => ({ ok: true, message: 'The sample chip uses ' + d.seed + '.', swatch: d.seed }) } },
    { id: 'settings.reduce-motion', concept: 'reduce-motion', scope: '#panel-settings', sel: '[data-motion-pick]', anchor: 'row', title: 'Reduce motion',
      explain: 'Turns off movement: pages, sheets, lists and the drawing toolbar change instantly instead of animating. Everything still works.',
      details: { Default: 'Off, unless Windows asks for reduced motion.', Effect: 'Applies at once.', Recovery: 'Switch it off again.' },
      steps: ['Switch it on if motion is distracting or makes you uncomfortable.'],
      example: { input: 'On', action: 'Switch the practice switch on', expected: 'The sample dot jumps instead of sliding.' },
      play: { fields: [{ name: 'on', kind: 'switch', label: 'Practice: reduce motion', initial: true }], evaluate: (d) => ({ ok: true, message: d.on ? 'Instant: the sample dot jumps.' : 'Animated: the sample dot slides.', motion: !d.on }) } },
    { id: 'settings.language', concept: 'language', scope: '#panel-settings', sel: '#sLang', title: 'Language',
      explain: 'Shows the interface in English, Hong Kong Cantonese, or both side by side. Commands, file names and paths always stay literal so they can be typed.',
      details: { Options: 'English, Cantonese, Both.', Default: 'English.', Effect: 'Applies at once to labels, buttons and messages.', Recovery: 'Pick English.' },
      steps: ['Pick a language mode. Words without a translation stay in English rather than being guessed.'],
      example: { input: 'Settings', action: 'Pick Cantonese', expected: '設定' },
      play: { fields: [{ name: 'phrase', kind: 'text', label: 'Practice phrase', initial: 'Settings' }, { name: 'mode', kind: 'choice', label: 'Practice mode', options: { en: 'English', yue: 'Cantonese', bi: 'Both' }, initial: 'yue' }],
        evaluate: (d) => { const t = root.MVLI18n && root.MVLI18n.translate ? root.MVLI18n.translate(d.phrase) : d.phrase; const has = t !== d.phrase; return { ok: true, message: d.mode === 'en' ? d.phrase : !has ? 'No translation for that phrase; it stays in English.' : d.mode === 'yue' ? t : d.phrase + ' / ' + t }; } } },
    { id: 'settings.vocabulary', concept: 'personal-vocabulary', scope: '#panel-settings', sel: '#sVocab', title: 'Personal vocabulary',
      explain: 'Your own word list that renames words across the apps and the site, loaded from a JSON file. It stays on this device. Clear restores the normal wording.',
      details: { Format: '{"schemaVersion": 1, "entries": {"word": "your word"}}', Default: 'No vocabulary.', Validation: 'schemaVersion must be 1 and entries an object of text to text.', Recovery: 'Clear removes it.' },
      steps: ['Write a JSON file with schemaVersion 1 and your entries.', 'Load it here or drop it on the card.', 'Check a page: your words appear; Clear undoes it.'],
      example: { input: '{"schemaVersion":1,"entries":{"machine":"box"}}', action: 'Check it in the practice box', expected: 'Valid: "machine" would read "box".' },
      play: { fields: [{ name: 'json', kind: 'textarea', label: 'Practice vocabulary JSON', initial: '{"schemaVersion":1,"entries":{"machine":"box"}}' }],
        evaluate: (d) => { let j; try { j = JSON.parse(d.json); } catch (e) { return { ok: false, message: 'Not valid JSON: ' + e.message }; } if (!j || j.schemaVersion !== 1 || !j.entries || typeof j.entries !== 'object' || Array.isArray(j.entries)) return { ok: false, message: 'Needs "schemaVersion": 1 and an "entries" object.' }; const k = Object.keys(j.entries); if (k.some((x) => typeof j.entries[x] !== 'string')) return { ok: false, message: 'Every entry must map text to text.' }; return { ok: true, message: k.length ? `Valid: ${k.slice(0, 3).map((x) => `"${x}" would read "${j.entries[x]}"`).join(', ')}.` : 'Valid but empty: nothing would change.' }; } } },
    { id: 'settings.motion-editor', concept: 'motion-editor', scope: '#panel-settings', sel: '#sMotionEditor', title: 'Animation and transition editor',
      explain: 'Tunes each kind of movement (pages, lists, dialogs, menus, switches and more): duration, easing, distance and scale, from named profiles. Reduce motion overrides it.',
      details: { Default: 'The Expressive profile.', Effect: 'Applies at once.', Recovery: 'Choose the Expressive profile again.' },
      steps: ['Pick a profile to start from.', 'Adjust one kind, for example Dialogs, and watch its preview.', 'Keep it, or pick the profile again to undo.'],
      example: { input: '600 ms', action: 'Drag the practice slider', expected: 'The sample dot takes 600 ms to cross.' },
      play: { fields: [{ name: 'ms', kind: 'range', label: 'Practice duration (ms)', min: 0, max: 1200, step: 50, initial: 600 }], evaluate: (d) => ({ ok: true, message: `The sample dot takes ${d.ms} ms to cross.`, motion: true, ms: Number(d.ms) }) } },
    { id: 'settings.notifications', concept: 'notifications', scope: '#panel-settings', sel: '#sNotify', title: 'Notifications and sounds',
      explain: 'Whether a finished install celebrates with a full-screen takeover or a quiet notification, and whether actions play short tones. Every message is also kept in the notification centre.',
      details: { Default: 'Takeovers on, sounds on.', Recovery: 'Switch them back on.' },
      steps: ['Switch takeovers off if full-screen results interrupt you; they become ordinary notifications.'],
      example: { input: 'Takeovers off', action: 'Switch the practice switch off', expected: 'A finished install would arrive as a notification.' },
      play: { fields: [{ name: 'take', kind: 'switch', label: 'Practice: takeovers', initial: false }], evaluate: (d) => ({ ok: true, message: d.take ? 'A finished install would fill the screen until you dismiss it.' : 'A finished install would arrive as a notification.' }) } },
    { id: 'settings.funny', concept: 'funny-level', scope: '#panel-settings', sel: '#sFunny', title: 'Funny level',
      explain: 'How playful the wording of messages is, from 1 (plain) to 5 (playful), set separately for English and Cantonese. Errors stay plain at every level.',
      details: { Default: '5 in both languages, with emoji.', Recovery: 'Set the level back to 5, or to 1 for plain wording.' },
      steps: ['Move the slider for the language you read.'],
      example: { input: '1', action: 'Set the practice slider to 1', expected: 'Plain wording.' },
      play: { fields: [{ name: 'lvl', kind: 'range', label: 'Practice level', min: 1, max: 5, step: 1, initial: 1 }], evaluate: (d) => ({ ok: true, message: ['', 'Level 1: plain wording only.', 'Level 2: a light touch.', 'Level 3: friendly.', 'Level 4: playful.', 'Level 5: the most playful, with emoji when they are on.'][Number(d.lvl)] }) } },
    { id: 'settings.dimsum', concept: 'dim-sum-surprise', scope: '#panel-settings', sel: '#sDimsum', title: 'Dim sum surprise',
      explain: 'Now and then a dish from the public dim sum photo catalogue says hello at startup. The photo is fetched by the main process and cached; the page never touches the network.',
      details: { Default: 'On.', Effect: 'At most one surprise per start, and never during the first-run setup.' },
      steps: ['Leave it on for an occasional photo, or switch it off.'],
      example: { input: 'Off', action: 'Switch the practice switch off', expected: 'No surprise at the next start.' },
      play: { fields: [{ name: 'on', kind: 'switch', label: 'Practice: dim sum surprise', initial: false }], evaluate: (d) => ({ ok: true, message: d.on ? 'About one start in ten shows a dish.' : 'No surprise at the next start.' }) } },
    { id: 'settings.narrator', concept: 'narrator', scope: '#panel-settings', sel: '#sNarrator', title: 'Narrator',
      explain: 'Reads status changes aloud with a voice installed on this PC, in English or Cantonese, at the rate and pitch you set. Off by default.',
      details: { Default: 'Off, rate 1, pitch 1.', Recovery: 'Switch it off.' },
      steps: ['Switch it on.', 'Pick a voice for each language.', 'Adjust the rate if it speaks too fast.'],
      example: { input: 'Rate 1.5', action: 'Move the practice slider', expected: 'Speech would be half as fast again.' },
      play: { fields: [{ name: 'rate', kind: 'range', label: 'Practice rate', min: 0.5, max: 2, step: 0.1, initial: 1.5 }], evaluate: (d) => ({ ok: true, message: `Rate ${Number(d.rate).toFixed(1)}: ${Number(d.rate) > 1 ? 'faster' : Number(d.rate) < 1 ? 'slower' : 'normal speed'}.` }) } },

    // Create sheet
    { id: 'create.name', concept: 'machine-name', scope: '.create-sheet', sel: '[data-f="name"]', anchor: 'field', title: 'Machine name',
      explain: 'The name you use in every mvl command and on its card. It also names its folder in the state root.',
      details: { Default: 'proof-1.', Validation: '1 to 40 letters, digits, dash or underscore, starting with a letter or digit, and not already used.', Recovery: 'Edit the name; nothing is created until you press Create.' },
      steps: ['Type a short name that says what the machine proves, for example installer-check.'],
      example: { input: 'proof 2', action: 'Type it into the practice box', expected: 'Refused: letters, digits, dash and underscore only.' },
      play: { fields: [{ name: 'v', kind: 'text', label: 'Practice name', initial: 'proof 2' }], evaluate: (d) => checkName(d.v) } },
    { id: 'create.project', concept: 'machine-project', scope: '.create-sheet', sel: '[data-f="project"]', anchor: 'field', title: 'Project',
      explain: 'A tag that groups machines and their receipts, usually the repository the machine proves.',
      details: { Default: 'general.', Validation: 'Any short text; empty becomes general.' },
      steps: ['Type the repository or product name.'],
      example: { input: 'my-app', action: 'Type it', expected: 'Receipts from this machine are tagged my-app.' },
      play: { fields: [{ name: 'v', kind: 'text', label: 'Practice project', initial: 'my-app' }], evaluate: (d) => ({ ok: true, message: `Tagged ${String(d.v || '').trim() || 'general'}.` }) } },
    { id: 'create.system', concept: 'guest-system', scope: '.create-sheet', sel: '[role="group"][aria-label="System"]', title: 'System',
      explain: 'The guest operating system. Windows 11 installs unattended from Microsoft\'s evaluation media in about 13 minutes; Ubuntu and Debian start from official cloud images with Docker and the Codex CLI in a few minutes (VMware only).',
      details: { Options: 'Windows 11, Ubuntu 24.04, Debian 13.', Default: 'Windows 11.' },
      steps: ['Pick the system your build or installer targets.'],
      example: { input: 'Ubuntu 24.04', action: 'Pick it', expected: 'mvl new <name> --os ubuntu, VMware only.' },
      play: { fields: [{ name: 'os', kind: 'choice', label: 'Practice system', options: { windows: 'Windows 11', ubuntu: 'Ubuntu 24.04', debian: 'Debian 13' }, initial: 'ubuntu' }], evaluate: (d) => ({ ok: true, message: planCommand({ name: 'proof-1', os: d.os }) + (d.os === 'windows' ? ' (about 13 minutes)' : ' (a few minutes, VMware only)') }) } },
    { id: 'create.who', concept: 'machine-user', scope: '.create-sheet', sel: '[role="group"][aria-label="Who uses it"]', title: 'Who uses it',
      explain: 'You get the tools preinstalled and a shared folder; Claude (an agent) gets a bare machine so a fresh build proves no hidden dependencies.',
      details: { Options: 'You, Claude.', Default: 'You.' },
      steps: ['Pick Claude when an agent will run builds on it.'],
      example: { input: 'Claude', action: 'Pick it', expected: 'Tools and the shared folder switch off.' },
      play: { fields: [{ name: 'who', kind: 'choice', label: 'Practice: who uses it', options: { you: 'You', agent: 'Claude' }, initial: 'agent' }], evaluate: (d) => ({ ok: true, message: d.who === 'agent' ? 'Bare machine: no preinstalled tools, no shared folder.' : 'Tools preinstalled and a shared folder.' }) } },
    { id: 'create.tools', concept: 'preinstall-tools', scope: '.create-sheet', sel: '[data-sw="tools"]', title: 'Preinstall tools',
      explain: 'Installs Git, Chocolatey, the GitHub CLI and Codex on a Windows guest after setup. Leave it off to prove a build needs nothing extra.',
      details: { Default: 'On for you, off for Claude.' },
      steps: ['Switch it off for a clean dependency proof.'],
      example: { input: 'Off', action: 'Switch it off', expected: 'A bare Windows guest.' },
      play: { fields: [{ name: 'on', kind: 'switch', label: 'Practice: preinstall tools', initial: false }], evaluate: (d) => ({ ok: true, message: d.on ? 'Git, Chocolatey, GitHub CLI and Codex are installed.' : 'A bare Windows guest.' }) } },
    { id: 'create.share', concept: 'shared-folder', scope: '.create-sheet', sel: '[data-sw="share"]', title: 'Shared folder',
      explain: 'Creates a folder on this PC that the guest can see, and opens it here when the machine is ready.',
      details: { Default: 'On for you, off for Claude.' },
      steps: ['Leave it on to move files in and out easily.'],
      example: { input: 'On', action: 'Switch it on', expected: 'A shared folder appears under the machine\'s folder.' },
      play: { fields: [{ name: 'on', kind: 'switch', label: 'Practice: shared folder', initial: true }], evaluate: (d) => ({ ok: true, message: d.on ? 'A shared folder is created and opened.' : 'No shared folder.' }) } },
    { id: 'create.hypervisor', concept: 'hypervisor', scope: '.create-sheet', sel: '[role="group"][aria-label="Hypervisor"]', title: 'Hypervisor',
      explain: 'Auto uses VMware Workstation when present and falls back to VirtualBox. The choice is reported on every run.',
      details: { Options: 'Auto, VMware, VirtualBox.', Default: 'Auto.', Validation: 'VirtualBox is disabled when it is not usable on this PC, with the reason.' },
      steps: ['Leave Auto unless you need one hypervisor specifically.'],
      example: { input: 'Auto', action: 'Pick it', expected: 'VMware first, VirtualBox fallback.' },
      play: { fields: [{ name: 'hv', kind: 'choice', label: 'Practice hypervisor', options: { auto: 'Auto', vmware: 'VMware', virtualbox: 'VirtualBox' }, initial: 'auto' }], evaluate: (d) => ({ ok: true, message: d.hv === 'auto' ? 'VMware first, VirtualBox fallback.' : `Only ${d.hv === 'vmware' ? 'VMware' : 'VirtualBox'}; the run fails if it is missing.` }) } },
    { id: 'create.size', concept: 'machine-size', scope: '.create-sheet', sel: '[role="group"][aria-label="Size"]', title: 'Size',
      explain: 'Memory and virtual processors for the guest. Bigger builds finish faster but leave less for this PC.',
      details: { Options: SIZES.s + '; ' + SIZES.m + '; ' + SIZES.l + '.', Default: SIZES.m + '.' },
      steps: ['Pick the size; stay below half of this PC\'s memory if you keep working while it builds.'],
      example: { input: '16 GB', action: 'Pick the large size', expected: SIZES.l + '.' },
      play: { fields: [{ name: 'size', kind: 'choice', label: 'Practice size', options: { s: '8 GB', m: '12 GB', l: '16 GB' }, initial: 'l' }], evaluate: (d) => ({ ok: true, message: SIZES[d.size] + '.' }) } },
    { id: 'create.network', concept: 'network-mode', scope: '.create-sheet', sel: '[role="group"][aria-label="Network"]', title: 'Network',
      explain: 'How the guest connects. It starts from your default network in Settings.',
      details: { Options: 'NAT, Bridged, Host-only.', Default: 'Your Settings default (NAT unless you changed it).', Validation: 'Bridged with the default password shows a warning.' },
      steps: ['Pick NAT unless something on your LAN must reach the guest.'],
      example: { input: 'Bridged, no password', action: 'Pick Bridged and leave the practice password empty', expected: 'Warning: anyone on the LAN could sign in.' },
      play: { fields: [{ name: 'net', kind: 'choice', label: 'Practice network', options: NETS, initial: 'bridged' }, { name: 'pw', kind: 'password', label: 'Practice password', initial: '' }],
        evaluate: (d) => ({ ok: !(d.net === 'bridged' && !d.pw), message: d.net === 'bridged' && !d.pw ? 'Warning: on your LAN with the default password, anyone on the LAN can sign in.' : NET_HELP[d.net] }) } },
    { id: 'create.user', concept: 'guest-user', scope: '.create-sheet', sel: '[data-f="user"]', anchor: 'field', title: 'Guest user',
      explain: 'The account created inside the guest. Linux guests use it in lower case.',
      details: { Default: 'mvlbuilder.', Validation: 'Empty becomes mvlbuilder.' },
      steps: ['Keep mvlbuilder unless your build expects another account name.'],
      example: { input: 'Builder', action: 'Type it and pick a Linux system', expected: 'builder' },
      play: { fields: [{ name: 'v', kind: 'text', label: 'Practice user', initial: 'Builder' }, { name: 'os', kind: 'choice', label: 'Practice system', options: { windows: 'Windows', ubuntu: 'Linux' }, initial: 'ubuntu' }], evaluate: (d) => { const v = String(d.v || '').trim() || 'mvlbuilder'; return { ok: true, message: 'Guest account: ' + (d.os === 'windows' ? v : v.toLowerCase()) }; } } },
    { id: 'create.password', concept: 'guest-password', scope: '.create-sheet', sel: '[data-f="pw"]', anchor: 'field', title: 'Guest password',
      explain: 'The guest sign-in password. It is stored encrypted for this PC (DPAPI) and never shown again. Empty uses the default password.',
      details: { Default: 'Empty: the default password.', Validation: 'Your text is passed to the CLI and not kept in the page.', Recovery: 'Change it later from the machine\'s page.' },
      steps: ['Type a password, or tick Make a random password instead.'],
      example: { input: 'abc', action: 'Type a short practice password', expected: 'Refused: at least 4 characters.' },
      play: { fields: [{ name: 'pw', kind: 'password', label: 'Practice password (not saved)', initial: 'abc' }], evaluate: (d) => checkPassword(d.pw) } },
    { id: 'create.random', concept: 'random-password', scope: '.create-sheet', sel: '[data-f="rand"]', anchor: 'row', title: 'Random password',
      explain: 'Makes a strong random password for the guest and saves it encrypted for this PC. The password box is ignored.',
      details: { Default: 'Off.' },
      steps: ['Tick it when nobody needs to type the password by hand.'],
      example: { input: 'Ticked', action: 'Tick it', expected: 'The password box is ignored.' },
      play: { fields: [{ name: 'on', kind: 'switch', label: 'Practice: random password', initial: true }], evaluate: (d) => ({ ok: true, message: d.on ? 'A random password is made and saved encrypted; the box is ignored.' : 'Your typed password (or the default) is used.' }) } },
    { id: 'create.tpm', concept: 'require-tpm', scope: '.create-sheet', sel: '[data-f="tpm"]', anchor: 'row', title: 'Require a TPM',
      explain: 'Gives the Windows guest a virtual TPM and refuses to continue without one, for installers that check for it.',
      details: { Default: 'Off.' },
      steps: ['Tick it only when your installer checks for a TPM.'],
      example: { input: 'Ticked', action: 'Tick it', expected: 'Creation stops if a virtual TPM cannot be added.' },
      play: { fields: [{ name: 'on', kind: 'switch', label: 'Practice: require a TPM', initial: true }], evaluate: (d) => ({ ok: true, message: d.on ? 'Creation stops if a virtual TPM cannot be added.' : 'A TPM is added when possible but not required.' }) } },
    { id: 'create.go', concept: 'create-machine', scope: '.create-sheet', sel: '[data-go]', title: 'Create a machine', complex: true,
      explain: 'Starts the real unattended install with the choices above. It runs in the background with live progress in Running operations, and ends at a clean baseline snapshot.',
      details: { Effect: 'Downloads media the first time (several GB), creates the virtual machine, installs the guest and takes the baseline.', Validation: 'The name must be valid and unused.', Recovery: 'Cancel it from Running operations; a cancelled job is recorded as incomplete.' },
      steps: ['Name it (letters, digits, dash, underscore).', 'Pick the system and who uses it.', 'Pick the size and network.', 'Choose a password or a random one, especially on Bridged.', 'Review the command below, then press Create on the sheet.'],
      stepFocus: ['[data-f="name"]', '[role="group"][aria-label="System"] [aria-pressed="true"]', '[role="group"][aria-label="Size"] [aria-pressed="true"]', '[data-f="pw"]', '[data-go]'],
      example: { input: 'ubuntu-check, Ubuntu, NAT', action: 'Fill the practice plan', expected: 'mvl new ubuntu-check --os ubuntu --mem 12288 --cpus 8' },
      play: { fields: [{ name: 'name', kind: 'text', label: 'Practice name', initial: 'ubuntu-check' }, { name: 'os', kind: 'choice', label: 'Practice system', options: { windows: 'Windows 11', ubuntu: 'Ubuntu', debian: 'Debian' }, initial: 'ubuntu' }, { name: 'net', kind: 'choice', label: 'Practice network', options: NETS, initial: 'nat' }, { name: 'size', kind: 'choice', label: 'Practice size', options: { s: '8 GB', m: '12 GB', l: '16 GB' }, initial: 'm' }],
        evaluate: (d) => { const n = checkName(d.name); return n.ok ? { ok: true, message: 'Would run: ' + planCommand(d) } : n; } } },

    // Machine page and runner wizard
    { id: 'machine.repo', concept: 'fresh-build-repo', scope: '[id^="panel-m-"]', sel: '[data-f="repo"]', anchor: 'field', title: 'Repository for a fresh build',
      explain: 'The GitHub repository to clone fresh inside the guest and build with its own build.bat and build-installer.bat.',
      details: { Validation: 'owner/name.', Effect: 'The receipt is bound to the exact commit that was built.' },
      steps: ['Type owner/name.', 'Optionally give a commit or branch.', 'Pick the entrypoints and press Run fresh build.'],
      example: { input: 'octo-org/my-app', action: 'Type it', expected: 'Clones https://github.com/octo-org/my-app.' },
      play: { fields: [{ name: 'v', kind: 'text', label: 'Practice repository', initial: 'octo-org/my-app' }], evaluate: (d) => checkRepo(d.v) } },
    { id: 'machine.ref', concept: 'fresh-build-ref', scope: '[id^="panel-m-"]', sel: '[data-f="ref"]', anchor: 'field', title: 'Ref',
      explain: 'A commit, branch or tag to build. Empty builds the default branch\'s latest commit.',
      details: { Default: 'Empty: the default branch.' },
      steps: ['Paste a commit id to rebuild exactly what a receipt recorded.'],
      example: { input: '4f1c2ab', action: 'Type it', expected: 'Builds exactly that commit.' },
      play: { fields: [{ name: 'v', kind: 'text', label: 'Practice ref', initial: '4f1c2ab' }], evaluate: (d) => { const v = String(d.v || '').trim(); return !v ? { ok: true, message: 'Builds the default branch.' } : /^[A-Za-z0-9._\/-]{1,200}$/.test(v) ? { ok: true, message: /^[0-9a-f]{7,40}$/i.test(v) ? 'Builds exactly that commit.' : 'Builds the tip of ' + v + '.' } : { ok: false, message: 'A ref uses letters, digits, dot, dash, underscore and slashes.' }; } } },
    { id: 'machine.new-password', concept: 'guest-password', scope: '[id^="panel-m-"]', sel: '[data-f="newpw"]', anchor: 'field', title: 'New guest password',
      explain: 'Changes the guest sign-in password. The machine resets to its clean baseline, the password is set, and the baseline is retaken with it.',
      details: { Validation: 'At least 4 characters.', Effect: 'Anything not in the baseline is lost by the reset.' },
      steps: ['Type the new password.', 'Press Change password.'],
      example: { input: 'abc', action: 'Type a short practice password', expected: 'Refused: at least 4 characters.' },
      play: { fields: [{ name: 'pw', kind: 'password', label: 'Practice password (not saved)', initial: 'abc' }], evaluate: (d) => checkPassword(d.pw) } },
    { id: 'machine.gh-repo', concept: 'runner-repo', scope: '[id^="panel-m-"]', sel: '[data-f="ghrepo"]', anchor: 'field', title: 'Private repository for a runner',
      explain: 'The private repository this machine will serve as a self-hosted runner. Public repositories are refused.',
      details: { Validation: 'owner/name of a private repository.' },
      steps: ['Type owner/name.', 'Add labels if your workflows need them.', 'Paste a registration token and register.'],
      example: { input: 'octo-org/private-app', action: 'Type it', expected: 'Accepted as owner/name.' },
      play: { fields: [{ name: 'v', kind: 'text', label: 'Practice repository', initial: 'octo-org/private-app' }], evaluate: (d) => checkRepo(d.v) } },
    { id: 'machine.gh-labels', concept: 'runner-labels', scope: '[id^="panel-m-"]', sel: '[data-f="ghlabels"]', anchor: 'field', title: 'Runner labels',
      explain: 'Extra labels a workflow uses in runs-on to pick this runner, on top of self-hosted, windows and x64.',
      details: { Validation: 'Comma separated; letters, digits, dot, dash and underscore.' },
      steps: ['Type labels separated by commas, for example mvl,installer.'],
      example: { input: 'mvl, installer', action: 'Type it', expected: 'runs-on: [self-hosted, windows, x64, mvl, installer]' },
      play: { fields: [{ name: 'v', kind: 'text', label: 'Practice labels', initial: 'mvl, installer' }], evaluate: (d) => checkLabels(d.v) } },
    { id: 'machine.gh-token', concept: 'runner-token', scope: '[id^="panel-m-"]', sel: '[data-f="ghtoken"]', anchor: 'field', title: 'Registration token',
      explain: 'The short-lived token GitHub shows under Settings, Actions, Runners, New self-hosted runner. It is held in memory only, passed to the CLI on standard input, and dropped.',
      details: { Validation: 'Required to register by hand.', Effect: 'Never written to a file, a log or a job marker.' },
      steps: ['Open the repository\'s New self-hosted runner page on GitHub.', 'Copy the token from the configure command.', 'Paste it here and register.'],
      example: { input: 'A synthetic token', action: 'Type any practice text', expected: 'Shown masked; never stored.' },
      play: { fields: [{ name: 'tok', kind: 'password', label: 'Practice token (synthetic, not saved)', initial: 'SAMPLE' }], evaluate: (d) => ({ ok: !!d.tok, message: d.tok ? `Accepted ${d.tok.length} characters, masked. It would be passed once on standard input and dropped.` : 'Required to register by hand.' }) } },
    { id: 'runner.labels', concept: 'runner-labels', scope: '#ghAssist', sel: '#ghLabels', anchor: 'field', title: 'Runner labels',
      explain: 'Labels your workflow\'s runs-on line uses to pick this self-hosted runner. The line below updates as you type.',
      details: { Validation: 'Comma separated; letters, digits, dot, dash and underscore.' },
      steps: ['Type labels separated by commas.', 'Copy the runs-on line into your workflow.'],
      example: { input: 'mvl, installer', action: 'Type it', expected: 'runs-on: [self-hosted, windows, x64, mvl, installer]' },
      play: { fields: [{ name: 'v', kind: 'text', label: 'Practice labels', initial: 'mvl, installer' }], evaluate: (d) => checkLabels(d.v) } }
  ];

  // Interactive elements without their own playground, each with the reason.
  const EXEMPT = [
    { sel: '#ghName', reason: 'Read-only: the CLI always names the runner mvl-<machine>; its note says so.' },
    { sel: '#sApply', reason: 'Applies the State root field; that field\'s guide covers it and its playground shows the effect.' },
    { sel: '#sFolder', reason: 'Opens the real folder in the file manager; there is no safe practice version of opening a folder.' },
    { sel: '#sSetup', reason: 'Starts the real first-run setup wizard, whose own steps carry their guidance.' },
    { sel: '#sTabsAll', reason: 'Opens tabs; the result is immediate, visible and undone by closing them.' },
    { sel: '#sTabsNew', reason: 'Opens the New tab catalogue, which explains itself.' },
    { sel: '#sPanelReset', reason: 'Moves the running operations panel back to the top; immediate and visible.' },
    { sel: '[data-no]', reason: 'Cancel closes the sheet without creating anything.' }
  ];

  // Every settings element, and where its value lives.
  // source: { kind: 'main', key } (settings.json via mvl:settings-set), { kind: 'local', key, def, label }, or { kind: 'none', note }.
  const SETTINGS = [
    { id: 'settings.state-root', sel: '#sRoot', anchor: 'field', source: { kind: 'main', key: 'stateRoot', label: (v) => v || 'empty (MVL_HOME or %LOCALAPPDATA%\\MaterialVmLabs)' } },
    { id: 'settings.default-network', sel: '#sNet', source: { kind: 'main', key: 'defaultNet', label: (v) => NETS[v] || v } },
    { id: 'settings.theme', sel: '[role="group"][aria-label="Theme"]', source: { kind: 'local', key: 'mvl-theme', def: 'system', label: (v) => ({ system: 'System', light: 'Light', dark: 'Dark' }[v] || v) } },
    { id: 'settings.seed', sel: '[role="group"][aria-label="Seed colour"]', source: { kind: 'local', key: 'mvl-seed', def: 'Violet', label: (v) => v } },
    { id: 'settings.reduce-motion', sel: '[data-motion-pick]', anchor: 'row', source: { kind: 'local', key: 'mvl-reduce-motion', def: 'false', label: (v) => (v === 'true' ? 'On' : 'Off') } },
    { id: 'settings.language', sel: '#sLang', source: { kind: 'local', key: 'mvl-lang', def: 'en', label: (v) => ({ en: 'English', yue: 'Cantonese', bi: 'Both' }[v] || v) } },
    { id: 'settings.vocabulary', sel: '#sVocab', source: { kind: 'local', key: 'mvl-personal-vocabulary', def: '', label: (v) => { try { const j = JSON.parse(v); return j && j.name ? j.name + ' (' + Object.keys(j.entries || {}).length + ' entries)' : 'a vocabulary'; } catch { return v ? 'a vocabulary' : 'none'; } } } },
    { id: 'settings.motion-editor', sel: '#sMotionEditor', source: { kind: 'local', key: 'mvl-motion', def: '', label: (v) => { try { const j = JSON.parse(v); return (j && j.profile) || 'customised'; } catch { return v ? 'customised' : 'the Expressive profile'; } } } },
    { id: 'settings.notifications', sel: '#sNotify', source: { kind: 'local', key: 'mvl-notify-prefs', def: '', label: (v) => { try { const j = JSON.parse(v) || {}; return `takeovers ${j.takeovers === false ? 'off' : 'on'}, sounds ${j.sounds === false ? 'off' : 'on'}`; } catch { return 'takeovers on, sounds on'; } } } },
    { id: 'settings.funny', sel: '#sFunny', source: { kind: 'local', key: 'mvl-funny', def: '', label: (v) => { try { const j = JSON.parse(v) || {}; return `English ${j.en == null ? 5 : j.en}, Cantonese ${j.yue == null ? 5 : j.yue}, emoji ${j.emoji === false ? 'off' : 'on'}`; } catch { return 'English 5, Cantonese 5, emoji on'; } } } },
    { id: 'settings.dimsum', sel: '#sDimsum', source: { kind: 'none', note: 'Not stored: on at every start. Switching it off lasts until the manager restarts.' } },
    { id: 'settings.narrator', sel: '#sNarrator', source: { kind: 'local', key: 'mvl-narrator', def: '', label: (v) => { try { const j = JSON.parse(v) || {}; return `${j.on ? 'on' : 'off'}, rate ${j.rate || 1}`; } catch { return 'off, rate 1'; } } } }
  ];
  // Compiled-in defaults for local keys whose stored form is JSON (named for the provenance line).
  const LOCAL_DEFAULT_TEXT = { 'mvl-personal-vocabulary': 'none', 'mvl-motion': 'the Expressive profile', 'mvl-notify-prefs': 'takeovers on, sounds on', 'mvl-funny': 'English 5, Cantonese 5, emoji on', 'mvl-narrator': 'off, rate 1' };

  // Messages and switches that point at a setting, with the quick-add field beside them.
  // key must equal the SETTINGS source key it writes (the test checks this).
  const POINTERS = [
    { id: 'pointer.machines-empty', where: 'The Machines page when there are no machines', sel: '#panel-machines .empty', key: 'stateRoot', kind: 'text', label: 'Looking for machines in another folder? State root', check: 'checkStateRoot' },
    { id: 'pointer.receipts-empty', where: 'The Receipts page when there are no receipts', sel: '#panel-receipts .empty', key: 'stateRoot', kind: 'text', label: 'Receipts live under the state root. State root', check: 'checkStateRoot' },
    { id: 'pointer.create-network', where: 'The Network choice on the Create sheet, which starts from the Settings default', sel: '.create-sheet [role="group"][aria-label="Network"]', key: 'defaultNet', kind: 'choice', label: 'Default network for new machines', options: NETS },
    { id: 'pointer.attribute', where: 'Any element marked data-settings-pointer="stateRoot" or "defaultNet"', sel: '[data-settings-pointer]', key: '*', kind: 'auto' }
  ];

  const api = { CONTROLS, SETTINGS, POINTERS, EXEMPT, CHECKS, NETS, NET_HELP, LOCAL_DEFAULT_TEXT, MAIN_DEFAULT_LABEL: { stateRoot: 'empty (MVL_HOME or %LOCALAPPDATA%\\MaterialVmLabs)', defaultNet: 'NAT' } };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MVLGuidanceRegistry = api;
})(typeof window !== 'undefined' ? window : globalThis);
