import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../../src/config/env';
import { sparql } from '../../src/sparql/client';
import { consistencyService } from '../../src/services/consistency.service';

const ONTOLOGY_FILE = path.resolve(__dirname, '../../ontology/MedicCare_final_fuseki_en.ttl');

/** Refuses to run against anything but the isolated test dataset. */
export function assertTestDataset(): void {
  if (!/_test$/.test(env.FUSEKI_DATASET))
    throw new Error(
      `Integration tests must not touch dataset "${env.FUSEKI_DATASET}". Set FUSEKI_DATASET=medicare_test (see tests/setup/env.ts).`,
    );
}

/**
 * Clears the test dataset and loads the real ontology into it, then materializes
 * the subclass closure the way the application writer does. Called once by the
 * vitest global setup; specs that need a pristine store call it again.
 */
export async function loadFixture(): Promise<{ triples: number }> {
  assertTestDataset();
  const store = await sparql.ping();
  if (!store.ok)
    throw new Error(
      `Fuseki is not reachable at ${env.FUSEKI_BASE_URL} (dataset "${env.FUSEKI_DATASET}"): ${store.error}. Start it with "docker compose up -d".`,
    );
  const turtle = await readFile(ONTOLOGY_FILE, 'utf-8');
  await sparql.update('CLEAR DEFAULT');
  await sparql.uploadTurtle(turtle);
  await consistencyService.repair();
  return { triples: await sparql.countTriples() };
}

/** Reverts the store to the shipped ontology after destructive specs. */
export const resetFixture = loadFixture;

export { sparql };
