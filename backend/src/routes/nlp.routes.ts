import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../core/http';
import { authenticate, requireRoles, type AuthUser } from '../auth/middleware';
import type { NlpParse } from '../nlp/client';
import { nlpClient } from '../nlp/client';
import { guardForPatient, ownPatientFilter } from '../nlp/policy';
import { sparql } from '../sparql/client';
import { prefixes } from '../sparql/prefixes';
import { badRequest, forbidden } from '../core/errors';
import { guardReadQuery, readForm } from '../services/query-guard';
import { iriToken, ONT } from '../sparql/escape';
import { audit } from '../auth/audit';
import { logger } from '../config/logger';

const MAX_ROWS = 200;

const SEMANTIC_PATH_SPECS = {
  disease_medications: { sourceSlot: 'disease', targetColumn: 'medication', predicates: ['hasTreatment', 'usesMedication'] },
  disease_treatments: { sourceSlot: 'disease', targetColumn: 'treatment', predicates: ['hasTreatment'] },
  disease_symptoms: { sourceSlot: 'disease', targetColumn: 'symptom', predicates: ['hasSymptom'] },
  symptom_diseases: { sourceSlot: 'symptom', targetColumn: 'd', predicates: ['isSymptomOf'] },
  treatment_medications: { sourceSlot: 'treatment', targetColumn: 'medication', predicates: ['usesMedication'] },
} as const;

interface SemanticPathNode {
  id: string;
  label: string;
}

interface SemanticExplanationPath {
  nodes: SemanticPathNode[];
  predicates: string[];
}

export const nlpRouter = Router();

nlpRouter.use(authenticate);

const askSchema = z.object({
  question: z.string().trim().min(3, 'Ask a longer question').max(400),
  locale: z.enum(['en', 'fr', 'ar', 'tn']).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_ROWS).optional(),
  history: z.array(z.string().trim().min(2).max(400)).max(6).optional(),
});

const parseBody = (body: unknown) => {
  const parsed = askSchema.safeParse(body);
  if (!parsed.success)
    throw badRequest(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  return parsed.data;
};

/**
 * Natural language question -> NLP service -> validated SPARQL -> Fuseki.
 * The generated query always passes the read-only gate, and the role policy here
 * is what decides whose records may appear: the Python service is trusted for
 * language, never for authorisation.
 */
nlpRouter.post(
  '/ask',
  requireRoles('ADMIN', 'DOCTOR', 'PATIENT'),
  asyncHandler(async (req, res) => {
    const user = req.user as AuthUser;
    const input = parseBody(req.body);
    const plan = await buildPlan(input, user);
    enforceRole(plan, user);

    const answer = plan.sparql
      ? await execute(plan.sparql, user, plan)
      : { sparql: '', columns: [], rows: [] as Record<string, string>[], executionMs: 0 };
    const semanticPaths = answer.sparql ? await buildSemanticPaths(plan, answer) : [];

    logger.info({ intent: plan.intent, role: user.role, ms: answer.executionMs }, 'nlp answer');
    const pipeline = answer.sparql
      ? [
          ...plan.pipeline,
          {
            step: 'sparql-execution',
            tool: 'Apache Jena Fuseki',
            detail: answer.rows.length + ' rows returned in ' + answer.executionMs + ' ms',
          },
        ]
      : plan.pipeline;
    audit({
      action: 'NLP_ASK',
      entity: 'nlp',
      resourceId: plan.intent,
      status: 200,
      req,
      details: { question: plan.question, sparql: answer.sparql, confidence: plan.confidence },
    });
    res.json({
      parse: { ...plan, pipeline, reply: assistantReply(plan, answer.rows.length) },
      sparql: answer.sparql,
      columns: answer.columns,
      rows: answer.rows,
      executionMs: answer.executionMs,
      semanticPaths,
    });
  }),
);

/** Show the generated SPARQL without touching the store (question preview). */
nlpRouter.post(
  '/preview',
  requireRoles('ADMIN', 'DOCTOR', 'PATIENT'),
  asyncHandler(async (req, res) => {
    const user = req.user as AuthUser;
    const plan = await buildPlan(parseBody(req.body), user);
    enforceRole(plan, user);
    const sparqlText = plan.sparql ? finalQuery(plan.sparql) : '';
    res.json({ parse: plan, sparql: sparqlText, columns: [], rows: [], executionMs: 0 });
  }),
);

nlpRouter.get(
  '/health',
  requireRoles('ADMIN', 'DOCTOR', 'PATIENT'),
  asyncHandler(async (_req, res) => {
    res.json(await nlpClient.health());
  }),
);

/** The intent catalogue is documentation, every role may read it. */
nlpRouter.get(
  '/intents',
  requireRoles('ADMIN', 'DOCTOR', 'PATIENT'),
  asyncHandler(async (_req, res) => {
    res.json(await nlpClient.intents());
  }),
);

nlpRouter.get(
  '/vocabulary',
  requireRoles('ADMIN'),
  asyncHandler(async (_req, res) => {
    res.json(await nlpClient.vocabulary());
  }),
);

/** Offline evaluation report: intent accuracy, entity linking accuracy, per-test cases. */
nlpRouter.get(
  '/evaluation',
  requireRoles('ADMIN'),
  asyncHandler(async (_req, res) => {
    res.json(await nlpClient.evaluation());
  }),
);

/** Rebuilds the ontology vocabulary and refits the classifier after an ontology change. */
nlpRouter.post(
  '/reload',
  requireRoles('ADMIN'),
  asyncHandler(async (req, res) => {
    const report = await nlpClient.reload();
    audit({ action: 'NLP_RELOAD', entity: 'nlp', status: 200, req });
    res.json(report);
  }),
);

async function buildPlan(
  input: { question: string; locale?: 'en' | 'fr' | 'ar' | 'tn'; limit?: number; history?: string[] },
  user: AuthUser,
): Promise<NlpParse> {
  const own = user.role === 'PATIENT' ? patientSlot(user) : undefined;
  return nlpClient.ask({ ...input, ownPatient: own, history: input.history ?? [] });
}

function assistantReply(plan: NlpParse, count: number): string {
  const language = plan.language;
  if (plan.safety === 'emergency') {
    if (language === 'fr') return 'Si ces symptômes sont présents maintenant ou sont intenses, contactez immédiatement les services d’urgence locaux. Cet assistant ne peut pas évaluer une urgence.';
    if (language === 'ar') return 'إذا كانت هذه الأعراض تحدث الآن أو كانت شديدة، فاتصل فورًا بخدمات الطوارئ المحلية. لا يستطيع هذا المساعد تقييم حالة طارئة.';
    if (language === 'tn') return 'كان الأعراض هاذم موجودين توّا ولا قويّين، اتصل فورًا بالإسعاف المحلي. المساعد هذا ما ينجمش يقيّم حالة استعجالية.';
    return 'If these symptoms are happening now or are severe, contact your local emergency services immediately. This assistant cannot assess an emergency.';
  }
  if (plan.safety === 'care_navigation') {
    const fluLikeQuestion = plan.slots.disease === 'Influenza';
    if (language === 'fr')
      return (fluLikeQuestion
        ? 'Pour des sympt\u00f4mes grippaux, un m\u00e9decin g\u00e9n\u00e9raliste est un premier interlocuteur adapt\u00e9. '
        : 'Si vous ne savez pas quel professionnel consulter, un m\u00e9decin g\u00e9n\u00e9raliste est un bon premier interlocuteur. ') +
        (fluLikeQuestion ? 'L\u2019ontologie ne relie pas la grippe \u00e0 une sp\u00e9cialit\u00e9 pr\u00e9cise ; les m\u00e9decins ci-dessous proviennent de l\u2019annuaire g\u00e9n\u00e9ral. ' : '') +
        (count > 0 ? count + ' m\u00e9decin(s) g\u00e9n\u00e9raliste(s) figurent dans l\u2019annuaire. ' : 'Aucun m\u00e9decin g\u00e9n\u00e9raliste ne figure actuellement dans l\u2019annuaire. ') +
        'Cela ne remplace pas une \u00e9valuation m\u00e9dicale. En cas de difficult\u00e9 importante \u00e0 respirer ou de douleur thoracique soudaine, contactez les urgences locales.';
    if (language === 'ar')
      return '\u0637\u0628\u064a\u0628 \u0627\u0644\u0623\u0633\u0631\u0629 \u0646\u0642\u0637\u0629 \u0628\u062f\u0627\u064a\u0629 \u0645\u0646\u0627\u0633\u0628\u0629 \u0644\u0645\u0639\u0631\u0641\u0629 \u0627\u0644\u0637\u0628\u064a\u0628 \u0627\u0644\u0645\u0646\u0627\u0633\u0628. \u0647\u0630\u0627 \u0644\u0627 \u064a\u063a\u0646\u064a \u0639\u0646 \u062a\u0642\u064a\u064a\u0645 \u0637\u0628\u064a. ' +
        (fluLikeQuestion ? '\u0644\u0627 \u062a\u0631\u0628\u0637 \u0627\u0644\u0623\u0646\u0637\u0648\u0644\u0648\u062c\u064a\u0627 \u0627\u0644\u0625\u0646\u0641\u0644\u0648\u0646\u0632\u0627 \u0628\u062a\u062e\u0635\u0635 \u0645\u062d\u062f\u062f\u061b \u0647\u0630\u0647 \u062e\u064a\u0627\u0631\u0627\u062a \u0639\u0627\u0645\u0629 \u0645\u0646 \u0627\u0644\u062f\u0644\u064a\u0644. ' : '') +
        (count > 0 ? '\u0627\u0644\u0623\u0637\u0628\u0627\u0621 \u0627\u0644\u0645\u062a\u0627\u062d\u0648\u0646 \u0641\u064a \u0627\u0644\u062f\u0644\u064a\u0644: ' + count + '.' : '\u0644\u0627 \u064a\u0648\u062c\u062f \u0637\u0628\u064a\u0628 \u0623\u0633\u0631\u0629 \u0645\u062f\u0631\u062c \u062d\u0627\u0644\u064a\u0627\u064b \u0641\u064a \u0627\u0644\u062f\u0644\u064a\u0644.') +
        ' \u0641\u064a \u062d\u0627\u0644 \u0635\u0639\u0648\u0628\u0629 \u0634\u062f\u064a\u062f\u0629 \u0641\u064a \u0627\u0644\u062a\u0646\u0641\u0633 \u0623\u0648 \u0623\u0644\u0645 \u0645\u0641\u0627\u062c\u0626 \u0641\u064a \u0627\u0644\u0635\u062f\u0631\u060c \u0627\u062a\u0635\u0644 \u0628\u062e\u062f\u0645\u0627\u062a \u0627\u0644\u0637\u0648\u0627\u0631\u0626 \u0627\u0644\u0645\u062d\u0644\u064a\u0629.';
    if (language === 'tn')
      return '\u0637\u0628\u064a\u0628 \u0627\u0644\u0639\u0627\u0626\u0644\u0629 \u064a\u0646\u062c\u0645 \u064a\u0643\u0648\u0646 \u0623\u0648\u0644 \u0645\u062d\u0637\u0629 \u0645\u0644\u0627\u0626\u0645\u0629 \u0643\u064a \u062a\u0639\u0631\u0641 \u0634\u0643\u0648\u0646 \u0627\u0644\u0637\u0628\u064a\u0628 \u0627\u0644\u0645\u0646\u0627\u0633\u0628. \u0647\u0630\u0627 \u0645\u0627 \u064a\u0639\u0648\u0651\u0636\u0634 \u0643\u0634\u0641 \u0637\u0628\u064a. ' +
        (fluLikeQuestion ? '\u0627\u0644\u0623\u0646\u0637\u0648\u0644\u0648\u062c\u064a\u0627 \u0645\u0627 \u062a\u0631\u0628\u0637\u0634 \u0627\u0644\u063a\u0631\u064a\u0628\u0629 \u0628\u0627\u062e\u062a\u0635\u0627\u0635 \u0645\u0639\u064a\u0651\u0646\u061b \u0647\u0630\u0645\u0627 \u0645\u0642\u062a\u0631\u062d\u0627\u062a \u0639\u0627\u0645\u0651\u0629 \u0645\u0646 \u0627\u0644\u062f\u0644\u064a\u0644. ' : '') +
        (count > 0 ? '\u0627\u0644\u0623\u0637\u0628\u0627\u0621 \u0627\u0644\u0645\u062a\u0627\u062d\u0648\u0646 \u0641\u064a \u0627\u0644\u062f\u0644\u064a\u0644: ' + count + '.' : '\u0645\u0627 \u0641\u0645\u0651\u0627\u0634 \u0637\u0628\u064a\u0628 \u0639\u0627\u0626\u0644\u0629 \u0645\u062f\u0631\u062c \u062a\u0648\u0651\u0627 \u0641\u064a \u0627\u0644\u062f\u0644\u064a\u0644.') +
        ' \u0643\u0627\u0646\u062a \u0639\u0646\u062f\u0643 \u0635\u0639\u0648\u0628\u0629 \u0643\u0628\u064a\u0631\u0629 \u0641\u064a \u0627\u0644\u062a\u0646\u0641\u0633 \u0648\u0644\u0627 \u0648\u062c\u064a\u0639\u0629 \u0642\u0648\u064a\u0629 \u0641\u064a \u0627\u0644\u0635\u062f\u0631\u060c \u0627\u062a\u0635\u0644 \u0628\u0627\u0644\u0625\u0633\u0639\u0627\u0641 \u0627\u0644\u0645\u062d\u0644\u064a.';
    return (fluLikeQuestion
      ? 'For flu-like symptoms, a general practitioner is a reasonable first clinician to contact. '
      : 'If you are unsure which clinician to contact, a general practitioner is a reasonable first place to start. ') +
      (fluLikeQuestion ? 'The ontology does not link influenza to a specific specialty; the doctors below are a general-care directory result. ' : '') +
      (count > 0 ? count + ' general practitioner(s) are listed in the directory. ' : 'No general practitioners are currently listed in the directory. ') +
      'This does not replace a medical assessment. If you have severe difficulty breathing or sudden chest pain, contact local emergency services.';
  }
  if (plan.intent === 'not_understood') {
    if (language === 'fr') return 'Je n’ai pas pu relier cette question aux informations médicales disponibles dans l’application. Reformulez-la ou demandez de l’aide à votre équipe de soins.';
    if (language === 'ar') return 'لم أتمكن من ربط هذا السؤال بالمعلومات الطبية المتاحة في التطبيق. أعد صياغته أو اطلب المساعدة من فريق الرعاية.';
    if (language === 'tn') return 'ما نجمتش نربط السؤال هذا بالمعلومات الطبية الموجودة في التطبيق. عاود صيغو ولا اسأل فريق الرعاية متاعك.';
    return 'I could not map this question to medical information available in the application. Try rephrasing it or ask your care team.';
  }
  if (plan.intent === 'medication_dosage') {
    if (language === 'fr') return 'La base indique ' + count + ' résultat(s) de posologie. Cette information enregistrée ne constitue pas un conseil de dose personnalisé.';
    if (language === 'ar') return 'تتضمن قاعدة البيانات ' + count + ' نتيجة للجرعة. هذه معلومة مسجلة وليست نصيحة شخصية لتحديد الجرعة.';
    if (language === 'tn') return 'قاعدة البيانات فيها ' + count + ' نتيجة على الجرعة. المعلومة هاذي موثقة وماهيش نصيحة شخصية للجرعات.';
    return 'The database contains ' + count + ' documented dosage result(s). This is not personalized dosing advice.';
  }
  if (count === 0) {
    if (language === 'fr') return 'Je n’ai trouvé aucun résultat correspondant dans les données médicales disponibles.';
    if (language === 'ar') return 'لم أجد نتائج مطابقة في البيانات الطبية المتاحة.';
    if (language === 'tn') return 'ما لقيتش نتائج مطابقة في المعلومات الطبية المتوفّرة.';
    return 'I found no matching results in the available medical data.';
  }
  if (language === 'fr') return 'J’ai trouvé ' + count + ' résultat(s) correspondant(s) dans les données médicales disponibles.';
  if (language === 'ar') return 'وجدت ' + count + ' نتيجة مطابقة في البيانات الطبية المتاحة.';
  if (language === 'tn') return 'لقيت ' + count + ' نتيجة مطابقة في المعلومات الطبية المتوفّرة.';
  return 'I found ' + count + ' matching result(s) in the available medical data.';
}

/** A patient account must be linked to a Patient individual to ask about records. */
function patientSlot(user: AuthUser): string {
  if (!user.linkedId) throw forbidden('This account is not linked to a patient record');
  if (!/^Patient_[A-Za-z0-9_]+$/.test(user.linkedId))
    throw forbidden('This account is not linked to a patient record');
  return user.linkedId;
}

function enforceRole(plan: NlpParse, user: AuthUser): void {
  if (user.role !== 'PATIENT') return;
  guardForPatient(plan, user.linkedId);
}

interface Answer {
  sparql: string;
  columns: string[];
  rows: Record<string, string>[];
  executionMs: number;
}

/** Read-only gate plus the prefix declarations the generated query lacks. */
function finalQuery(generated: string): string {
  const guarded = guardReadQuery(generated, MAX_ROWS);
  // the service already declares its prefixes, only the missing ones are added
  return `${prefixes.missingIn(guarded)}\n${guarded}`.trim();
}

async function execute(generated: string, user: AuthUser, plan: NlpParse): Promise<Answer> {
  let query = finalQuery(generated);
  let doctorPatientLocals: Set<string> | null = null;
  if (user.role === 'DOCTOR') {
    const scoped = await scopeDoctorQuery(query, user, plan);
    query = scoped.query;
    doctorPatientLocals = scoped.ownLocals;
  }

  if (readForm(query) === 'ask') {
    const truth = await sparql.ask(query);
    return { sparql: query, columns: ['answer'], rows: [{ answer: String(truth) }], executionMs: 0 };
  }
  if (readForm(query) === 'construct') {
    const graph = await sparql.construct(query);
    const rows = graph.ntriples
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((triple) => ({ triple }));
    return { sparql: query, columns: ['triple'], rows, executionMs: graph.executionMs };
  }
  const result = await sparql.select(query);
  let rows = result.rows.map((row) => {
    const out: Record<string, string> = {};
    for (const [key, term] of Object.entries(row)) out[key] = term?.value ?? '';
    return out;
  });
  if (doctorPatientLocals) rows = ownPatientFilter(doctorPatientLocals)(rows);
  return { sparql: query, columns: result.vars, rows, executionMs: result.executionMs };
}

function localOntologyId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let local = value.trim();
  if (local.startsWith('<') && local.endsWith('>')) local = local.slice(1, -1);
  if (local.startsWith(ONT)) local = local.slice(ONT.length);
  else if (local.startsWith('ont:')) local = local.slice('ont:'.length);
  else if (local.includes(':')) return null;
  return /^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(local) ? local : null;
}

/** Explain selected public knowledge intents using allow-listed ontology properties. */
async function buildSemanticPaths(plan: NlpParse, answer: Answer): Promise<SemanticExplanationPath[]> {
  const spec = SEMANTIC_PATH_SPECS[plan.intent as keyof typeof SEMANTIC_PATH_SPECS];
  if (!spec || !answer.columns.includes(spec.targetColumn)) return [];

  const source = localOntologyId(plan.slots[spec.sourceSlot]);
  const targets = [
    ...new Set(
      answer.rows
        .map((row) => localOntologyId(row[spec.targetColumn]))
        .filter((id): id is string => id !== null),
    ),
  ].slice(0, 30);
  if (!source || targets.length === 0) return [];

  const variables = Array.from({ length: spec.predicates.length + 1 }, (_, index) => '?node' + index);
  const lastVariable = '?node' + spec.predicates.length;
  const selected = variables.flatMap((variable, index) => [variable, '?label' + index]).join(' ');
  const patterns = [
    'VALUES ?node0 { ' + iriToken(source) + ' }',
    'VALUES ' + lastVariable + ' { ' + targets.map(iriToken).join(' ') + ' }',
    ...spec.predicates.map((predicate, index) => variables[index]! + ' ont:' + predicate + ' ' + variables[index + 1]! + ' .'),
    ...variables.map((variable, index) => 'OPTIONAL { ' + variable + ' rdfs:label ?label' + index + ' . }'),
  ];
  const query = finalQuery(
    prefixes.withPrefixes('SELECT DISTINCT ' + selected + ' WHERE {\n' + patterns.join('\n') + '\n}\nLIMIT 60'),
  );

  try {
    const result = await sparql.select(query);
    const paths: SemanticExplanationPath[] = [];
    const seen = new Set<string>();
    for (const row of result.rows) {
      const nodes: SemanticPathNode[] = [];
      for (let index = 0; index < variables.length; index += 1) {
        const id = localOntologyId(row['node' + index]?.value);
        if (!id) break;
        const label = String(row['label' + index]?.value ?? '').trim();
        nodes.push({ id, label: label || id.replace(/_/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2') });
      }
      if (nodes.length !== variables.length) continue;
      const key = nodes.map((node) => node.id).join('>');
      if (seen.has(key)) continue;
      seen.add(key);
      paths.push({ nodes, predicates: [...spec.predicates] });
    }
    return paths;
  } catch (error) {
    logger.warn({ intent: plan.intent, error: String(error) }, 'semantic path lookup failed');
    return [];
  }
}

const PATIENT_QUERY_TERMS = /(?:ont:|#)(?:Patient|AdultPatient|ChildPatient|ElderlyPatient|ChronicPatient|EmergencyPatient|MedicalTest|BloodTest|UrineTest|XRay|MRI|CTScan|MedicalAppointment|Consultation|FollowUpAppointment|EmergencyAppointment)(?:\b|_)/i;
const PATIENT_QUERY_PROPERTIES = /\bont:(?:hasDisease|treatedBy|undergoesTest|hasAppointment|isDiseaseOf|isTestOf|appointmentOf|treats|followedInDepartment|followedInHospital)\b/i;

function patientBinding(query: string): string | null {
  const patterns = [
    /(\?\w+)\s+(?:a|rdf:type)\s+ont:(?:Patient|AdultPatient|ChildPatient|ElderlyPatient|ChronicPatient|EmergencyPatient)\b/i,
    /(\?\w+)\s+ont:(?:hasDisease|treatedBy|undergoesTest|hasAppointment|followedInDepartment|followedInHospital)\b/i,
    /\?\w+\s+ont:(?:isDiseaseOf|isTestOf|appointmentOf|treats)\s+(\?\w+)/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(query);
    if (match?.[1]) return match[1];
  }
  return null;
}

/** Scope patient-bearing doctor queries in SPARQL, before any result can leave Fuseki. */
async function scopeDoctorQuery(query: string, user: AuthUser, plan: NlpParse): Promise<{ query: string; ownLocals: Set<string> }> {
  if (!user.linkedId) throw forbidden('This account is not linked to a doctor record');
  const doctor = iriToken(user.linkedId);
  const ownershipQuery = prefixes.withPrefixes('SELECT ?p WHERE { ?p ont:treatedBy ' + doctor + ' } LIMIT ' + MAX_ROWS);
  const owned = await sparql.select(ownershipQuery);
  const ownLocals = new Set(owned.rows.map((row) => row.p?.value ?? '').filter(Boolean).map((iri) => String(iri).slice(String(iri).indexOf('#') + 1)));
  const named = plan.slots['patient'];
  const namedLocal = typeof named === 'string' ? named.slice(named.lastIndexOf('#') + 1) : null;
  if (namedLocal && !ownLocals.has(namedLocal)) throw forbidden('A doctor may only ask about patients they follow');
  const namedRefs = [...query.matchAll(/(?:<[^>]*#|ont:)(Patient_[A-Za-z0-9_]+)/g)].map((match) => match[1] ?? "").filter(Boolean);
  if (namedRefs.some((local) => !ownLocals.has(local))) throw forbidden('A doctor may only ask about patients they follow');
  if (!PATIENT_QUERY_TERMS.test(query) && !PATIENT_QUERY_PROPERTIES.test(query)) return { query, ownLocals };
  const binding = patientBinding(query);
  if (!binding) {
    if (namedRefs.length > 0) return { query, ownLocals };
    throw forbidden("The generated query cannot be safely scoped to this doctor's patients");
  }
  const where = /\bWHERE\s*\{/i.exec(query);
  if (!where) throw forbidden("The generated query cannot be safely scoped to this doctor's patients");
  const openBrace = query.indexOf('{', where.index);
  const values = ownLocals.size ? 'VALUES ' + binding + ' { ' + [...ownLocals].map(iriToken).join(' ') + ' }' : 'FILTER(false)';
  return { query: query.slice(0, openBrace + 1) + '\n  ' + values + '\n' + query.slice(openBrace + 1), ownLocals };
}
