import type { EntityKey } from './ontology/registry';
import { ENTITY_DEFS, ENTITY_KEYS, GENDER_VALUES } from './ontology/registry';
import { can } from './auth/middleware';
import type { Action } from './auth/middleware';
import { WRITABLE_FIELDS } from './http/guards';
import { ROLES } from './auth/model';
import { env } from './config/env';

/**
 * OpenAPI 3 document served at /api/docs. Entity CRUD paths are generated from
 * the metadata registry so the documentation can never drift from the API.
 */
const entityPaths = (): Record<string, object> => {
  const paths: Record<string, object> = {};
  for (const key of ENTITY_KEYS) {
    const def = ENTITY_DEFS[key];
    const tag = def.plural;
    const allow = (action: Action) => ROLES.filter((role) => can(role, key, action));

    paths[`/api/${key}`] = {
      get: {
        tags: [tag],
        summary: `Paginated, filterable list of ${def.plural}`,
        description: `Roles: ${allow('read').join(', ')}. Supports page, pageSize, sort, order, q and every ${def.key} filter from the registry.`,
        security: [{ bearerAuth: [] }],
        parameters: [
          ...['page', 'pageSize', 'sort', 'order', 'q'].map((name) =>({ name, in: 'query', schema: { type: 'string' }, example: undefined, description: paramDoc(name) })),
          ...def.data.filter((d) => d.values || d.datatype !== 'string' || d.search).map((d) => ({
            name: d.field,
            in: 'query',
            schema: { type: d.datatype === 'integer' ? 'integer' : 'string', enum: d.values ? [...d.values] : undefined },
            description: `Filter on ${d.field}`,
          })),
          ...def.relations.filter((r) => r.filterParam).map((r) => ({ name: r.filterParam as string, in: 'query', schema: { type: 'string' }, description: `Filter ${def.label} linked to a ${r.target.replace(/s$/, '')} id` })),
          ...(def.typeFacet ? [{ name: def.typeFacet.filterParam, in: 'query', schema: { type: 'string', enum: [...def.typeFacet.classes] }, description: `Filter by ${def.typeFacet.label}` }] : []),
        ],
        responses: { 200: { description: 'Page envelope', content: { 'application/json': { schema: { $ref: '#/components/schemas/Page' } } } } },
      },
      post: {
        tags: [tag],
        summary: `Create a ${def.label.toLowerCase()}`,
        description: `Roles: ${allow('create').join(', ') || 'none'}. Materializes the full class closure, both sides of every inverse pair and the derived classes in one atomic SPARQL Update.`,
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: entitySchemaRef(key) } } },
        responses: {
          201: { description: 'Created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Individual' } } } },
          422: { $ref: '#/components/responses/AxiomViolation' },
        },
      },
    };

    paths[`/api/${key}/refs`] = {
      get: {
        tags: [tag],
        summary: `Lightweight id/label options for ${def.plural} selectors`,
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'q', in: 'query', schema: { type: 'string' }, description: 'substring filter' },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
        ],
        responses: { 200: { description: 'Reference list' } },
      },
    };

    paths[`/api/${key}/{id}`] = {
      get: {
        tags: [tag],
        summary: `Fetch one ${def.label.toLowerCase()} with its relations`,
        security: [{ bearerAuth: [] }],
        parameters: idParam,
        responses: {
          200: { description: 'Individual', content: { 'application/json': { schema: { $ref: '#/components/schemas/Individual' } } } },
          404: { description: 'Not found' },
        },
      },
      patch: {
        tags: [tag],
        summary: `Partial update of a ${def.label.toLowerCase()}`,
        description: `Roles: ${allow('update').join(', ') || 'none'}. Writable fields per restricted role: ${JSON.stringify(restrictedFor(key))}; anything else is reserved for the back office.`,
        security: [{ bearerAuth: [] }],
        parameters: idParam,
        requestBody: { required: true, content: { 'application/json': { schema: entitySchemaRef(key) } } },
        responses: { 200: { description: 'Updated individual' }, 403: { description: 'Forbidden field or out of scope' }, 422: { $ref: '#/components/responses/AxiomViolation' } },
      },
      delete: {
        tags: [tag],
        summary: `Delete a ${def.label.toLowerCase()}`,
        description: 'Patients cascade to their appointments and tests; any other individual is blocked with 409 and the list of dependents unless reassignTo is provided.',
        security: [{ bearerAuth: [] }],
        parameters: idParam,
        responses: {
          200: { description: 'Deletion report' },
          409: { description: 'Dependent individuals would be orphaned', content: { 'application/json': { schema: { $ref: '#/components/schemas/DependencyConflict' } } } },
        },
      },
    };

    paths[`/api/${key}/{id}/dependents`] = {
      get: {
        tags: [tag],
        summary: `What references this ${def.label.toLowerCase()}`,
        security: [{ bearerAuth: [] }],
        parameters: idParam,
        responses: { 200: { description: 'Dependency report' } },
      },
    };
  }
  return paths;
};

const idParam = [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Individual local name, e.g. Patient_Ahmed' }];

/** The registry stays the single source of the phone format the self-registration form mirrors. */
const patientPhoneField = ENTITY_DEFS.patients.data.find((d) => d.field === 'phone');

const paramDoc = (name: string): string =>
  ({
    page: '1-based page number',
    pageSize: 'items per page (max 100)',
    sort: 'label or any sortable data property',
    order: 'asc | desc',
    q: 'free text matched on labels, synonyms and searchable properties',
  })[name] ?? name;

const restrictedFor = (key: EntityKey): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  for (const role of ['PATIENT', 'DOCTOR'] as const) {
    const list = WRITABLE_FIELDS[role][key];
    if (list?.length) out[role] = list;
  }
  return out;
};

const entitySchemaRef = (key: string): object => ({ $ref: `#/components/schemas/${key}Input` });

const inputSchemas = (): Record<string, object> => {
  const out: Record<string, object> = {};
  for (const key of ENTITY_KEYS) {
    const def = ENTITY_DEFS[key];
    const props: Record<string, object> = {};
    for (const d of def.data)
      props[d.field] = {
        type: d.datatype === 'integer' ? 'integer' : 'string',
        description: `${d.predicate}${d.required ? ' (required)' : ''}${d.values ? ` - one of ${d.values.join(', ')}` : ''}`,
        ...(d.values ? { enum: [...d.values] } : {}),
        ...(d.pattern ? { pattern: d.pattern } : {}),
      };
    for (const r of def.relations)
      if (!r.readOnly && !r.virtual)
        props[r.field] = { type: 'array', items: { type: 'string' }, description: `${r.predicate} -> ${r.target} ids` };
    if (def.typeFacet) props[def.typeFacet.field] = { type: 'array', items: { type: 'string', enum: [...def.typeFacet.classes] }, description: `asserted subclasses of ${def.classLocal}` };
    props.label = { type: 'string', description: 'rdfs:label, generated when omitted' };
    props.altLabels = { type: 'array', items: { type: 'string' }, description: 'skos:altLabel synonyms used by search' };
    out[key] = {
      type: 'object',
      title: `${def.label} input`,
      description: def.description,
      required: [...def.data.filter((d) => d.required).map((d) => d.field), ...(def.typeFacet?.required ? [def.typeFacet.field] : []), ...def.relations.filter((r) => r.required && !r.readOnly && !r.virtual).map((r) => r.field)],
      properties: props,
      additionalProperties: false,
    };
  }
  return out;
};

export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'MedicCare API',
    version: '1.0.0',
    description:
      'REST surface of the MedicCare semantic medical platform. Clinical data lives in an Apache Jena Fuseki triple store filled from the provided OWL ontology; the server materializes every inference the ontology declares (subclass closure, inverse properties, property chains, defined patient classes) inside a single atomic SPARQL Update per write. Users, refresh tokens and the audit trail are stored in SQLite.',
  },
  servers: [{ url: `http://localhost:${env.PORT}`, description: 'local' }],
  tags: [...ENTITY_KEYS.map((k) => ({ name: ENTITY_DEFS[k].plural, description: ENTITY_DEFS[k].description })), { name: 'auth' }, { name: 'admin' }, { name: 'semantic' }],
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    responses: {
      AxiomViolation: {
        description: 'Ontological axiom violated',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } },
      },
    },
    schemas: {
      Problem: {
        type: 'object',
        properties: {
          status: { type: 'integer' },
          code: { type: 'string', example: 'AXIOM_VIOLATION' },
          message: { type: 'string' },
          details: { type: 'object', properties: { violations: { type: 'array', items: { type: 'string' } } } },
        },
      },
      Page: {
        type: 'object',
        properties: {
          items: { type: 'array', items: { $ref: '#/components/schemas/Individual' } },
          page: { type: 'integer' },
          pageSize: { type: 'integer' },
          total: { type: 'integer' },
          totalPages: { type: 'integer' },
          sort: { type: 'string', nullable: true },
          order: { type: 'string', enum: ['asc', 'desc'] },
          q: { type: 'string', nullable: true },
        },
      },
      Individual: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          iri: { type: 'string' },
          label: { type: 'string' },
          types: { type: 'array', items: { type: 'string' }, description: 'all asserted classes, including the materialized superclasses' },
          fields: { type: 'object' },
          relations: { type: 'object' },
        },
      },
      DependencyConflict: {
        type: 'object',
        properties: {
          code: { type: 'string', example: 'DEPENDENTS_EXIST' },
          details: { type: 'array', items: { type: 'object' } },
        },
      },
      Login: {
        type: 'object',
        required: ['email', 'password'],
        properties: { email: { type: 'string', format: 'email' }, password: { type: 'string', format: 'password' } },
      },
      TokenPair: {
        type: 'object',
        properties: {
          accessToken: { type: 'string' },
          refreshToken: { type: 'string' },
          expiresIn: { type: 'integer' },
          user: { $ref: '#/components/schemas/User' },
        },
      },
      User: {
        type: 'object',
        description: 'Public view of an account, exactly what toPublicUser returns: never the password nor its hash',
        properties: {
          id: { type: 'integer' },
          email: { type: 'string' },
          role: { type: 'string', enum: [...ROLES] },
          fullName: { type: 'string' },
          linkedId: { type: 'string', nullable: true, description: 'Patient or Doctor individual this account maps to in the ontology' },
          locale: { type: 'string', enum: ['en', 'fr'] },
          active: { type: 'boolean' },
          createdAt: { type: 'string' },
          lastLoginAt: { type: 'string', nullable: true },
        },
      },
      Register: {
        type: 'object',
        title: 'Patient self-registration input',
        description: 'birthDate is converted into the :hasAge integer the ontology declares; the age class (Child/Adult/Elderly Patient) is derived from it by the writer.',
        required: ['email', 'password', 'fullName', 'birthDate', 'gender'],
        additionalProperties: false,
        properties: {
          email: { type: 'string', format: 'email', maxLength: 160, description: 'unique across accounts' },
          password: {
            type: 'string',
            format: 'password',
            minLength: 8,
            maxLength: 200,
            pattern: '^(?=.*[A-Za-z])(?=.*[0-9]).*$',
            description: 'at least 8 characters, containing a letter and a digit',
          },
          fullName: { type: 'string', minLength: 2, maxLength: 160, description: 'stored as :hasName and as the rdfs:label of the individual' },
          birthDate: { type: 'string', format: 'date', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'real calendar date, never in the future' },
          gender: { type: 'string', enum: [...GENDER_VALUES], description: ':hasGender value set' },
          phone: {
            type: 'string',
            pattern: patientPhoneField?.pattern ?? '^[0-9+ ]{6,20}$',
            maxLength: patientPhoneField?.maxLength ?? 20,
            description: 'same format the patients registry declares for :hasPhoneNumber',
          },
          address: { type: 'string', maxLength: 200, description: 'recorded in the REGISTER audit entry; :Patient declares no address property' },
          locale: { type: 'string', enum: ['en', 'fr'], description: 'UI language of the account, defaults to fr' },
        },
      },
      Registration: {
        type: 'object',
        required: ['account', 'patient'],
        properties: {
          account: { $ref: '#/components/schemas/User' },
          patient: {
            type: 'object',
            required: ['id'],
            properties: { id: { type: 'string', example: 'Patient_NawelBenAli', description: 'local name of the created Patient individual' } },
          },
        },
      },
      PasswordResetRequest: {
        type: 'object',
        required: ['ok', 'delivered'],
        properties: {
          ok: { type: 'boolean', example: true },
          delivered: { type: 'boolean', example: false, description: 'always false: no mail transport is configured in this project' },
        },
      },
      ...inputSchemas(),
    },
  },
  paths: {
    '/api/status': { get: { tags: ['admin'], summary: 'API and triple store health', responses: { 200: { description: 'status' } } } },
    '/api/auth/login': {
      post: {
        tags: ['auth'],
        summary: 'Exchange credentials for a JWT access token and a rotating refresh token',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Login' } } } },
        responses: { 200: { description: 'token pair', content: { 'application/json': { schema: { $ref: '#/components/schemas/TokenPair' } } } }, 401: { description: 'invalid credentials' }, 423: { description: 'account disabled' } },
      },
    },
    '/api/auth/refresh': {
      post: { tags: ['auth'], summary: 'Rotate a refresh token (reuse revokes the whole family)', security: [{ bearerAuth: [] }], responses: { 200: { description: 'new pair' } } },
    },
    '/api/auth/logout': { post: { tags: ['auth'], summary: 'Revoke the current refresh token', security: [{ bearerAuth: [] }], responses: { 200: { description: 'ok' } } } },
    '/api/auth/me': { get: { tags: ['auth'], summary: 'Current profile including the linked ontology individual', security: [{ bearerAuth: [] }], responses: { 200: { description: 'profile' } } } },
    '/api/auth/change-password': { post: { tags: ['auth'], summary: 'Change own password and revoke other sessions', security: [{ bearerAuth: [] }], responses: { 200: { description: 'ok' } } } },
    '/api/auth/sessions': { get: { tags: ['auth'], summary: 'Active refresh sessions of the caller', security: [{ bearerAuth: [] }], responses: { 200: { description: 'sessions' } } } },
    '/api/auth/register': {
      post: {
        tags: ['auth'],
        summary: 'Patient self-registration: creates the Patient individual and its PATIENT account',
        description:
          'Public route, behind the authentication rate limiter. The order is fixed: the e-mail uniqueness check (409), then the Patient individual through the ontology writer - class closure, rdfs:label equal to fullName, :hasAge and the derived age class computed from birthDate - then the linked account. If the account insert fails, the individual created a moment before is deleted again so no orphan Patient stays in the store. Success is audited with action REGISTER (never the password). address is kept in the audit trail only: the ontology declares no address datatype property on :Patient.',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Register' } } } },
        responses: {
          201: { description: 'Account and Patient individual created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Registration' } } } },
          400: { description: 'Malformed body, weak password or invalid birthDate/phone', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
          409: { description: 'An account with this e-mail already exists', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
          422: { $ref: '#/components/responses/AxiomViolation' },
          429: { description: 'Too many authentication attempts' },
        },
      },
    },
    '/api/auth/forgot-password': {
      post: {
        tags: ['auth'],
        summary: 'Password reset request (documented stub: no mail transport in this project)',
        description:
          'Public route, behind the authentication rate limiter, audited with action PASSWORD_RESET_REQUEST and no user. Mail delivery is out of scope, so no link is ever sent; the response body is the same for an unknown e-mail as for a known one, which keeps this endpoint useless for account enumeration.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['email'], additionalProperties: false, properties: { email: { type: 'string', format: 'email', maxLength: 160 } } } } },
        },
        responses: {
          200: { description: 'Always returned, for known and unknown e-mails alike', content: { 'application/json': { schema: { $ref: '#/components/schemas/PasswordResetRequest' } } } },
          400: { description: 'Missing or malformed e-mail', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
          429: { description: 'Too many authentication attempts' },
        },
      },
    },
    '/api/users': {
      get: { tags: ['admin'], summary: 'List accounts (ADMIN)', security: [{ bearerAuth: [] }], responses: { 200: { description: 'users' } } },
      post: { tags: ['admin'], summary: 'Create account (ADMIN)', security: [{ bearerAuth: [] }], responses: { 201: { description: 'created' } } },
    },
    '/api/users/{id}': {
      get: { tags: ['admin'], summary: 'Read one account', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'user' } } },
      patch: { tags: ['admin'], summary: 'Update role, active flag or password', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'updated' } } },
      delete: { tags: ['admin'], summary: 'Delete an account (never the caller)', security: [{ bearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'deleted' } } },
    },
    '/api/audit': { get: { tags: ['admin'], summary: 'Audit trail of writes, logins and raw SPARQL usage', security: [{ bearerAuth: [] }], responses: { 200: { description: 'entries' } } } },
    '/api/permissions/matrix': { get: { tags: ['admin'], summary: 'Effective RBAC matrix and reserved fields for the caller role', security: [{ bearerAuth: [] }], responses: { 200: { description: 'matrix' } } } },
    '/api/meta/entities': { get: { tags: ['semantic'], summary: 'Registry descriptor driving the dynamic forms, filters and tables', security: [{ bearerAuth: [] }], responses: { 200: { description: 'descriptors' } } } },
    '/api/meta/hierarchy': { get: { tags: ['semantic'], summary: 'Class ancestry and labels', security: [{ bearerAuth: [] }], responses: { 200: { description: 'ancestry' } } } },
    '/api/meta/health': { get: { tags: ['admin'], summary: 'Fuseki and NLP service probe', responses: { 200: { description: 'health' } } } },
    '/api/search': {
      get: {
        tags: ['semantic'],
        summary: 'Cross-entity SPARQL full-text search over labels, skos:altLabel synonyms and data properties',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'q', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'entities', in: 'query', schema: { type: 'string' }, description: `comma separated subset of ${ENTITY_KEYS.join(', ')}` },
          { name: 'perEntity', in: 'query', schema: { type: 'integer', default: 5 } },
        ],
        responses: { 200: { description: 'grouped hits with the executed SPARQL' } },
      },
    },
    '/api/dashboard': { get: { tags: ['semantic'], summary: 'Aggregations computed by SPARQL COUNT/GROUP BY, with the query text and timings (ADMIN, DOCTOR, RECEPTIONIST)', security: [{ bearerAuth: [] }], responses: { 200: { description: 'dashboard payload' } } } },
    '/api/sparql': {
      post: {
        tags: ['admin'],
        summary: 'Single documented SPARQL entry point { query, type }: read forms go through the guard, write forms need "confirm": true (ADMIN)',
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['query', 'type'], properties: { query: { type: 'string' }, type: { type: 'string', enum: ['select', 'ask', 'construct', 'describe', 'insert', 'delete', 'deleteinsert', 'update'] }, limit: { type: 'integer' }, confirm: { type: 'boolean' } } } } } },
        responses: { 200: { description: 'bindings, graph or update statistics' } },
      },
    },
    '/api/consistency': { get: { tags: ['semantic'], summary: 'Materialization audit: 14 inference checks (ADMIN)', security: [{ bearerAuth: [] }], responses: { 200: { description: 'report' } } } },
    '/api/consistency/repair': { post: { tags: ['semantic'], summary: 'Re-materialize missing superclasses, inverse pairs, chains and derived classes in one atomic update (ADMIN)', security: [{ bearerAuth: [] }], responses: { 200: { description: 'repair result' } } } },
    '/api/ontology/stats': { get: { tags: ['semantic'], summary: 'TBox/ABox census and axiom counts read from the store', security: [{ bearerAuth: [] }], responses: { 200: { description: 'stats' } } } },
    '/api/ontology/hierarchy': { get: { tags: ['semantic'], summary: 'rdfs:subClassOf tree with individual counts', security: [{ bearerAuth: [] }], responses: { 200: { description: 'tree' } } } },
    '/api/ontology/classes': { get: { tags: ['semantic'], summary: 'Class tree used by the explorer tree view (same payload as /hierarchy)', security: [{ bearerAuth: [] }], responses: { 200: { description: 'tree' } } } },
    '/api/ontology/individuals': { get: { tags: ['semantic'], summary: 'Named individuals asserted under one class, with their full type set', security: [{ bearerAuth: [] }], parameters: [{ name: 'class', in: 'query', required: true, schema: { type: 'string' }, description: 'class local name, e.g. Patient or Cardiologist' }, { name: 'limit', in: 'query', schema: { type: 'integer', default: 200 } }], responses: { 200: { description: 'individuals' } } } },
    '/api/ontology/properties': { get: { tags: ['semantic'], summary: 'Object, datatype and annotation properties with domain, range, inverses, characteristics and chains', security: [{ bearerAuth: [] }], responses: { 200: { description: 'properties' } } } },
    '/api/ontology/graph': { get: { tags: ['semantic'], summary: 'Nodes and edges for the ontology graph view; with focus/depth it returns the ego graph of one individual', security: [{ bearerAuth: [] }], parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', default: 160 } }, { name: 'focus', in: 'query', schema: { type: 'string' }, description: 'individual id to expand from' }, { name: 'depth', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 3, default: 2 } }], responses: { 200: { description: 'graph' } } } },
    '/api/ontology/individuals/{id}': { get: { tags: ['semantic'], summary: 'Every asserted triple of one individual, in both directions', security: [{ bearerAuth: [] }], parameters: idParam, responses: { 200: { description: 'triples' } } } },
    '/api/nlp/ask': {
      post: {
        tags: ['semantic'],
        summary: 'Natural language question (EN/FR) to SPARQL: spaCy NER + RapidFuzz entity linking + scikit-learn intent classifier, executed through the read-only gate (ADMIN)',
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['question'], properties: { question: { type: 'string' }, locale: { type: 'string', enum: ['en', 'fr'] }, limit: { type: 'integer' } } } } } },
        responses: { 200: { description: 'intent, entities, generated SPARQL, pipeline trace and answer rows' } },
      },
    },
    '/api/nlp/preview': { post: { tags: ['semantic'], summary: 'Generated SPARQL without execution', security: [{ bearerAuth: [] }], responses: { 200: { description: 'plan' } } } },
    '/api/nlp/health': { get: { tags: ['semantic'], summary: 'NLP service models and intents', security: [{ bearerAuth: [] }], responses: { 200: { description: 'health' } } } },
    '/api/nlp/vocabulary': { get: { tags: ['semantic'], summary: 'Labels and synonyms the fuzzy matcher resolves against', security: [{ bearerAuth: [] }], responses: { 200: { description: 'vocabulary' } } } },
    '/api/nlp/evaluation': { get: { tags: ['semantic'], summary: 'Accuracy report of the NLP test suite', security: [{ bearerAuth: [] }], responses: { 200: { description: 'metrics' } } } },
    '/api/console/query': {
      post: {
        tags: ['admin'],
        summary: 'Read-only SPARQL console: SELECT/ASK/CONSTRUCT/DESCRIBE only, LIMIT capped, update keywords and SERVICE refused (ADMIN)',
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['query'], properties: { query: { type: 'string' }, limit: { type: 'integer' } } } } } },
        responses: { 200: { description: 'result set plus the executed query' } },
      },
    },
    '/api/console/update': {
      post: {
        tags: ['admin'],
        summary: 'Raw SPARQL Update, requires confirm=true and is audited (ADMIN)',
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['update', 'confirm'], properties: { update: { type: 'string' }, confirm: { type: 'boolean', example: true } } } } } },
        responses: { 200: { description: 'commit statistics' } },
      },
    },
    ...entityPaths(),
  },
};
