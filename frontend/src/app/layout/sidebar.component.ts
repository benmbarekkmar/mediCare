import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { AuthService } from '../core/auth/auth.service';
import { UiIconComponent } from '../shared/ui/icon/ui-icon.component';
import { BACK_OFFICE_NAV, PORTAL_NAV, type NavGroup, type NavItem } from './nav.config';

/**
 * One sidebar for both layouts: the back-office feeds it the role's navigation
 * groups, the patient portal the flat portal list. Entries the permission matrix
 * would reject are never rendered, so the menu and the API agree by construction.
 */
@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, TranslateModule, UiIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sidebar.component.html',
  styleUrls: ['./sidebar.component.scss'],
})
export class SidebarComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly portal = input(false);
  readonly collapsed = input(false);

  readonly groups = computed<NavGroup[]>(() =>
    this.portal() ? [{ labelKey: 'nav.groups.mySpace', items: PORTAL_NAV }] : (BACK_OFFICE_NAV[this.auth.role() ?? 'ADMIN'] ?? []),
  );

  readonly visibleGroups = computed(() =>
    this.groups()
      .map((group) => ({ ...group, items: group.items.filter((item) => this.allowed(item)) }))
      .filter((group) => group.items.length > 0),
  );

  trackItem(_index: number, item: NavItem): string {
    return item.path;
  }

  isActive(path: string): boolean {
    return this.router.isActive(path, {
      paths: 'subset',
      fragment: 'ignored',
      matrixParams: 'ignored',
      queryParams: 'ignored',
    });
  }

  signOut(): void {
    this.auth.logout().subscribe(() => void this.router.navigateByUrl('/login'));
  }

  private allowed(item: NavItem): boolean {
    if (item.roles && !this.auth.hasRole(...item.roles)) return false;
    return item.permission ? this.auth.can(item.permission.entity, item.permission.action) : true;
  }
}
