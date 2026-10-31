/** Wire types of the MedicCare REST API, mirroring the OpenAPI document at /api/docs. */

export type Role = 'ADMIN' | 'DOCTOR' | 'RECEPTIONIST' | 'PATIENT';
export type Action = 'read' | 'create' | 'update' | 'delete';

export const ENTITY_KEYS = [
  'patients',
  'doctors',
  'diseases',
  'symptoms',
  'treatments',
  'medications',
  'tests',
  'appointments',
  'hospitals',
  'departments',
] as const;
export type EntityKey = (typeof ENTITY_KEYS)[number];

export interface PublicUser {
  id: number;
  email: string;
  fullName: string;
  role: Role;
  linkedId: string | null;
  locale: string;
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: PublicUser;
}

/** The stored session: the token pair plus the account it belongs to. */
export type Session = TokenPair;

export interface Ref {
  id: string;
  iri: string;
  label: string;
  type: string;
}

export interface Individual {
  id: string;
  iri: string;
  label: string;
  types: string[];
  fields: Record<string, string | number | null>;
  relations: Record<string, Ref[] | Ref | null>;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  sort: string | null;
  order: 'asc' | 'desc';
  q: string | null;
}

/** Flat create/update body: data fields, relation id lists and the reserved keys. */
export type EntityInput = Record<string, string | number | boolean | string[] | Record<string, string[]> | null | undefined> & {
  relations?: Record<string, string[] | null>;
  types?: string[];
  label?: string;
  altLabels?: string[];
  reassignTo?: string;
};

export interface DataFieldMeta {
  predicate: string;
  field: string;
  datatype: 'string' | 'integer' | 'date' | 'dateTime' | 'decimal' | 'boolean';
  required: boolean;
  values: string[] | null;
  unique: boolean;
  min: number | null;
  max: number | null;
  maxLength: number | null;
  sortable: boolean;
  search: boolean;
  pattern: string | null;
}

export interface RelationMeta {
  predicate: string;
  inverse: string | null;
  target: EntityKey;
  targetLabel: string;
  field: string;
  cardinality: 'one' | 'many';
  required: boolean;
  readOnly: boolean;
  functional: boolean;
  virtual: string | null;
  filterParam: string | null;
}

export interface EntityMeta {
  key: EntityKey;
  label: string;
  plural: string;
  classLocal: string;
  classLabel: string;
  idStyle: string;
  nameField: string;
  description: string;
  derivedPatient?: boolean;
  data: DataFieldMeta[];
  relations: RelationMeta[];
  typeFacet?: { field: string; classes: string[]; multiple: boolean; required: boolean; filterParam: string; label: string } | null;
}

export interface ClassNode {
  id: string;
  label: string;
  parent?: string;
  individuals: number;
  children: ClassNode[];
}

export interface SearchHit {
  id: string;
  iri: string;
  label: string;
  entity: EntityKey;
  type: string;
  snippet: string;
}

export interface SearchGroup {
  entity: EntityKey;
  label: string;
  plural: string;
  total: number;
  items: SearchHit[];
}

export interface SearchResult {
  term: string;
  groups: SearchGroup[];
  total: number;
  queries?: string[];
}

export interface NamedValue {
  label: string;
  value: number;
}

export interface UpcomingAppointment {
  id: string;
  label: string;
  date: string;
  status: string;
  patient: string;
  department: string;
}

export interface DashboardData {
  generatedAt: string;
  counts: Record<EntityKey, number>;
  totalTriples: number;
  patientsByAgeClass: NamedValue[];
  chronicShare: { chronic: number; emergency: number; total: number; chronicPct: number };
  diseasesByCategory: NamedValue[];
  appointmentsByStatus: NamedValue[];
  appointmentsByType: NamedValue[];
  doctorsBySpecialty: NamedValue[];
  testsByType: NamedValue[];
  departmentsByHospital: NamedValue[];
  topSymptoms: NamedValue[];
  patientsPerDoctor: NamedValue[];
  topDiseases: NamedValue[];
  patientsPerHospital: NamedValue[];
  appointmentsToday: number;
  appointmentsPerMonth: { month: string; count: number }[];
  upcomingAppointments: UpcomingAppointment[];
  executionMs: number;
}

export interface ConsistencyCheck {
  id: string;
  title: string;
  axiom: string;
  count: number;
  violations: { s?: string; detail?: string }[];
  query: string;
  fix: string;
}

export interface ConsistencyReport {
  checkedAt: string;
  ok: boolean;
  violations: number;
  fixable: number;
  checks: ConsistencyCheck[];
}

export interface OntologyStats {
  triples: number;
  tboxTriples: number;
  aboxTriples: number;
  classes: number;
  objectProperties: number;
  datatypeProperties: number;
  annotationProperties: number;
  namedIndividuals: number;
  axioms: Record<string, number>;
  individualsByEntity: Record<EntityKey, number>;
}

export interface GraphNode {
  id: string;
  label: string;
  group: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  label: string;
}

export interface GraphPayload {
  nodes: GraphNode[];
  edges: GraphEdge[];
  focus?: string;
}

/** `GET /api/ontology/individuals/:id` - every asserted triple in both directions. */
export interface AssertedTriple {
  predicate: string;
  value: string;
  type: 'uri' | 'literal' | string;
}

export interface IndividualDetail {
  id: string;
  iri: string;
  outgoing: AssertedTriple[];
  incoming: AssertedTriple[];
}

export interface PropertyRow {
  name: string;
  kind: 'object' | 'datatype' | 'annotation';
  domain: string[];
  range: string[];
  inverse?: string;
  characteristics: string[];
  chains: string[][];
  usedBy: string[];
}

/** One result cell as Fuseki returns it; the console renders `value`. */
export interface ResultValue {
  type: string;
  value: string;
  datatype?: string;
  'xml:lang'?: string;
}

/** `POST /api/sparql` and `POST /api/console/query`: one read statement. */
export interface ConsoleReadResult {
  type?: string;
  form: 'select' | 'ask' | 'construct';
  vars?: string[];
  rows?: Record<string, ResultValue | undefined>[];
  count?: number;
  answer?: boolean;
  ntriples?: string;
  executionMs: number;
  query: string;
}

/** `POST /api/console/update`: guarded store update. */
export interface ConsoleUpdateResult {
  type?: string;
  operations: string[];
  triples: number;
  [key: string]: unknown;
}

export interface NlpEntity {
  text: string;
  type: 'class' | 'individual' | 'property' | 'value';
  id: string;
  iri: string;
  label: string;
  matchedVia: string;
  score: number;
}

export interface NlpParse {
  question: string;
  language: string;
  intent: string;
  confidence: number;
  entities: NlpEntity[];
  slots: Record<string, unknown>;
  filters: Record<string, unknown>;
  sparql: string;
  explanation: Record<string, string>;
  suggestions: string[];
  pipeline: { step: string; tool: string; detail: string }[];
  allowedRoles: string[];
  classifierScores: Record<string, number>;
  reply?: string;
  safety?: string;
}

export interface SemanticPath {
  nodes: { id: string; label: string }[];
  predicates: string[];
}

export interface AskResult {
  parse: NlpParse;
  sparql: string;
  columns: string[];
  rows: Record<string, string>[];
  executionMs: number;
  semanticPaths?: SemanticPath[];
}

export interface NlpHealth {
  ok: boolean;
  version: string;
  language: string;
  models: { name: string; loaded: boolean }[];
  vocabSize: number;
  intents: string[];
  store: { ok: boolean };
  classifier: { backend: string; examples: number };
}

export interface AuditEntry {
  id: number;
  userId: number | null;
  email: string | null;
  role: Role | null;
  action: string;
  entity: string | null;
  resourceId: string | null;
  method: string | null;
  path: string | null;
  status: number | null;
  details: string | null;
  createdAt: string;
}

/** `GET /api/permissions/matrix`: the caller's own slice plus the full reference. */
export interface PermissionMatrix {
  role: Role;
  permissions: Partial<Record<EntityKey, Action[]>>;
  matrix: Record<Role, Partial<Record<EntityKey, Action[]>>>;
  writableFields: Record<EntityKey, string[] | 'all'>;
}

export interface IndividualClassRow {
  id: string;
  iri: string;
  label: string;
  types: string[];
}

export interface ClassIndividualsPage {
  classLocal: string;
  label: string;
  total: number;
  items: IndividualClassRow[];
}

export interface HierarchyPayload {
  classes: ClassNode[];
  static: ClassNode[];
}

export interface AncestryRow {
  classLocal: string;
  chain: string[];
  labels: Record<string, string>;
}

export interface SessionRow {
  id: string;
  createdAt: string;
  expiresAt: string;
}

export interface NlpIntentMeta {
  name: string;
  roles: string[];
  needs: string[];
  explanation: { en: string; fr: string };
}

export interface RegisterInput {
  email: string;
  password: string;
  fullName: string;
  birthDate?: string;
  gender?: string;
  phone?: string;
  address?: string;
}

/** The REST error envelope every failure uses (see backend src/core/errors.ts). */
export interface ApiProblem {
  status: number;
  code: string;
  message: string;
  details?: { violations?: string[]; [key: string]: unknown };
}
