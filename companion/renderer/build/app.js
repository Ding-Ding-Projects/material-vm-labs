'use strict';
(function () {
  MVL.initTheme();
  document.getElementById('settingsBtn').addEventListener('click', () => MVL.settingsDialog());
  MvlBuildPanel.mount(document.getElementById('bayRoot'), window.mvlBuild, { rail: document.getElementById('rail') });
})();
