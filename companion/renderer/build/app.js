'use strict';
(function () {
  MVL.initTheme();
  document.getElementById('theme').addEventListener('click', () => MVL.toggleTheme());
  MvlBuildPanel.mount(document.getElementById('bayRoot'), window.mvlBuild, { pillar: document.getElementById('pillar') });
})();
