// Écran télé : défilement automatique de la zone marquée [data-autoscroll]
// (ex. le classement). Descend doucement jusqu'en bas, marque une pause, puis
// recharge la page (retour en haut d'un coup + données rafraîchies). Si la zone
// tient sans défilement, recharge simplement à intervalle régulier.
(function () {
  var REFRESH_MS = 15000; // rechargement si rien à faire défiler
  var STEP_PX = 1;
  var STEP_DELAY_MS = 25; // ~40 px/s, confortable à lire
  var END_PAUSE_MS = 2500; // pause en bas avant de recharger

  var el = document.querySelector('[data-autoscroll]');

  // Empêche le navigateur de restaurer la position de défilement au rechargement
  if ('scrollRestoration' in window.history) {
    window.history.scrollRestoration = 'manual';
  }

  function isScrollable() {
    return !!el && el.scrollHeight > el.clientHeight + 4;
  }

  function atBottom() {
    return el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
  }

  function reload() {
    window.location.reload();
  }

  function scrollDown() {
    if (atBottom()) {
      window.setTimeout(reload, END_PAUSE_MS);
      return;
    }
    el.scrollTop += STEP_PX;
    window.setTimeout(scrollDown, STEP_DELAY_MS);
  }

  function start() {
    // Repart toujours du haut (le navigateur peut avoir restauré la position)
    if (el) {
      el.scrollTop = 0;
    }
    if (!isScrollable()) {
      window.setTimeout(reload, REFRESH_MS);
      return;
    }
    window.setTimeout(scrollDown, END_PAUSE_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
