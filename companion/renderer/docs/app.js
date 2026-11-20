'use strict';
(function () {
  MVL.initTheme();
  document.getElementById('theme').addEventListener('click', () => MVL.toggleTheme());
  MvlDocsReader.mount(document.getElementById('reader'), window.mvlDocs, { pillar: document.getElementById('pillar') });
})();
