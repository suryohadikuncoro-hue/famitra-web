/* Fitur PWA bersifat progresif; kegagalan worker tidak menghalangi aplikasi web. */
(function () {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js', { scope: '/' })
        .catch(function (error) {
          console.warn('Service worker SI-FaMitra tidak dapat didaftarkan.', error);
        });
    });
  }

  var tombolPasang = document.getElementById('installAppBtn');
  if (!tombolPasang) return;

  var promptPasang = null;
  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();
    promptPasang = event;
    tombolPasang.hidden = false;
  });

  tombolPasang.addEventListener('click', function () {
    if (!promptPasang) return;
    var eventPasang = promptPasang;
    promptPasang = null;
    tombolPasang.disabled = true;
    eventPasang.prompt();
    Promise.resolve(eventPasang.userChoice).catch(function () { return null; }).finally(function () {
      tombolPasang.hidden = true;
      tombolPasang.disabled = false;
    });
  });

  window.addEventListener('appinstalled', function () {
    promptPasang = null;
    tombolPasang.hidden = true;
  });
})();
