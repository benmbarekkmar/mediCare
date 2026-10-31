#!/usr/bin/env node
// Merges public/i18n/fragments/<lang>/*.json into public/i18n/<lang>.json.
// Each feature owns one fragment file, so parallel work never edits the same
// catalogue. Run with `npm run i18n` (wired into start/build/test).
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

const root = join(process.cwd(), 'public', 'i18n');
const fragmentsDir = join(root, 'fragments');
const LANGS = ['en', 'fr'];

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const merge = (target, source) => {
  for (const [key, value] of Object.entries(source)) {
    target[key] = isObject(value) && isObject(target[key]) ? merge(target[key], value) : value;
  }
  return target;
};

if (!existsSync(fragmentsDir)) {
  console.error(`Missing ${fragmentsDir}`);
  process.exit(1);
}

for (const lang of LANGS) {
  const dir = join(fragmentsDir, lang);
  if (!existsSync(dir)) {
    console.error(`Missing i18n fragment directory ${dir}`);
    process.exit(1);
  }
  const files = readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
  const catalogue = files.reduce((acc, name) => merge(acc, JSON.parse(readFileSync(join(dir, name), 'utf8'))), {});

  // a key must exist in both languages, otherwise the UI silently switches
  // language mid-sentence when a fragment was only translated in one file
  const leaves = (node, path = []) =>
    Object.entries(node).flatMap(([key, value]) =>
      isObject(value) ? leaves(value, [...path, key]) : [[...path, key].join('.')],
    );
  const other = join(fragmentsDir, lang === 'en' ? 'fr' : 'en');
  const otherKeys = new Set(
    readdirSync(other)
      .filter((name) => name.endsWith('.json'))
      .flatMap((name) => leaves(JSON.parse(readFileSync(join(other, name), 'utf8')))),
  );
  const missing = leaves(catalogue).filter((key) => !otherKeys.has(key));
  const extra = [...otherKeys].filter((key) => !leaves(catalogue).includes(key));
  if (missing.length || extra.length) {
    console.error(`[${lang}] keys missing in ${basename(other)}: ${missing.slice(0, 12).join(', ') || '-'}`);
    console.error(`[${lang}] keys missing in ${lang}: ${extra.slice(0, 12).join(', ') || '-'}`);
    process.exit(1);
  }

  writeFileSync(join(root, `${lang}.json`), `${JSON.stringify(catalogue, null, 2)}\n`, 'utf8');
  console.log(`public/i18n/${lang}.json <- ${files.length} fragments, ${leaves(catalogue).length} keys`);
}
