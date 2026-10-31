import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { AuthService } from '../core/auth/auth.service';
import { ThemeService } from '../core/theme/theme.service';
import { LangService } from '../core/i18n/i18n';
import { UiIconComponent } from '../shared/ui/icon/ui-icon.component';
import { UiToastHostComponent } from '../shared/ui/toast/ui-toast-host.component';
import { NotificationsService } from './notifications.service';
import { SidebarComponent } from './sidebar.component';

/**
 * The patient frame: a calmer top bar with the portal menu, kept separate from
 * the back-office shell so a patient never sees an admin affordance.
 */
@Component({
  selector: 'app-portal-shell',
  standalone: true,
  imports: [RouterOutlet, TranslateModule, SidebarComponent, UiIconComponent, UiToastHostComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './portal-shell.component.html',
  styleUrls: ['./portal-shell.component.scss'],
})
export class PortalShellComponent {
  private readonly auth = inject(AuthService);
  private readonly theme = inject(ThemeService);
  private readonly langs = inject(LangService);

  readonly notifications = inject(NotificationsService);

  readonly sidebarCollapsed = signal(false);
  readonly user = computed(() => this.auth.user());
  readonly themeIcon = computed(() => (this.theme.resolved() === 'dark' ? 'sun' : 'moon'));
  readonly langLabel = computed(() => (this.langs.get() === 'en' ? 'FR' : 'EN'));

  toggleSidebar(): void {
    this.sidebarCollapsed.update((collapsed) => !collapsed);
  }

  toggleTheme(): void {
    this.theme.toggle();
  }

  switchLanguage(): void {
    this.langs.toggle();
  }

}
