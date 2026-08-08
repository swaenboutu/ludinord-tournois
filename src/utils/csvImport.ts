import { Response } from 'express';

// Résultat d'une analyse CSV : entrées valides + erreurs par ligne.
export interface CsvParseResult<T> {
  inputs: T[];
  errors: string[];
}

// Configuration d'un import CSV, propre à chaque entité (équipes, jeux…).
export interface CsvImportConfig<T> {
  view: string; // vue EJS à rendre (ex. 'teams/import')
  title: string; // titre de la page
  emptyMessage: string; // message si le CSV ne contient aucune entrée
  parse: (text: string) => CsvParseResult<T>;
  create: (inputs: T[]) => Promise<number>;
}

// Rend la page d'import avec ses variables (état vierge, erreurs, ou succès).
function render(
  res: Response,
  config: { view: string; title: string },
  data: { csv: string; errors: string[]; imported: number | null },
  status = 200,
): void {
  res.status(status).render(config.view, { title: config.title, ...data });
}

// Affiche la page d'import vierge.
export function renderImportForm<T>(res: Response, config: CsvImportConfig<T>): void {
  render(res, config, { csv: '', errors: [], imported: null });
}

// Traite une soumission CSV : analyse, "tout ou rien", puis création ou réaffichage
// avec les erreurs. Mutualise la logique commune à tous les imports.
export async function handleCsvImport<T>(
  res: Response,
  csv: string,
  config: CsvImportConfig<T>,
): Promise<void> {
  const { inputs, errors } = config.parse(csv);

  if (errors.length === 0 && inputs.length === 0) {
    errors.push(config.emptyMessage);
  }
  if (errors.length > 0) {
    render(res, config, { csv, errors, imported: null }, 400);
    return;
  }

  const imported = await config.create(inputs);
  render(res, config, { csv: '', errors: [], imported });
}
