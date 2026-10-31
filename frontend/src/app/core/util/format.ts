/** Small formatting helpers shared by tables, cards and the print views. */

export const formatDate = (value: string | null | undefined, lang = 'en'): string => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(lang === 'fr' ? 'fr-FR' : 'en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(date);
};

export const formatDateTime = (value: string | null | undefined, lang = 'en'): string => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(lang === 'fr' ? 'fr-FR' : 'en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

/** "in 3 days" / "2 hours ago", used by the notification panel. */
export const relativeTime = (value: string | null | undefined, lang = 'en'): string => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const rtf = new Intl.RelativeTimeFormat(lang === 'fr' ? 'fr' : 'en', { numeric: 'auto' });
  const diff = date.getTime() - Date.now();
  const units: [number, Intl.RelativeTimeFormatUnit][] = [
    [60_000, 'minute'],
    [3_600_000, 'hour'],
    [86_400_000, 'day'],
    [604_800_000, 'week'],
    [2_592_000_000, 'month'],
    [31_536_000_000, 'year'],
  ];
  const abs = Math.abs(diff);
  if (abs < 60_000) return rtf.format(Math.round(diff / 1000), 'second');
  let chosen: Intl.RelativeTimeFormatUnit = 'year';
  let size = 31_536_000_000;
  for (const [step, unit] of units) {
    if (abs < step * 10) {
      chosen = unit;
      size = step;
      break;
    }
  }
  return rtf.format(Math.round(diff / size), chosen);
};

export const initials = (name: string | null | undefined): string =>
  (name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

/** Status strings map onto the shared semantic colors defined in the tokens. */
export const statusClass = (status: string | null | undefined): string => {
  const key = (status ?? '').toLowerCase();
  if (['confirmed', 'completed', 'active'].includes(key)) return 'status-confirmed';
  if (key === 'pending') return 'status-pending';
  if (key === 'scheduled') return 'status-scheduled';
  if (['cancelled', 'canceled', 'critical', 'urgent'].includes(key)) return 'status-cancelled';
  return 'status-info';
};

export const percent = (value: number, digits = 0): string => `${value.toFixed(digits)} %`;

export const compact = (value: number): string =>
  new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);

/** `2026-11-03T09:00:00` -> `2026-11-03T09:00` for `<input type="datetime-local">`. */
export const toDateTimeInput = (value: string | null | undefined): string => {
  if (!value) return '';
  const trimmed = value.trim();
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(trimmed);
  if (match) return `${match[1]}T${match[2]}`;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
};

export const toDateInput = (value: string | null | undefined): string => toDateTimeInput(value).slice(0, 10);
