import type { AxiosInstance} from 'axios';
import axios, { isAxiosError } from 'axios';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { AppError } from '../core/errors';
import { prefixes } from './prefixes';

export type ResultKind = 'uri' | 'literal' | 'bnode';

export interface ResultValue {
  type: ResultKind;
  value: string;
  datatype?: string;
  lang?: string;
}

export interface SelectResult {
  vars: string[];
  rows: Record<string, ResultValue>[];
  count: number;
  executionMs: number;
}

/** Shape of a SPARQL JSON SELECT/ASK response. */
export interface SparqlJsonResponse {
  head?: { vars?: string[] };
  results?: { bindings?: Record<string, ResultValue>[] };
  /** Fuseki spells the ASK answer `boolean`. */
  boolean?: boolean;
}

export interface UpdateStats {
  executionMs: number;
  operation: string;
}

const OPERATION_RE = /^\s*(INSERT|DELETE|CLEAR|DROP|LOAD|ADD|MOVE|COPY|WITH|USING|LOAD)/i;

/** Thin, typed wrapper over the Fuseki HTTP protocol with timeouts and error mapping. */
export class SparqlClient {
  private readonly http: AxiosInstance;

  constructor(baseUrl?: string) {
    this.http = axios.create({
      baseURL: baseUrl ?? env.FUSEKI_BASE_URL,
      auth: env.FUSEKI_USER ? { username: env.FUSEKI_USER, password: env.FUSEKI_PASSWORD } : undefined,
      timeout: env.FUSEKI_QUERY_TIMEOUT_MS,
      validateStatus: () => true,
    });
  }

  get datasetPath(): string {
    return `/${env.FUSEKI_DATASET.replace(/^\/|\/$/g, '')}`;
  }

  private get queryUrl(): string {
    return `${this.datasetPath}${env.FUSEKI_QUERY_PATH}`;
  }

  private get updateUrl(): string {
    return `${this.datasetPath}${env.FUSEKI_UPDATE_PATH}`;
  }

  /** Adds the project prefixes unless the caller already declared them. */
  prepare(query: string): string {
    const missing = prefixes.missingIn(query);
    return missing ? `${missing}\n${query}` : query;
  }

  async select(query: string, timeoutMs?: number): Promise<SelectResult> {
    const started = Date.now();
    const body = await this.post(this.queryUrl, { query }, timeoutMs, 'application/sparql-results+json');
    const vars: string[] = body?.head?.vars ?? [];
    const rows: Record<string, ResultValue>[] = body?.results?.bindings ?? [];
    const executionMs = Date.now() - started;
    logger.debug({ executionMs, rows: rows.length, query: this.inline(query) }, 'SPARQL SELECT');
    return { vars, rows, count: rows.length, executionMs };
  }

  async ask(query: string, timeoutMs?: number): Promise<boolean> {
    const body = await this.post(this.queryUrl, { query }, timeoutMs, 'application/sparql-results+json');
    return body?.boolean === true;
  }

  /** CONSTRUCT/DESCRIBE: returns the resulting triples in N-Triples form plus a parsed view. */
  async construct(query: string, timeoutMs?: number): Promise<{ ntriples: string; executionMs: number }> {
    const started = Date.now();
    const text = await this.postText(this.queryUrl, { query }, timeoutMs, 'application/n-triples');
    return { ntriples: text, executionMs: Date.now() - started };
  }

  /** Executes one atomic SPARQL Update request. */
  async update(update: string, timeoutMs?: number): Promise<UpdateStats> {
    const started = Date.now();
    const operation = OPERATION_RE.exec(update)?.[0]?.trim().toUpperCase() ?? 'UPDATE';
    logger.debug({ operation, update }, 'SPARQL UPDATE request');
    await this.postText(this.updateUrl, { update }, timeoutMs, '*/*', 'POST');
    const executionMs = Date.now() - started;
    logger.info({ executionMs, operation }, 'SPARQL UPDATE committed');
    return { executionMs, operation };
  }

  /** Graph Store Protocol: replaces the content of the default graph with Turtle data. */
  async uploadTurtle(turtle: string, { append = false }: { append?: boolean } = {}): Promise<void> {
    const url = `${this.datasetPath}/data?default`;
    const method = append ? 'post' : 'put';
    const res = await this.http.request<string>({
      method,
      url,
      data: turtle,
      responseType: 'text',
      headers: { 'content-type': 'text/turtle' },
      timeout: 120000,
    });
    this.throwIfBad(res.status, res.data, `GSP ${method.toUpperCase()} ${url}`);
  }

  async countTriples(): Promise<number> {
    const { rows } = await this.select('SELECT (COUNT(*) AS ?c) WHERE { ?s ?p ?o }');
    return Number(rows[0]?.['c']?.value ?? 0);
  }

  async ping(): Promise<{ ok: boolean; triples: number; error?: string }> {
    try {
      const triples = await this.countTriples();
      return { ok: true, triples };
    } catch (err) {
      return { ok: false, triples: 0, error: (err as Error).message };
    }
  }

  private async post(
    url: string,
    params: Record<string, string>,
    timeoutMs: number | undefined,
    accept: string,
  ): Promise<SparqlJsonResponse> {
    const text = await this.postText(url, params, timeoutMs, accept, 'POST');
    try {
      return JSON.parse(text) as SparqlJsonResponse;
    } catch {
      throw new AppError(502, 'SPARQL_ERROR', 'Fuseki returned a malformed JSON response', text.slice(0, 500));
    }
  }

  private async postText(
    url: string,
    params: Record<string, string>,
    timeoutMs: number | undefined,
    accept: string,
    method: 'POST' | 'GET' = 'POST',
  ): Promise<string> {
    const form = new URLSearchParams(params).toString();
    try {
      const res = await this.http.request<string>({
        method,
        url,
        data: form,
        responseType: 'text',
        headers: {
          'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
          accept,
        },
        timeout: timeoutMs ?? env.FUSEKI_QUERY_TIMEOUT_MS,
      });
      this.throwIfBad(res.status, res.data, url);
      return res.data ?? '';
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (isAxiosError(err) && (err.code === 'ECONNABORTED' || /timeout/i.test(err.message))) {
        throw new AppError(504, 'SPARQL_ERROR', `Fuseki timed out after ${timeoutMs ?? env.FUSEKI_QUERY_TIMEOUT_MS} ms`);
      }
      if (isAxiosError(err) && !err.response) {
        throw new AppError(
          502,
          'SPARQL_ERROR',
          `Cannot reach the Fuseki triple store at ${env.FUSEKI_BASE_URL}. Is "docker compose up -d" running?`,
        );
      }
      throw err;
    }
  }

  private throwIfBad(status: number, data: unknown, context: string): void {
    if (status >= 200 && status < 300) return;
    const message = typeof data === 'string' ? data.trim() : JSON.stringify(data);
    throw new AppError(
      status === 400 || status === 405 ? 400 : 502,
      'SPARQL_ERROR',
      `Fuseki rejected the request (${context}): ${this.inline(String(message)).slice(0, 600)}`,
    );
  }

  private inline(query: string): string {
    return query.replace(/\s+/g, ' ').trim();
  }
}

export const sparql = new SparqlClient();
