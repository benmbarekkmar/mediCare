import type { Individual, Ref } from '../../core/api/models';

/**
 * Pure scheduling helpers shared by the calendar and the two professional
 * dashboards. Nothing here touches the DOM, Angular or HTTP, so the appointment
 * mapping and the double-booking detection stay unit testable, and both
 * dashboards read the conflict rules from exactly one place.
 */

/** The five visual flavours the status vocabulary can take. */
export type StatusKey = 'confirmed' | 'pending' | 'cancelled' | 'scheduled' | 'neutral';

/** The three colours a status needs, expressed as design token *names*. */
export interface StatusColorTokens {
  readonly background: string;
  readonly border: string;
  readonly text: string;
}

/** The same three colours, resolved to real CSS colours by the caller. */
export interface StatusColors {
  readonly background: string;
  readonly border: string;
  readonly text: string;
}

export type StatusPalette = Record<StatusKey, StatusColors>;

/**
 * Token names only: `getComputedStyle` turns them into paint at the component
 * edge, which is what makes the calendar follow the active theme.
 */
export const STATUS_COLOR_TOKENS: Record<StatusKey, StatusColorTokens> = {
  confirmed: { background: '--success-100', border: '--success-500', text: '--success-700' },
  pending: { background: '--warning-100', border: '--warning-500', text: '--warning-700' },
  cancelled: { background: '--danger-100', border: '--danger-500', text: '--danger-700' },
  scheduled: { background: '--info-100', border: '--info-500', text: '--info-700' },
  neutral: { background: '--primary-soft', border: '--primary', text: '--primary' },
};

/** A visit reduced to the few fields the scheduling screens need. */
export interface AppointmentSlot {
  readonly id: string;
  readonly label: string;
  /** The raw `appointmentDate` as the API serves it (XSD dateTime). */
  readonly date: string;
  readonly status: string;
  /** The appointment type facet class, e.g. `Consultation`. */
  readonly type: string | null;
  readonly patient: Ref | null;
  readonly department: Ref | null;
  /**
   * The treating doctors of that patient. `MedicalAppointment` has no doctor
   * property in the ontology: the link is always `appointment -> patient ->
   * treatedBy -> doctor`, so the caller resolves it (or leaves it empty).
   */
  readonly doctorIds: readonly string[];
}

/** What the double-booking check needs from a form that is not saved yet. */
export interface ClashCandidate {
  readonly id: string | null;
  readonly date: string;
  readonly doctorIds: readonly string[];
  readonly departmentId: string | null;
}

/** Two visits competing for the same doctor in the same minute. */
export interface DoctorConflict {
  readonly slot: string;
  readonly doctorId: string;
  readonly appointments: readonly AppointmentSlot[];
}

/** A calendar event, structurally compatible with FullCalendar `EventInput`. */
export interface CalendarEvent {
  readonly id: string;
  readonly title: string;
  readonly start: string;
  readonly allDay: boolean;
  readonly backgroundColor: string;
  readonly borderColor: string;
  readonly textColor: string;
  readonly classNames: string[];
  readonly extendedProps: {
    readonly status: string;
    readonly statusKey: StatusKey;
    readonly type: string | null;
    readonly patientId: string | null;
    readonly departmentId: string | null;
  };
}

const PLAIN_MINUTE = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/;
const HAS_TIME = /[T ]\d{2}:\d{2}/;
/** A trailing `Z` or a signed offset: those instants must go through `Date`. */
const ZONED = /(?:[zZ]|[+-]\d{2}:?\d{2})$/;

const pad = (value: number): string => String(value).padStart(2, '0');

/** `Date` -> `yyyy-MM-ddTHH:mm` in the browser timezone (the shape the API writes). */
export const toLocalDateTime = (value: Date): string =>
  `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(
    value.getMinutes(),
  )}`;

/** `Date` -> `yyyy-MM-dd`, used for the `dateFrom` / `dateTo` request bounds. */
export const toDateOnly = (value: Date): string =>
  `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;

/** Local midnight of the given day, the anchor of the "today" and week windows. */
export const startOfDay = (now = new Date()): Date => new Date(now.getFullYear(), now.getMonth(), now.getDate());

export const addDays = (value: Date, days: number): Date =>
  new Date(value.getFullYear(), value.getMonth(), value.getDate() + days, 12);

/**
 * Minute-precision identity of an instant: two appointments collide when their
 * keys match. Naive strings (the ontology stores no offset) keep the wall clock
 * they carry, zoned strings are converted to local time first.
 */
export const minuteKey = (date: string | null | undefined): string => {
  const raw = (date ?? '').trim();
  if (raw.length === 0) return '';
  if (!ZONED.test(raw)) {
    const plain = PLAIN_MINUTE.exec(raw);
    if (plain !== null) return `${plain[1]}T${plain[2]}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T00:00`;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? '' : toLocalDateTime(parsed);
};

/** Calendar day of an instant, `yyyy-MM-dd`. */
export const dayKey = (date: string | null | undefined): string => minuteKey(date).slice(0, 10);

/** Epoch milliseconds, `0` when the value cannot be parsed. */
export const timeOf = (date: string | null | undefined): number => {
  const key = minuteKey(date);
  if (key.length === 0) return 0;
  const parsed = new Date(`${key}:00`);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

export const isValidInstant = (date: string | null | undefined): boolean => minuteKey(date).length > 0;

/** `true` when the instant falls on the given local day. */
export const isSameDay = (date: string | null | undefined, day: Date): boolean =>
  dayKey(date) === toDateOnly(day);

const singleRef = (value: Ref | Ref[] | null | undefined): Ref | null => {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
};

const fieldText = (item: Individual, field: string): string => {
  const raw = item.fields[field];
  return raw === null || raw === undefined ? '' : String(raw);
};

/** The type facet class of an individual (anything that is not its base class). */
const typeClass = (item: Individual, baseClass: string): string | null =>
  item.types.find((type) => type !== baseClass) ?? null;

/** An `Individual` as a picker `Ref`, for the combobox search functions. */
export const refOf = (item: Individual): Ref => ({
  id: item.id,
  iri: item.iri,
  label: item.label,
  type: item.types[0] ?? '',
});

/** One page item -> `AppointmentSlot`; doctors come from the caller's lookup. */
export const slotOf = (item: Individual, doctorIds: readonly string[] = []): AppointmentSlot => ({
  id: item.id,
  label: item.label,
  date: fieldText(item, 'date'),
  status: fieldText(item, 'status'),
  type: typeClass(item, 'MedicalAppointment'),
  patient: singleRef(item.relations['patient']),
  department: singleRef(item.relations['department']),
  doctorIds,
});

/**
 * A page of appointments -> slots. `doctorsByPatient` maps a patient id to its
 * treating doctor ids, read from the patients list (the only place the
 * appointment/doctor link is observable).
 */
export const slotsOf = (
  items: readonly Individual[],
  doctorsByPatient: ReadonlyMap<string, readonly string[]> = new Map(),
): AppointmentSlot[] =>
  items.map((item) => slotOf(item, doctorsByPatient.get(singleRef(item.relations['patient'])?.id ?? '') ?? []));

export const statusKeyOf = (status: string | null | undefined): StatusKey => {
  const key = (status ?? '').trim().toLowerCase();
  if (key === 'confirmed' || key === 'completed' || key === 'active') return 'confirmed';
  if (key === 'pending') return 'pending';
  if (key === 'cancelled' || key === 'canceled') return 'cancelled';
  if (key === 'scheduled') return 'scheduled';
  return 'neutral';
};

/** Event title: who is coming, then what the visit is. */
const eventTitle = (slot: AppointmentSlot): string => {
  const patient = slot.patient?.label;
  if (patient && patient.length > 0) return `${patient} · ${slot.status}`;
  return `${slot.label} · ${slot.status}`;
};

/** FullCalendar event for one appointment: status paints it, type classifies it. */
export const toCalendarEvent = (slot: AppointmentSlot, palette: StatusPalette): CalendarEvent => {
  const key = statusKeyOf(slot.status);
  const colors = palette[key];
  const hasTime = HAS_TIME.test(slot.date);
  return {
    id: slot.id,
    title: eventTitle(slot),
    start: hasTime ? slot.date : `${slot.date}T00:00:00`,
    allDay: !hasTime,
    backgroundColor: colors.background,
    borderColor: colors.border,
    textColor: colors.text,
    classNames: ['sched-event', `sched-event--${key}`, slot.type === null ? 'sched-event--untyped' : `sched-type-${slot.type}`],
    extendedProps: {
      status: slot.status,
      statusKey: key,
      type: slot.type,
      patientId: slot.patient?.id ?? null,
      departmentId: slot.department?.id ?? null,
    },
  };
};

export const toCalendarEvents = (slots: readonly AppointmentSlot[], palette: StatusPalette): CalendarEvent[] =>
  slots.filter((slot) => isValidInstant(slot.date)).map((slot) => toCalendarEvent(slot, palette));

const sharesDoctor = (left: readonly string[], right: readonly string[]): boolean =>
  left.some((id) => right.includes(id));

/**
 * Every pair of appointments that puts the same doctor at the same minute.
 * Appointments without a resolvable doctor are never reported: absence of
 * evidence is not a conflict.
 */
export const findDoctorConflicts = (slots: readonly AppointmentSlot[]): DoctorConflict[] => {
  const conflicts: DoctorConflict[] = [];
  const seen = new Set<string>();
  for (const slot of slots) {
    const at = minuteKey(slot.date);
    if (at.length === 0 || slot.doctorIds.length === 0) continue;
    for (const other of slots) {
      if (other.id === slot.id) continue;
      if (minuteKey(other.date) !== at) continue;
      if (!sharesDoctor(slot.doctorIds, other.doctorIds)) continue;
      for (const doctorId of slot.doctorIds) {
        if (!other.doctorIds.includes(doctorId)) continue;
        const marker = `${at}|${doctorId}`;
        if (seen.has(marker)) continue;
        seen.add(marker);
        const rivals = slots.filter(
          (candidate) => minuteKey(candidate.date) === at && candidate.doctorIds.includes(doctorId),
        );
        conflicts.push({ slot: at, doctorId, appointments: rivals });
      }
    }
  }
  return conflicts;
};

/**
 * The clashes a draft must not walk into: an existing appointment at the same
 * minute that shares either the doctor or the department. Used before creating
 * or rescheduling, never as a server-side bypass.
 */
export const findClashes = (candidate: ClashCandidate, slots: readonly AppointmentSlot[]): AppointmentSlot[] => {
  const at = minuteKey(candidate.date);
  if (at.length === 0) return [];
  return slots.filter((slot) => {
    if (slot.id === candidate.id) return false;
    if (minuteKey(slot.date) !== at) return false;
    if (statusKeyOf(slot.status) === 'cancelled') return false;
    const sameDepartment =
      candidate.departmentId !== null && slot.department !== null && slot.department.id === candidate.departmentId;
    return sameDepartment || sharesDoctor(candidate.doctorIds, slot.doctorIds);
  });
};

/** One appointment per doctor of the draft, for the clash request parameters. */
export const countsByDay = (slots: readonly AppointmentSlot[], from: Date, days: number): number[] => {
  const buckets = new Map<string, number>();
  for (const slot of slots) {
    const key = dayKey(slot.date);
    if (key.length === 0) continue;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return Array.from({ length: days }, (_unused, index) => buckets.get(toDateOnly(addDays(from, index))) ?? 0);
};

/** Appointments of the given day that already started, most recent first. */
export const arrivalsOf = (slots: readonly AppointmentSlot[], now = Date.now()): AppointmentSlot[] =>
  slots
    .filter((slot) => isSameDay(slot.date, new Date(now)))
    .filter((slot) => timeOf(slot.date) <= now)
    .sort((a, b) => timeOf(b.date) - timeOf(a.date));

/** Appointments of the given day still to come, soonest first. */
export const upcomingOf = (slots: readonly AppointmentSlot[], now = Date.now()): AppointmentSlot[] =>
  slots
    .filter((slot) => isSameDay(slot.date, new Date(now)))
    .filter((slot) => timeOf(slot.date) > now)
    .sort((a, b) => timeOf(a.date) - timeOf(b.date));

/** Group of slots keyed by their status string, preserving the incoming order. */
export const groupByStatus = (slots: readonly AppointmentSlot[]): Map<string, AppointmentSlot[]> => {
  const groups = new Map<string, AppointmentSlot[]>();
  for (const slot of slots) {
    const bucket = groups.get(slot.status);
    if (bucket) bucket.push(slot);
    else groups.set(slot.status, [slot]);
  }
  return groups;
};
