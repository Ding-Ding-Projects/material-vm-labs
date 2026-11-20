'use strict';
(function () {
  MVL.initTheme();
  document.getElementById('settingsBtn').addEventListener('click', () => MVL.settingsDialog());
  MvlDocsReader.mount(document.getElementById('reader'), window.mvlDocs, { rail: document.getElementById('rail') });
})();
