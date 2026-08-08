// Petit parseur CSV maison (pas de dépendance) : gère les guillemets doubles,
// les guillemets échappés ("") et les fins de ligne \n / \r\n.

// Devine le séparateur d'après la première ligne non vide (',' par défaut).
export function detectDelimiter(text: string): ',' | ';' {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim() !== '') ?? '';
  const commas = (firstLine.match(/,/g) ?? []).length;
  const semicolons = (firstLine.match(/;/g) ?? []).length;
  return semicolons > commas ? ';' : ',';
}

// Découpe le texte CSV en lignes de champs, selon le séparateur donné.
export function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1; // guillemet échappé
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  // Dernier champ / dernière ligne (fichier sans saut de ligne final)
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}
