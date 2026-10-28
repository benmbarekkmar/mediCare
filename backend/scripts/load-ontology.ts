/**
 * Loads the MedicCare OWL ontology into Fuseki.
 *
 *   npm run load-ontology                     clear + load the default file
 *   npm run load-ontology -- --file path.ttl  load another serialisation
 *   npm run load-ontology -- --append         keep what is already stored
 *
 * The dataset must exist first: either "docker compose up -d" at the project
 * root, or the documented manual server "fuseki-server --update --mem /medicare".
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { env, fusekiUrl } from '../src/config/env';
import { logger } from '../src/config/logger';
import { sparql } from '../src/sparql/client';
import { consistencyService } from '../src/services/consistency.service';
import { ontologyService } from '../src/services/ontology.service';

const DEFAULT_FILE = path.resolve(__dirname, '../ontology/MedicCare_final_fuseki_en.ttl');

interface Options {
  file: string;
  append: boolean;
  skipAudit: boolean;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { file: DEFAULT_FILE, append: false, skipAudit: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--file') opts.file = path.resolve(argv[++i] ?? DEFAULT_FILE);
    else if (arg === '--append') opts.append = true;
    else if (arg === '--skip-audit') opts.skipAudit = true;
    else if (arg === '--help' || arg === '-h') {
      console.warn('usage: npm run load-ontology -- [--file <file.ttl>] [--append] [--skip-audit]');
      process.exit(0);
    } else throw new Error(`Unknown option "${arg}"`);
  }
  return opts;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const turtle = await readFile(opts.file, 'utf-8');
  const store = await sparql.ping();
  if (!store.ok)
    throw new Error(
      `Fuseki is not reachable at ${env.FUSEKI_BASE_URL} (${store.error}).\nStart it with "docker compose up -d" or "fuseki-server --update --mem /${env.FUSEKI_DATASET}".`,
    );

  if (!opts.append) {
    process.stdout.write(`Clearing graph ${fusekiUrl('/data')} …\n`);
    await sparql.update('CLEAR DEFAULT');
  }

  process.stdout.write(`Loading ${path.basename(opts.file)} (${turtle.length.toLocaleString()} characters) …\n`);
  await sparql.uploadTurtle(turtle, { append: opts.append });

  const stats = await ontologyService.stats();
  process.stdout.write(
    `Store now holds ${stats.triples.toLocaleString()} triples: ${stats.classes} classes, ${stats.objectProperties} object properties, ` +
      `${stats.datatypeProperties} datatype properties, ${stats.namedIndividuals} named individuals ` +
      `(${stats.aboxTriples} ABox / ${stats.tboxTriples} TBox).\n`,
  );

  if (!opts.skipAudit) {
    const report = await consistencyService.audit();
    process.stdout.write(
      `Materialization audit: ${report.checks.length} checks, ${report.violations} violation(s)` +
        `${report.ok ? ' - the store already asserts every inference' : ''}\n`,
    );
    for (const check of report.checks.filter((c) => c.count > 0))
      process.stdout.write(`  - ${check.id}: ${check.count} issue(s) [${check.title}]\n`);
    if (report.violations > 0 && report.fixable > 0) {
      process.stdout.write('Repairing …\n');
      const repair = await consistencyService.repair();
      process.stdout.write(`Applied ${repair.applied} repair(s) over ${repair.operations} operations; ${repair.report.violations} violation(s) left.\n`);
    }
  }
  logger.info({ file: opts.file, triples: stats.triples }, 'ontology loaded');
}

main()
  .then(() => process.exit(0))
  .catch((err: Error) => {
    console.error(err.message);
    process.exit(1);
  });
