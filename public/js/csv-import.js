// Glisser-déposer + lecture d'un fichier CSV vers la zone de texte du formulaire.
// Partagé par les pages d'import (équipes, jeux). S'appuie sur les ids :
// #dropZone, #csvFile, #csvText, #fileName.
(function () {
  function init() {
    var dropZone = document.getElementById('dropZone');
    var fileInput = document.getElementById('csvFile');
    var textArea = document.getElementById('csvText');
    var fileName = document.getElementById('fileName');
    if (!dropZone || !fileInput || !textArea) {
      return;
    }

    function readFile(file) {
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        textArea.value = reader.result;
      };
      reader.readAsText(file, 'UTF-8');
      if (fileName) {
        fileName.textContent = file.name;
      }
    }

    fileInput.addEventListener('change', function (event) {
      readFile(event.target.files[0]);
    });

    ['dragenter', 'dragover'].forEach(function (name) {
      dropZone.addEventListener(name, function (event) {
        event.preventDefault();
        dropZone.classList.add('dragover');
      });
    });
    ['dragleave', 'drop'].forEach(function (name) {
      dropZone.addEventListener(name, function (event) {
        event.preventDefault();
        dropZone.classList.remove('dragover');
      });
    });
    dropZone.addEventListener('drop', function (event) {
      var files = event.dataTransfer && event.dataTransfer.files;
      if (files && files.length > 0) {
        readFile(files[0]);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
