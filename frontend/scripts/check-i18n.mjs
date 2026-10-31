#!/usr/bin/env node
// Finds translation keys the application asks for but no catalogue provides.
// `npm run check-i18n` is the audit that keeps a page from rendering a raw key.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const srcDir = join(root, 'src');
const catalogues = ['en', 'fr'].map((lang) =>
  JSON.parse(readFileSync(join(root, 'public', 'i18n', `${lang}.json`), 'utf8')),
);

const leaves = (node, path = []) =>
  Object.entries(node).flatMap(([key, value]) =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? leaves(value, [...path, key])
      : [[...path, key].join('.')],
  );
const keySets = catalogues.map((catalogue) => new Set(leaves(catalogue)));

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (name === 'node_modules' || name.startsWith('.')) return [];
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

// every place a key can be written down: the pipe, instant(), and the route/nav data
const PATTERNS = [
  /'([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+)'\s*\|\s*translate/g,
  /"([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+)"\s*\|\s*translate/g,
  /instant\(\s*'([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+)'/g,
  /(?:labelKey|crumbKey|titleKey|ledeKey|title|placeholderKey)\s*:\s*'([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+)'/g,
  /return\s*'([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+)'/g,
];

const wanted = new Map();
for (const file of walk(srcDir)) {
  if (!/\.(ts|html)$/.test(file)) continue;
  const text = readFileSync(file, 'utf8');
  for (const pattern of PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const key = match[1];
      if (!wanted.has(key)) wanted.set(key, new Set());
      wanted.get(key).add(relative(root, file));
    }
  }
}

const problems = [];
for (const [key, files] of [...wanted].sort()) {
  const absent = keySets.filter((set) => !set.has(key)).length;
  if (absent === 0) continue;
  problems.push({ key, absent, files: [...files] });
}

if (problems.length === 0) {
  console.log(`check-i18n: ${wanted.size} keys used, all present in en and fr.`);
  process.exit(0);
}

for (const problem of problems) {
  const where = problem.absent === 2 ? 'en+fr' : problem.absent === 1 ? 'one language' : '?!';
  console.log(`[${where}] ${problem.key} <- ${problem.files.join(', ')}`);
}
console.log(`\ncheck-i18n: ${problems.length} of ${wanted.size} used keys are missing.`);
process.exit(1);
