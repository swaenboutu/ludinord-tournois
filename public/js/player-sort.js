// Réordonnancement des joueurs d'une table par glisser-déposer (option en plus
// de la saisie directe des places). Pointer Events (tactile + souris), sans
// dépendance. Les poignées sont invisibles aux lecteurs d'écran (aria-hidden) ;
// la saisie directe reste l'alternative accessible. Un bouton permet de désactiver
// complètement le glisser-déposer (préférence mémorisée en local).
(function () {
  var DRAG_KEY = 'ludinord:player:dragEnabled';

  // Activé par défaut, sauf préférence explicite "off".
  function dragEnabled() {
    return localStorage.getItem(DRAG_KEY) !== 'off';
  }

  function renumber(list) {
    var rows = list.querySelectorAll('.place-row');
    for (var i = 0; i < rows.length; i += 1) {
      var input = rows[i].querySelector('input[type="number"]');
      if (input) {
        input.value = i + 1;
      }
    }
  }

  function rowAfter(list, y) {
    var rows = Array.prototype.slice.call(list.querySelectorAll('.place-row:not(.dragging)'));
    for (var i = 0; i < rows.length; i += 1) {
      var box = rows[i].getBoundingClientRect();
      if (y < box.top + box.height / 2) {
        return rows[i];
      }
    }
    return null;
  }

  function makeSortable(list) {
    var dragging = null;

    function onMove(event) {
      if (!dragging) return;
      event.preventDefault();
      var after = rowAfter(list, event.clientY);
      if (after === null) {
        list.appendChild(dragging);
      } else if (after !== dragging) {
        list.insertBefore(dragging, after);
      }
    }

    function onUp() {
      if (!dragging) return;
      dragging.classList.remove('dragging');
      dragging = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      renumber(list);
    }

    var handles = list.querySelectorAll('.drag-handle');
    for (var i = 0; i < handles.length; i += 1) {
      handles[i].addEventListener('pointerdown', function (event) {
        var row = event.target.closest('.place-row');
        if (!row) return;
        event.preventDefault();
        dragging = row;
        row.classList.add('dragging');
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
      });
    }
  }

  // Bouton activer/désactiver : bascule la préférence puis recharge.
  function setupToggle(enabled) {
    var btn = document.getElementById('toggleDrag');
    if (!btn) return;
    btn.textContent = enabled ? 'Désactiver le glisser-déposer' : 'Activer le glisser-déposer';
    btn.addEventListener('click', function () {
      localStorage.setItem(DRAG_KEY, enabled ? 'off' : 'on');
      window.location.reload();
    });
  }

  function init() {
    var enabled = dragEnabled();
    setupToggle(enabled);

    if (!enabled) {
      // Poignées masquées ; l'indice ne mentionne plus le glisser
      document.body.classList.add('drag-off');
      var hints = document.querySelectorAll('.place-hint');
      for (var h = 0; h < hints.length; h += 1) {
        hints[h].textContent = 'Saisis la place de chaque joueur.';
      }
      return;
    }

    var lists = document.querySelectorAll('.place-rows');
    for (var i = 0; i < lists.length; i += 1) {
      makeSortable(lists[i]);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
