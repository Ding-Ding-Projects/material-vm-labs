'use strict';
// Background worker for the type generator: parses, infers and generates off the interface thread.
/* global importScripts, MVLTypegen */
importScripts('dev-tools-typegen.js');
self.onmessage = (e) => {
  const { id, req } = e.data || {};
  try { self.postMessage({ id, res: MVLTypegen.run(req) }); }
  catch (err) { self.postMessage({ id, error: String(err && err.message || err) }); }
};
