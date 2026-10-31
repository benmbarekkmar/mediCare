import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { UiBreadcrumbComponent } from '../shared/ui/breadcrumb/ui-breadcrumb.component';
import { UiToastHostComponent } from '../shared/ui/toast/ui-toast-host.component';
import { BreadcrumbsService } from './breadcrumbs.service';
import { SidebarComponent } from './sidebar.component';
import { TopbarComponent } from './topbar.component';

/**
 * The back-office frame: sidebar + top bar + breadcrumbs around the routed page.
 * The sidebar stays visible at every viewport and compacts to an icon rail on small screens.
 */
@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, TranslateModule, SidebarComponent, TopbarComponent, UiBreadcrumbComponent, UiToastHostComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell.component.html',
  styleUrls: ['./shell.component.scss'],
})
export class ShellComponent {
  private readonly crumbs = inject(BreadcrumbsService);
  private readonly translate = inject(TranslateService);

  readonly collapsed = signal(false);

  readonly trail = computed(() =>
    this.crumbs.trail().map((crumb, index, all) => ({
      label: crumb.label ?? this.translate.instant(crumb.labelKey ?? ''),
      href: index === all.length - 1 ? null : (crumb.href ?? null),
    })),
  );

  toggleSidebar(): void {
    this.collapsed.update((collapsed) => !collapsed);
  }
}
