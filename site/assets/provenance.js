// Shows the home page's "updated" time in the reader's own time zone, 24-hour with seconds and a
// labelled offset. The UTC text written by the site build stays if this script does not run.
(function () {
  var pad = function (n) { return String(n).padStart(2, '0'); };
  var els = document.querySelectorAll('time[data-local-time]');
  for (var i = 0; i < els.length; i++) {
    var d = new Date(els[i].getAttribute('datetime'));
    if (isNaN(d.getTime())) continue;
    var off = -d.getTimezoneOffset();
    var zone = 'UTC' + (off >= 0 ? '+' : '-') + pad(Math.floor(Math.abs(off) / 60)) + ':' + pad(Math.abs(off) % 60);
    var name = '';
    try { name = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { name = ''; }
    els[i].textContent = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + ' ' + zone + (name ? ' (' + name + ')' : '');
    els[i].title = 'Commit time ' + els[i].getAttribute('datetime');
  }
})();
