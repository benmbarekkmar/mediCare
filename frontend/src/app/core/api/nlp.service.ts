import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import type { AskResult, NlpIntentMeta } from './models';

export interface NlpEvaluation {
  total: number;
  correct: number;
  accuracy: number;
  perIntent: { intent: string; total: number; correct: number; accuracy: number }[];
  cases?: { question: string; expected: string; predicted: string; ok: boolean }[];
}

/** The natural language question -> SPARQL pipeline, always through the back-end. */
@Injectable({ providedIn: 'root' })
export class NlpService {
  private readonly api = inject(ApiService);

  ask(question: string, locale?: string, limit?: number, history: string[] = []): Observable<AskResult> {
    return this.api.post<AskResult>('/nlp/ask', { question, locale, limit, history });
  }

  /** The generated SPARQL without touching the store. */
  preview(question: string, locale?: string): Observable<AskResult> {
    return this.api.post<AskResult>('/nlp/preview', { question, locale });
  }

  intents(): Observable<{ intents: NlpIntentMeta[] }> {
    return this.api.get('/nlp/intents');
  }

  health(): Observable<{ ok: boolean; vocabSize: number; intents: string[] }> {
    return this.api.get('/nlp/health');
  }

  /** Rebuilds the vocabulary and refits the classifier after an ontology change. */
  reload(): Observable<{ vocabSize: number; examples: number }> {
    return this.api.post('/nlp/reload');
  }

  evaluation(): Observable<NlpEvaluation> {
    return this.api.get('/nlp/evaluation');
  }
}
