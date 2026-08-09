// Réordonnancement des joueurs d'une table par glisser-déposer (option en plus
// de la saisie directe des places). Fonctionne au toucher ET à la souris via les
// Pointer Events, sans dépendance. Après un déplacement, les champs "place" sont
// renumérotés d'après l'ordre (1 en haut).
(function () {
  function renumber(list) {
    var rows = list.querySelectorAll('.place-row');
    for (var i = 0; i < rows.length; i += 1) {
      var input = rows[i].querySelector('input[type="number"]');
      if (input) {
        input.value = i + 1;
      }
    }
  }

  // Première ligne (hors celle déplacée) dont le milieu est sous le pointeur.
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

  function init() {
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
