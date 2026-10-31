import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { sparql } from '../src/sparql/client';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function runNpm(args: string[]): void {
  const result = spawnSync(npm, args, { cwd: process.cwd(), env: process.env, shell: process.platform === 'win32', stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('npm ' + args.join(' ') + ' failed.');
}

async function refreshNlpAfterLoad(): Promise<void> {
  const hostport = process.env.NLP_SERVICE_HOSTPORT;
  if (!hostport) return;

  const baseUrl = 'http://' + hostport;
  for (let attempt = 1; attempt <= 60; attempt++) {
    try {
      const healthResponse = await fetch(baseUrl + '/health', { signal: AbortSignal.timeout(5000) });
      if (healthResponse.ok) {
        const health = (await healthResponse.json()) as {
          store?: { ok?: boolean; triples?: number };
        };
        if (health.store?.ok && (health.store.triples ?? 0) > 0) {
          const reloadResponse = await fetch(baseUrl + '/reload', {
            method: 'POST',
            signal: AbortSignal.timeout(30000),
          });
          if (reloadResponse.ok) {
            console.log('NLP vocabulary reloaded from the initialized Fuseki dataset.');
            return;
          }
        }
      }
    } catch {
      // The private NLP service may still be starting; retry below.
    }
    console.log('Waiting for the NLP service to load the initialized dataset (' + attempt + '/60)...');
    await delay(3000);
  }

  throw new Error('The NLP service did not reload from the initialized Fuseki dataset.');
}

async function main(): Promise<void> {
  let store = await sparql.ping();
  for (let attempt = 1; !store.ok && attempt <= 60; attempt++) {
    console.log('Waiting for Fuseki (' + attempt + '/60)...');
    await delay(3000);
    store = await sparql.ping();
  }
  if (!store.ok) throw new Error('Fuseki did not become ready: ' + (store.error ?? 'unknown error'));

  if (store.triples === 0) {
    console.log('Loading the bundled MedicCare ontology into the empty dataset.');
    runNpm(['run', 'load-ontology']);
  } else {
    console.log('The Fuseki dataset already contains ' + store.triples + ' triples; leaving it unchanged.');
  }

  runNpm(['run', 'seed']);
  await refreshNlpAfterLoad();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});