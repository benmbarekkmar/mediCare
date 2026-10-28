/**
 * Creates the demo accounts used by the UI and the test suite:
 *
 *   npm run seed
 *
 * Accounts live in SQLite only - no clinical individual is invented here. The
 * password is whatever SEED_DEMO_PASSWORD holds in the environment, so nothing
 * secret is written into the repository, and existing accounts are never
 * overwritten: they are reported and skipped.
 */
import { env } from '../src/config/env';
import { closeDb } from '../src/db/sqlite';
import { users } from '../src/auth/user.repo';
import type { DemoAccount } from './demo-accounts';
import { DEMO } from './demo-accounts';
import { entityDef } from '../src/ontology/registry';
import { entityRepo } from '../src/repos/entity.repo';
import { sparql } from '../src/sparql/client';

async function assertLinkedIndividual(account: DemoAccount): Promise<void> {
  if (!account.linkedId || !account.linkedEntity) return;
  const def = entityDef(account.linkedEntity);
  if (!(await entityRepo.exists(account.linkedId, def)))
    throw new Error(
      `${account.email} must link to ${account.linkedId}, which is not in the store. Run "npm run load-ontology" first.`,
    );
  const profile = await entityRepo.getById(def, account.linkedId, false);
  process.stdout.write(`  linked individual verified: ${account.linkedId} (${profile?.label ?? 'no label'})\n`);
}

async function main(): Promise<void> {
  const store = await sparql.ping();
  if (!store.ok)
    throw new Error(`Fuseki is not reachable at ${env.FUSEKI_BASE_URL}. Start it with "docker compose up -d".`);

  if (store.triples === 0)
    process.stdout.write('Warning: the dataset is empty - run "npm run load-ontology" to load the ontology.\n');

  process.stdout.write('Seeding demo accounts (password comes from SEED_DEMO_PASSWORD, it is never printed) …\n');
  let created = 0;
  let skipped = 0;

  for (const account of DEMO) {
    if (users.byEmail(account.email)) {
      process.stdout.write(`  - ${account.email} already exists, left untouched\n`);
      skipped++;
      continue;
    }
    await assertLinkedIndividual(account);
    users.create({
      email: account.email,
      password: env.SEED_DEMO_PASSWORD,
      role: account.role,
      fullName: account.fullName,
      linkedId: account.linkedId ?? null,
      locale: account.locale,
    });
    process.stdout.write(`  + ${account.email} [${account.role}] - ${account.why}\n`);
    created++;
  }

  process.stdout.write(
    `\n${created} account(s) created, ${skipped} kept as they were. Total accounts: ${users.count()}.\n` +
      'Sign in with any of these addresses and the SEED_DEMO_PASSWORD value from your environment.\n',
  );
}

main()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch((err: Error) => {
    console.error(err.message);
    closeDb();
    process.exit(1);
  });
