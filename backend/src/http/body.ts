import { z } from 'zod';
import type { EntityDef, EntityKey } from '../ontology/registry';
import { ENTITY_DEFS, ENTITY_KEYS } from '../ontology/registry';
import { AppError, badRequest } from '../core/errors';
import { isSafeId } from '../sparql/escape';
import type { NormalizedInput } from '../ontology/writer';

const RESERVED = ['types', 'relations', 'label', 'altLabels', 'reassignTo'];

const bodyShape: z.ZodType<Record<string, unknown>> = z
  .record(z.string(), z.unknown())
  .refine((b) => b.types === undefined || Array.isArray(b.types) || b.types === null, {
    message: 'types must be an array of class names',
  })
  .refine((b) => b.relations === undefined || (typeof b.relations === 'object' && b.relations !== null), {
    message: 'relations must be an object of id lists',
  });

/**
 * Flat JSON body: data fields at the top level, plus the reserved keys
 * `types`, `relations`, `label`, `altLabels`. Unknown keys are rejected so a
 * typo can never be silently dropped.
 */
export function parseEntityBody(def: EntityDef, body: unknown): NormalizedInput {
  const parsed = bodySchemaSafe(body);
  const unknown = Object.keys(parsed).filter(
    (k) => !RESERVED.includes(k) && !def.data.some((d) => d.field === k),
  );
  if (unknown.length > 0)
    throw badRequest(`Unknown field(s) for ${def.label}: ${unknown.join(', ')}`, {
      allowed: [...def.data.map((d) => d.field), ...RESERVED],
      violations: unknown.map((k) => `"${k}" is not a property of ${def.label}`),
    });

  const fields: Record<string, string | number | null> = {};
  const violations: string[] = [];
  for (const data of def.data) {
    if (!(data.field in parsed)) continue;
    const raw = parsed[data.field];
    if (raw === null) {
      fields[data.field] = null;
      continue;
    }
    if (data.datatype === 'integer') {
      const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
      if (!Number.isFinite(n) || !Number.isInteger(n)) {
        violations.push(`${data.field} must be an integer (received ${JSON.stringify(raw)})`);
        continue;
      }
      fields[data.field] = n;
      continue;
    }
    if (typeof raw !== 'string' && typeof raw !== 'number') {
      violations.push(`${data.field} must be a string`);
      continue;
    }
    const value = String(raw).trim();
    if (data.maxLength && value.length > data.maxLength)
      violations.push(`${data.field} must be at most ${data.maxLength} characters`);
    fields[data.field] = value;
  }

  const types = readTypes(parsed.types, def, violations);
  const relations = readRelations(parsed.relations, def, violations);
  const label = readText(parsed.label, 'label');
  const altLabels = readAltLabels(parsed.altLabels, violations);

  if (violations.length > 0)
    throw new AppError(400, 'VALIDATION_ERROR', `Invalid ${def.label} payload`, { violations });

  return { fields, types, relations, label, altLabels };
}

const bodySchemaSafe = (body: unknown): Record<string, unknown> => {
  const result = bodyShape.safeParse(body);
  if (!result.success) {
    throw badRequest('Request body must be a JSON object', {
      violations: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    });
  }
  return result.data as Record<string, unknown>;
};

const readText = (raw: unknown, name: string): string | null | undefined => {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== 'string') throw badRequest(`${name} must be a string`);
  return raw.trim() === '' ? null : raw.trim();
};

const readTypes = (
  raw: unknown,
  def: EntityDef,
  violations: string[],
): string[] | null | undefined => {
  if (raw === undefined) return undefined;
  if (raw === null) return [];
  if (!Array.isArray(raw)) {
    violations.push('types must be an array');
    return undefined;
  }
  return raw.map((t) => String(t).trim()).filter(Boolean);
};

const readAltLabels = (raw: unknown, violations: string[]): string[] | null | undefined => {
  if (raw === undefined) return undefined;
  if (raw === null) return [];
  if (!Array.isArray(raw)) {
    violations.push('altLabels must be an array of strings');
    return undefined;
  }
  return raw.map((v) => String(v).trim()).filter(Boolean);
};

const readRelations = (
  raw: unknown,
  def: EntityDef,
  violations: string[],
): Record<string, string[]> | undefined => {
  if (raw === undefined) return undefined;
  if (raw === null) return {};
  const out: Record<string, string[]> = {};
  for (const [field, value] of Object.entries(raw as Record<string, unknown>)) {
    const rel = def.relations.find((r) => r.field === field);
    if (!rel) {
      violations.push(`"${field}" is not a relation of ${def.label}`);
      continue;
    }
    if (rel.readOnly || rel.virtual) {
      violations.push(`"${field}" is computed by the ontology and cannot be written on a ${def.label}`);
      continue;
    }
    const list = value === null ? [] : Array.isArray(value) ? value : [value];
    const ids: string[] = [];
    for (const item of list) {
      const id = typeof item === 'string' ? item : (item as { id?: string })?.id;
      if (!id || !isSafeId(id)) {
        violations.push(`Invalid identifier "${String(id)}" in relation ${field}`);
        continue;
      }
      ids.push(id);
    }
    out[field] = [...new Set(ids)];
  }
  return out;
};

export const reassignToOf = (body: unknown): string | undefined => {
  const raw = (body as { reassignTo?: unknown })?.reassignTo;
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (!isSafeId(String(raw))) throw badRequest(`Invalid reassignTo identifier: ${String(raw)}`);
  return String(raw);
};

/** Shared `ids=` style list parsing used by the search and bulk endpoints. */
export const idList = (raw: unknown): string[] => {
  if (typeof raw !== 'string') return [];
  return [...new Set(raw.split(',').map((v) => v.trim()).filter((v) => isSafeId(v)))];
};

export const entityKeyOf = (value: string): EntityKey => {
  const key = value as EntityKey;
  if (!ENTITY_KEYS.includes(key) || !(key in ENTITY_DEFS))
    throw badRequest(`Unknown entity "${value}". Allowed: ${ENTITY_KEYS.join(', ')}`);
  return key;
};
