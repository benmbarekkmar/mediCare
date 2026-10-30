import type { AxiosError } from 'axios';
import axios from 'axios';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { AppError, serviceUnavailable } from '../core/errors';

/** The four term kinds the entity linker can recognise. */
export type NlpTermKind = 'class' | 'individual' | 'property' | 'value';

export interface NlpEntity {
  text: string;
  type: NlpTermKind;
  id: string;
  iri: string;
  label: string;
  matchedVia: string;
  score: number;
}

export interface NlpPipelineStep {
  step: string;
  tool: string;
  detail: string;
}

/** One natural language question mapped onto a parameterised SPARQL template. */
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
  pipeline: NlpPipelineStep[];
  allowedRoles: string[];
  classifierScores: Record<string, number>;
  /** Short factual response composed by the API from the executed rows. */
  reply?: string;
  safety?: string;
}

export interface NlpHealth {
  ok: boolean;
  version: string;
  language: string;
  models: { name: string; loaded: boolean }[];
  vocabSize: number;
  intents: string[];
  store: { ok: boolean; detail?: string };
  classifier: { backend: string; examples: number };
  minConfidence: number;
}

/** Snake-case wire shape of the Python service. */
interface RawParse {
  question: string;
  language: string;
  intent: string;
  confidence: number;
  entities: (Omit<NlpEntity, 'matchedVia'> & { matched_via: string })[];
  slots?: Record<string, unknown>;
  filters?: Record<string, unknown>;
  sparql: string;
  explanation: Record<string, string>;
  suggestions?: string[];
  pipeline?: NlpPipelineStep[];
  allowed_roles?: string[];
  classifier_scores?: Record<string, number>;
  reply?: string;
  safety?: string;
}

const toParse = (raw: RawParse): NlpParse => ({
  question: raw.question,
  language: raw.language,
  intent: raw.intent,
  confidence: raw.confidence,
  entities: (raw.entities ?? []).map((entity) => ({
    ...entity,
    matchedVia: entity.matched_via,
  })),
  slots: raw.slots ?? raw.filters ?? {},
  filters: raw.filters ?? raw.slots ?? {},
  sparql: raw.sparql ?? '',
  explanation: raw.explanation ?? {},
  suggestions: raw.suggestions ?? [],
  pipeline: raw.pipeline ?? [],
  allowedRoles: raw.allowed_roles ?? [],
  classifierScores: raw.classifier_scores ?? {},
  reply: raw.reply,
  safety: raw.safety,
});

/** HTTP client for the Python NLP micro-service (spaCy + RapidFuzz + scikit-learn). */
export class NlpClient {
  private readonly http = axios.create({
    baseURL: env.NLP_SERVICE_URL,
    timeout: env.NLP_TIMEOUT_MS,
    validateStatus: () => true,
  });

  private async request<T>(method: 'get' | 'post', url: string, body?: unknown): Promise<T> {
    try {
      const res = await this.http.request<T>({ method, url, data: body });
      if (res.status >= 400) {
        const message = (res.data as { error?: string; detail?: string })?.detail ??
          (res.data as { error?: string })?.error ??
          `NLP service answered ${res.status}`;
        throw serviceUnavailable(message, res.data);
      }
      return res.data;
    } catch (err) {
      if (err instanceof AppError) throw err;
      const ax = err as AxiosError;
      if (!ax.response) {
        throw serviceUnavailable(
          `The NLP service is not reachable at ${env.NLP_SERVICE_URL}. Start it with "npm run nlp" inside backend/nlp-service.`,
        );
      }
      throw err;
    }
  }

  /**
   * `ownPatient` is the ontology local name of the signed in patient, read from the
   * access token by the route: it lets a patient say "my tests" without naming
   * themselves, and it is never taken from the question text.
   */
  ask(payload: {
    question: string;
    locale?: string;
    limit?: number;
    ownPatient?: string;
    history?: string[];
  }): Promise<NlpParse> {
    return this.request<RawParse>('post', '/ask', {
      question: payload.question,
      locale: payload.locale,
      limit: payload.limit,
      own_patient: payload.ownPatient,
      history: payload.history,
    }).then(toParse);
  }

  parse(payload: { question: string; locale?: string }): Promise<NlpParse> {
    return this.request<RawParse>('post', '/parse', {
      question: payload.question,
      locale: payload.locale,
    }).then(toParse);
  }

  translate(payload: { question: string; language?: string }): Promise<NlpParse> {
    return this.request<RawParse>('post', '/translate', payload).then(toParse);
  }

  health(): Promise<NlpHealth> {
    return this.request<NlpHealth>('get', '/health');
  }

  evaluation(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('get', '/evaluation');
  }

  vocabulary(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('get', '/vocabulary');
  }

  intents(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('get', '/intents');
  }

  /** Rebuilds the ontology vocabulary and refits the classifier in the service. */
  reload(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('post', '/reload', {});
  }

  async ping(): Promise<{ ok: boolean; detail?: string }> {
    try {
      const health = await this.health();
      return { ok: health.ok };
    } catch (err) {
      logger.debug({ err }, 'nlp ping failed');
      return { ok: false, detail: (err as Error).message };
    }
  }
}

export const nlpClient = new NlpClient();
