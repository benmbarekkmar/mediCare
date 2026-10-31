import type { TranslateService } from '@ngx-translate/core';

/** `hasPhoneNumber` / `dateOfBirth` -> `Phone number` / `Date of birth`. */
export const humanize = (key: string): string =>
  key
    .replace(/^(has|is|are|can|must)/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .replace(/^./, (first) => first.toUpperCase());

/**
 * Resolves either a catalogue key or already translated display text. Shared
 * controls use this because callers in the app pass both forms; piping an
 * already translated label through ngx-translate a second time otherwise
 * turns it into the missing-translation message.
 */
export function translateOrText(translate: TranslateService, value: string | null | undefined): string {
  if (!value) return '';
  const translated = translate.instant(value);
  if (typeof translated !== 'string') return value;
  // ngx-translate returns the original key when no missing-key handler is
  // configured (as in tests and a few pre-bootstrap views); preserve that
  // caller-provided value in this case.
  if (translated === value) return value;
  if (!isMissingTranslation(translated, value)) return translated;
  if (value === 'Label unavailable' || value === 'Libell\u00e9 indisponible') return value;
  return isTranslationKey(value) ? humanize(value.split('.').at(-1) ?? value) : value;
}

/**
 * Translation is an enhancement, never a hard requirement: a field the
 * catalogue has not reached yet still shows a readable English name taken from
 * the ontology term itself, so adding a property cannot break the UI.
 */
export function labelOf(translate: TranslateService, key: string, fallback: string): string {
  const value = translate.instant(key);
  return value && !isMissingTranslation(value, key) ? value : humanize(fallback);
}

function isMissingTranslation(value: string, key: string): boolean {
  return value === key || value === 'Label unavailable' || value === 'Libell\u00e9 indisponible';
}

function isTranslationKey(value: string): boolean {
  return /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$/.test(value);
}
