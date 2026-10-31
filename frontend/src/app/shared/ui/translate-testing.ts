import { ModuleWithProviders } from '@angular/core';
import { TranslateLoader, TranslateModule } from '@ngx-translate/core';
import { Observable, of } from 'rxjs';

/** Serves an empty catalogue so a spec asserts on stable keys, not on copy. */
class SpecTranslateLoader implements TranslateLoader {
  getTranslation(): Observable<Record<string, string>> {
    return of({});
  }
}

/**
 * `imports: [...TRANSLATE_TEST_IMPORTS, UiTableComponent]` in every component
 * spec: the translate pipe resolves without an HTTP round trip, and an unknown
 * key renders the key itself, which is what the assertions expect.
 */
export const TRANSLATE_TEST_IMPORTS: ModuleWithProviders<TranslateModule>[] = [
  TranslateModule.forRoot({ loader: { provide: TranslateLoader, useClass: SpecTranslateLoader } }),
];
