import { HttpClient } from '@angular/common/http';
import { EnvironmentProviders, Injectable, inject } from '@angular/core';
import { MissingTranslationHandler, type MissingTranslationHandlerParams, TranslateLoader, TranslateService, provideTranslateService } from '@ngx-translate/core';
import { firstValueFrom, Observable, of } from 'rxjs';
import { catchError, shareReplay } from 'rxjs/operators';

export const SUPPORTED_LANGS = ['en', 'fr'] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];

const STORAGE_KEY = 'medicare.lang';

/**
 * Translations are plain JSON files served from `public/i18n`, so a translator
 * can edit them without rebuilding the application.
 */
@Injectable({ providedIn: 'root' })
export class LangService {
  private readonly http = inject(HttpClient);
  private readonly translate = inject(TranslateService);

  readonly current: Lang;

  constructor() {
    this.current = readLang();
    this.translate.addLangs([...SUPPORTED_LANGS]);
    this.translate.setDefaultLang('en');
  }

  initialize(): Promise<void> {
    document.documentElement.lang = this.current;
    return firstValueFrom(this.translate.use(this.current).pipe(catchError(() => of(null)))).then(() => undefined);
  }
  get(): Lang {
    return this.translate.currentLang === 'fr' ? 'fr' : 'en';
  }

  set(lang: Lang): void {
    this.apply(lang);
  }

  toggle(): void {
    this.set(this.get() === 'en' ? 'fr' : 'en');
  }

  private apply(lang: Lang): void {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* storage disabled */
    }
    document.documentElement.lang = lang;
    this.translate.use(lang).subscribe();
  }
}

@Injectable()
export class SafeMissingTranslationHandler extends MissingTranslationHandler {
  override handle({ translateService }: MissingTranslationHandlerParams): string {
    return translateService.currentLang === 'fr' ? 'Libellé indisponible' : 'Label unavailable';
  }
}

export function provideI18n(): EnvironmentProviders {
  return provideTranslateService({
    loader: { provide: TranslateLoader, useClass: I18nLoader },
    missingTranslationHandler: { provide: MissingTranslationHandler, useClass: SafeMissingTranslationHandler },
  });
}

@Injectable()
export class I18nLoader implements TranslateLoader {
  private readonly http = inject(HttpClient);

  getTranslation(lang: Lang): Observable<Record<string, unknown>> {
    return this.http.get<Record<string, unknown>>(`i18n/${lang}.json`).pipe(shareReplay(1));
  }
}

/** Picks the stored choice, then the account locale, then the browser language. */
export function resolveInitialLang(accountLocale?: string): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'fr') return stored;
  } catch {
    /* fall through to the account locale */
  }
  if (accountLocale === 'fr' || accountLocale === 'en') return accountLocale;
  return (navigator.language ?? 'en').toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

function readLang(): Lang {
  return resolveInitialLang();
}
