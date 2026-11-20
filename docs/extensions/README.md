# Writing extensions

An extension adds an action to the Material VM Labs manager without changing the manager. It can
summarise a fresh-build receipt, check a machine's name before you create it, or check that a
machine is ready to use. You can write one in any language: the manager runs it as its own program
and talks to it with one line of JSON in and one line of JSON out.

This page covers the folder, the manifest, the permissions, the protocol, the limits and a worked
example. The [samples](https://github.com/Ding-Ding-Projects/material-vm-labs/tree/main/docs/extensions/samples/) are complete extensions you can copy.

## What an extension is

An extension is a folder that holds two things:

- `extension.json`, the manifest: who the extension is, what it hooks, its actions and its permissions.
- A program: a Node.js script, a Python script, a PowerShell script or an `.exe`.

The manager never loads extension code into itself. When you run an action, it starts the program,
writes one request line to the program's standard input, and reads the program's standard output
until one answer line arrives. A broken or hung extension cannot take the manager down: it is stopped
when its time runs out.

## Where extensions live

Extensions live in the `extensions` folder inside the manager's app-data folder, usually
`%APPDATA%\Material VM Labs\extensions`. Each extension has its own folder named after its `id`.

In the manager, open **Tools**, then **Extensions** (or press `Ctrl+Shift+F` and type *Extensions*):

- **Add from a folder** copies a folder you choose into the extensions folder after checking its manifest.
  If an extension with the same id is already installed, it asks before replacing it.
- **Open the extensions folder** opens it in File Explorer.
- **Reload** reads the folder again after you edit something by hand.
- The **master switch** turns every extension off at once.

## The manifest

```json
{
  "manifestVersion": 1,
  "id": "receipt-to-pr-comment",
  "name": "Receipt to pull-request comment",
  "version": "1.0.0",
  "apiVersion": 1,
  "description": "Writes a short pull-request comment from a fresh-build receipt.",
  "author": "You",
  "runtime": "node",
  "main": "main.js",
  "hooks": ["receipt"],
  "actions": [
    { "id": "comment", "title": "Write a pull-request comment", "hook": "receipt" }
  ],
  "permissions": ["receive:receipt", "answer:report"],
  "timeoutSeconds": 5
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `manifestVersion` | yes | Always `1`. |
| `id` | yes | 2 to 48 lower-case letters, digits or hyphens. It must match the folder name. |
| `name` | yes | What the manager shows, up to 60 characters. |
| `version` | yes | `major.minor.patch`, for example `1.2.0`. A new version asks for your permission again. |
| `apiVersion` | yes | The protocol version the extension speaks. This manager speaks `1`; a higher number is refused with a message that a newer manager is needed. |
| `description` | yes | One or two sentences, up to 400 characters. |
| `author` | no | Up to 80 characters. |
| `runtime` | yes | `node`, `python`, `powershell` or `executable` (see below). |
| `main` | yes | The program file, relative to the extension folder, with forward slashes. It cannot leave the folder. |
| `hooks` | yes | The places the extension hooks into (see below), one to three. |
| `actions` | yes | One to ten actions. Each has an `id`, a `title`, the `hook` it runs on and an optional `description`. |
| `permissions` | yes | What the extension may receive and answer (see below). |
| `timeoutSeconds` | no | How long one run may take, 1 to 30 seconds. The default is 10. |

Any other field is refused, so a typing mistake is caught instead of being ignored.

## Hooks

| Hook | Where it appears | Input the extension gets |
| --- | --- | --- |
| `receipt` | A button on each receipt on the Receipts page, and Run in the Extensions tool with a receipt picker | `input.receipt` |
| `machine-plan` | **Check with extensions** on the Create machine sheet | `input.plan` |
| `machine` | Run in the Extensions tool with a machine picker | `input.machine` |

Matching a hook costs nothing: the program only starts when you press the button.

`input.receipt` holds `kind`, `runId`, `verdict`, `repository`, `commit`, `hostMinutes`,
`finishedUtc`, `entrypoints` (each with `name`, `result`, `exitCode`), `dependencies` (counts of
`tools`, `programs`, `choco` packages, `folders` and `megabytes`) and `machine` (`name`, `project`,
`hypervisor`, `memoryMB`, `cpus`, `network`, `guestOs`). It never holds a file path.

`input.plan` holds `name`, `project`, `os`, `hypervisor`, `memoryMB`, `cpus`, `network`,
`guestUser`, `usesDefaultSignIn` (true or false), `forWhom` and `requireTpm`. It never holds the
password, only whether the default one is in use.

`input.machine` holds `name`, `project`, `os`, `hypervisor`, `power`, `status` and `runners`, plus
`ip` when the extension has the `receive:machine-address` permission.

## Permissions

| Permission | What it allows |
| --- | --- |
| `receive:receipt` | Receive a receipt summary. Needed by the `receipt` hook. |
| `receive:machine-plan` | Receive the Create sheet's choices. Needed by the `machine-plan` hook. |
| `receive:machine` | Receive an existing machine's facts. Needed by the `machine` hook. |
| `receive:machine-address` | Also receive the machine's IP address. Only with `receive:machine`. |
| `answer:report` | Answer with a report, shown as rendered Markdown. |
| `answer:checks` | Answer with a list of checks marked pass, warning or fail. |

The manager enforces permissions on both sides: it only hands over the fields a permission covers,
and it refuses an answer that contains something the extension was not allowed to answer with.

### Consent

A new extension stays off until you allow exactly the permissions it asks for. The prompt lists them
in plain words. When an extension's version or permissions change, it turns itself off again and the
prompt shows what is new, what was already allowed and what is no longer asked for. Nothing runs
until you decide.

### What is never handed over

Guest passwords, runner registration tokens, credentials, keys and your personal vocabulary file are
never handed over. Inputs are built from a list of allowed fields, and secret-looking names and
values are removed again before sending. The program also starts with a minimal environment: your
`PATH`, temporary folders and a few `MVL_EXTENSION_*` variables, but not the manager's other
environment variables, so tokens such as `GH_TOKEN` do not reach it.

### What cannot be enforced

An extension is still a program running as you. It can read any file you can read and use the
network like any other program. Permissions limit what Material VM Labs hands over and what it
accepts back; they are not a sandbox. Only add extensions you trust.

## The protocol

The manager writes one line to standard input, then closes it:

```json
{"protocol":"mvl-extension/1","type":"run","apiVersion":1,"extension":{"id":"receipt-to-pr-comment","version":"1.0.0"},"action":"comment","hook":"receipt","input":{"receipt":{"repository":"octo-org/my-app","commit":"4f1c2ab9d0e7","verdict":"passed","entrypoints":[{"name":"build","result":"passed","exitCode":0}]}},"limits":{"timeoutMs":5000,"maxAnswerBytes":65536,"maxReportChars":32000,"maxChecks":50}}
```

The extension writes lines to standard output, each one a complete JSON object followed by a newline:

- Any number of log lines, which the manager shows under the result: `{"type":"log","message":"Reading the receipt"}`
- Exactly one answer line, after which the manager stops reading:

```json
{"type":"answer","summary":"Comment ready","report":"**Fresh-host build passed** for `4f1c2ab9d0e7`."}
```

or, with `answer:checks`:

```json
{"type":"answer","summary":"1 problem to fix","checks":[{"status":"fail","title":"Name format","detail":"Use letters, digits and dashes."}]}
```

An answer may hold `summary` (up to 200 characters), `report` (Markdown, up to 32,000 characters)
and `checks` (up to 50, each with `status` of `pass`, `warn` or `fail`, a `title` up to 120 characters
and an optional `detail` up to 1,000). Reports are rendered with headings, lists, tables, code,
links and emoji shortcodes such as `:white_check_mark:`. Raw HTML is shown as text, nothing runs, and
links open in your browser only when you click them.

Write anything else, such as debugging output, to standard error. It is shown when a run fails.

## Limits

| Limit | Value |
| --- | --- |
| Time per run | `timeoutSeconds` from the manifest, 10 seconds by default, 30 at most. The program is stopped when it runs out. |
| One output line | 64 KB |
| All output | 256 KB |
| Standard error kept | 16 KB |
| Report | 32,000 characters |
| Checks | 50 |
| Folder added from disk | 20 MB and 500 files; shortcut links are skipped |

Every failure names the extension and says what went wrong, for example *Sample did not answer within
5 seconds and was stopped* or *Sample gave an answer the manager refused: the answer contains checks,
but the extension was not allowed answer:checks*.

## Runtimes

| `runtime` | How it starts |
| --- | --- |
| `node` | With the copy of Node.js built into Material VM Labs, so it always works. |
| `powershell` | With Windows PowerShell (`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File main.ps1`), which every Windows PC has. |
| `python` | With `py -3` on Windows, or `python3`. When Python is not installed, the run says so. |
| `executable` | Runs `main` directly. On Windows it must be an `.exe`. |

The program starts in its own folder, with no shell in between.

## Built-in extensions

The manager ships two extensions, marked **Built in**:

- **Receipt summary** turns a receipt into a pull-request-ready Markdown summary.
- **Machine name policy** checks a new machine's name and options on the Create sheet: name format,
  the 15-character Windows network name, names Windows reserves, a project tag, and a bridged
  network with the default sign-in.

They need your permission like any other extension. The manager updates them only while you have
not changed them; once you edit one, it is marked **Modified** and left alone. You can remove them,
and **Restore built-in extensions** brings them back.

## Worked example

This builds the [receipt-to-pr-comment](https://github.com/Ding-Ding-Projects/material-vm-labs/tree/main/docs/extensions/samples/receipt-to-pr-comment/) sample from nothing.

1. Make a folder named `receipt-to-pr-comment` anywhere, for example on your desktop.
2. Save the manifest above in it as `extension.json`.
3. Save this as `main.js` in the same folder:

   ```js
   let raw = '';
   process.stdin.on('data', (chunk) => { raw += chunk; });
   process.stdin.on('end', () => {
     const r = JSON.parse(raw.split('\n')[0]).input.receipt;
     const report = `**Fresh-host build ${r.verdict}** for \`${r.commit}\`.`;
     process.stdout.write(JSON.stringify({ type: 'answer', summary: 'Comment ready', report }) + '\n');
   });
   ```

4. Try it by hand before adding it. In a terminal in that folder:

   ```bat
   echo {"type":"run","action":"comment","hook":"receipt","input":{"receipt":{"verdict":"passed","commit":"4f1c2ab"}}} | node main.js
   ```

   It prints `{"type":"answer","summary":"Comment ready","report":"**Fresh-host build passed** for `4f1c2ab`."}`.
5. In the manager, open **Tools**, **Extensions**, **Add from a folder**, and choose the folder.
6. The consent prompt lists `receive:receipt` and `answer:report`. Choose **Allow and turn on**.
7. Open **Receipts**. Each receipt now has a **Write a pull-request comment** button. Press it to see the rendered comment.

If something is wrong, the Extensions tool shows the refusal with the exact field, for example
*The receipt hook needs the receive:receipt permission*.

## Samples

| Sample | Language | Hook | What it shows |
| --- | --- | --- | --- |
| [receipt-to-pr-comment](https://github.com/Ding-Ding-Projects/material-vm-labs/tree/main/docs/extensions/samples/receipt-to-pr-comment/) | Node.js | `receipt` | A report with a table, and log lines |
| [machine-power-check](https://github.com/Ding-Ding-Projects/material-vm-labs/tree/main/docs/extensions/samples/machine-power-check/) | Python 3 | `machine` | Checks, and the optional address permission |
| [receipt-gate](https://github.com/Ding-Ding-Projects/material-vm-labs/tree/main/docs/extensions/samples/receipt-gate/) | PowerShell | `receipt` | Checks that act as a release gate |

The repository's tests run every sample through the real process runner, so they stay working.
