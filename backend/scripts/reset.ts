/**
 * Puts the environment back to a known state:
 *
 *   npm run reset-db -- --store          empty the Fuseki dataset
 *   npm run reset-db -- --accounts       drop the demo accounts only
 *   npm run reset-db -- --full           store + demo accounts
 *   npm run reset-db -- --full --yes     skip the interactive confirmation
 *
 * Only the accounts created by "npm run seed" are ever removed; anything else
 * in SQLite is left alone, and the audit trail is kept unless --audit is given.
 */
import { createInterface } from 'node:readline/promises';
import { env } from '../src/config/env';
import { closeDb, db } from '../src/db/sqlite';
import { users } from '../src/auth/user.repo';
import { sparql } from '../src/sparql/client';
import { DEMO_EMAILS } from './demo-accounts';

interface Options {
  store: boolean;
  accounts: boolean;
  audit: boolean;
  assumeYes: boolean;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { store: false, accounts: false, audit: false, assumeYes: false };
  for (const arg of argv) {
    if (arg === '--store') opts.store = true;
    else if (arg === '--accounts') opts.accounts = true;
    else if (arg === '--audit') opts.audit = true;
    else if (arg === '--full') {
      opts.store = true;
      opts.accounts = true;
    } else if (arg === '--yes' || arg === '-y') opts.assumeYes = true;
    else if (arg === '--help' || arg === '-h') {
      console.warn('usage: npm run reset-db -- [--store] [--accounts] [--audit] [--full] [--yes]');
      process.exit(0);
    } else throw new Error(`Unknown option "${arg}"`);
  }
  if (!opts.store && !opts.accounts) {
    console.error('Nothing to do: pass --store, --accounts or --full (see --help).');
    process.exit(2);
  }
  return opts;
}

async function confirm(message: string, assumeYes: boolean): Promise<boolean> {
  if (assumeYes) return true;
  if (!process.stdin.isTTY) {
    console.error(`${message}\nRefusing to run destructively without a TTY; pass --yes to confirm.`);
    process.exit(2);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`${message} [y/N] `)).trim().toLowerCase();
  rl.close();
  return answer === 'y' || answer === 'yes';
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const before = (await sparql.ping()).triples;

  process.stdout.write(
    `Reset target: dataset "${env.FUSEKI_DATASET}" at ${env.FUSEKI_BASE_URL} (${before.toLocaleString()} triples), SQLite ${env.SQLITE_FILE}\n`,
  );
  if (
    !(await confirm(
      `This deletes ${opts.store ? `the ${before.toLocaleString()} stored triples, ` : ''}${opts.accounts ? `${DEMO_EMAILS.length} demo accounts, ` : ''}${opts.audit ? 'the audit trail' : ''}. Continue?`,
      opts.assumeYes,
    ))
  ) {
    process.stdout.write('Aborted, nothing was changed.\n');
    return;
  }

  if (opts.accounts) {
    let removed = 0;
    for (const email of DEMO_EMAILS) {
      const account = users.byEmail(email);
      if (!account) continue;
      users.remove(account.id);
      removed++;
    }
    process.stdout.write(`Removed ${removed} demo account(s); ${users.count()} account(s) left.\n`);
  }

  if (opts.audit) {
    const info = db().prepare('DELETE FROM audit_log').run();
    process.stdout.write(`Cleared ${info.changes} audit row(s).\n`);
  }

  if (opts.store) {
    await sparql.update('CLEAR DEFAULT');
    process.stdout.write(`Dataset emptied: ${(await sparql.countTriples()).toLocaleString()} triples now.\n`);
    process.stdout.write('Reload it with "npm run load-ontology".\n');
  }
}

main()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch((err: Error) => {
    console.error(err.message);
    closeDb();
    process.exit(1);
  });
