import { APP_INITIALIZER, ApplicationConfig, Injectable, provideZoneChangeDetection } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { Title } from '@angular/platform-browser';
import {
  RouterStateSnapshot,
  TitleStrategy,
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
} from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { routes } from './app.routes';
import { authInterceptor } from './core/auth/auth.interceptor';
import { errorInterceptor } from './core/api/error.interceptor';
import { LangService, provideI18n } from './core/i18n/i18n';

/** Titles come from the route's `data.title`, a translation key resolved on navigation. */
@Injectable()
class TranslatedTitleStrategy extends TitleStrategy {
  constructor(
    private readonly translate: TranslateService,
    private readonly title: Title,
  ) {
    super();
  }

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const key = super.buildTitle(snapshot) ?? '';
    const translated = this.translate.instant(key);
    const label = translated && translated !== key ? translated : key;
    const app = this.translate.instant('common.appName');
    this.title.setTitle(`${label} · ${app}`);
  }
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'top', anchorScrolling: 'enabled' }),
    ),
    { provide: TitleStrategy, useClass: TranslatedTitleStrategy },
    provideHttpClient(withInterceptors([authInterceptor, errorInterceptor])),
    {
      provide: APP_INITIALIZER,
      useFactory: (langs: LangService) => () => langs.initialize(),
      deps: [LangService],
      multi: true,
    },
    provideI18n(),
  ],
};
