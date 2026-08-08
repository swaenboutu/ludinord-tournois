// Saisie des places : soumet chaque table en AJAX (sans recharger la page),
// pour ne pas perdre ce qui a été saisi dans les autres tables.
// Repli : si JS indisponible, le formulaire POST normal fonctionne toujours.
(function () {
  function flash(form, message, isError) {
    var el = form.querySelector('.card-flash');
    if (!el) {
      el = document.createElement('p');
      el.className = 'card-flash';
      form.appendChild(el);
    }
    el.textContent = message;
    el.classList.toggle('is-error', !!isError);
  }

  function markValidated(form) {
    var title = form.querySelector('h3');
    if (title && !title.querySelector('.badge')) {
      var badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'validée';
      title.appendChild(document.createTextNode(' '));
      title.appendChild(badge);
    }
  }

  function updateCard(form, results) {
    results.forEach(function (r) {
      var input = form.querySelector('input[name="rank_' + r.resultId + '"]');
      if (!input) return;
      input.value = r.finishRank;
      var controls = input.closest('.participant-controls');
      var pts = controls && controls.querySelector('.points');
      if (pts) pts.textContent = r.points + ' pts';
    });
    markValidated(form);
    flash(form, 'Places enregistrées ✓', false);
  }

  function onSubmit(event) {
    event.preventDefault();
    var form = event.currentTarget;
    var body = new URLSearchParams(new FormData(form)).toString();

    fetch(form.action, {
      method: 'POST',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body,
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (result) {
        if (result.ok && result.data && result.data.ok) {
          updateCard(form, result.data.results);
        } else {
          flash(form, (result.data && result.data.error) || 'Erreur à l’enregistrement.', true);
        }
      })
      .catch(function () {
        flash(form, 'Erreur réseau.', true);
      });
  }

  function init() {
    var forms = document.querySelectorAll('form.party-card');
    for (var i = 0; i < forms.length; i += 1) {
      forms[i].addEventListener('submit', onSubmit);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
