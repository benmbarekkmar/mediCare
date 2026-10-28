import { writeFileSync } from 'node:fs';
import { tokens } from '../src/auth/tokens';
import { users } from '../src/auth/user.repo';

const admin = users.list().find((u) => u.role === 'ADMIN');
if (!admin) throw new Error('no admin');
const jwt = tokens.pair(admin).accessToken;

const grab = async (path: string): Promise<unknown> => {
  const res = await fetch(`http://localhost:4000/api${path}`, { headers: { authorization: `Bearer ${jwt}` } });
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 200);
  }
  return { status: res.status, shape: shape(body) };
};

const shape = (value: unknown, depth = 0): unknown => {
  if (value === null) return null;
  if (Array.isArray(value)) return value.length ? [shape(value[0], depth + 1)] : [];
  if (typeof value === 'object') {
    if (depth > 3) return '…';
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v, depth + 1)]));
  }
  return typeof value;
};

const post = async (path: string, body: unknown): Promise<unknown> => {
  const res = await fetch(`http://localhost:4000/api${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, shape: shape(await res.json()) };
};

async function main() {
const out: Record<string, unknown> = {};
for (const path of [
  '/permissions/matrix',
  '/ontology/stats',
  '/ontology/classes',
  '/ontology/individuals?class=Patient&limit=2',
  '/ontology/properties',
  '/ontology/graph?limit=5',
  '/ontology/individuals/Patient_Ahmed',
  '/meta/specialties',
  '/meta/hierarchy',
  '/auth/sessions',
  '/audit?limit=1',
  '/nlp/intents',
]) out[path] = await grab(path);

out['/console/query'] = await post('/console/query', {
  query: 'SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 2',
});
out['/api/openapi'] = 'skipped';

writeFileSync('data/contract-check.json', JSON.stringify(out, null, 2));
console.log('written');
}
main();
