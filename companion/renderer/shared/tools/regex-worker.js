'use strict';
// Isolated regex worker. Runs one job at a time from regex-core.js (match, replace, split, test
// cases, trace, benchmark, growth, GREP) so a slow pattern can never freeze the interface: the host
// stops this worker when a job runs past its time budget. Loads in a browser Worker (importScripts)
// or in a Node worker_threads Worker for tests.
(function () {
  let core, post;
  function handle(job) {
    let res;
    try { res = { id: job && job.id, ok: true, result: core.runJob(job, (p) => post({ id: job.id, progress: p })) }; }
    catch (e) { res = { id: job && job.id, ok: false, error: String((e && e.message) || e) }; }
    post(res);
  }
  if (typeof importScripts === 'function') {
    importScripts('regex-core.js');
    core = self.MVLRegex;
    post = (m) => self.postMessage(m);
    self.onmessage = (e) => handle(e.data);
  } else {
    const { parentPort } = require('worker_threads');
    core = require('./regex-core.js');
    post = (m) => parentPort.postMessage(m);
    parentPort.on('message', handle);
  }
})();
