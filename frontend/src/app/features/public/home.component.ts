import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { OntologyService } from '../../core/api/ontology.service';
import type { OntologyStats } from '../../core/api/models';
import { compact } from '../../core/util/format';
import { UiButtonComponent } from '../../shared/ui/button/ui-button.component';
import { UiCardComponent } from '../../shared/ui/card/ui-card.component';
import { UiIconComponent } from '../../shared/ui/icon/ui-icon.component';
import { UiStatCardComponent } from '../../shared/ui/stat-card/ui-stat-card.component';
import type { IconName } from '../../shared/ui/icon/icons';
interface Entry {
  href: string;
  icon: IconName;
  titleKey: string;
  textKey: string;
}

/**
 * The anonymous landing page: what the platform is, what the ontology holds and
 * the four public tools, none of which need an account or expose patient data.
 */
@Component({
  selector: 'page-home',
  standalone: true,
  imports: [RouterLink, TranslateModule, UiCardComponent, UiButtonComponent, UiIconComponent, UiStatCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss'],
})
export class HomeComponent {
  private readonly ontology = inject(OntologyService);

  protected readonly stats = signal<OntologyStats | null>(null);
  protected readonly entries: Entry[] = [
    { href: '/library', icon: 'book', titleKey: 'home.entry.library', textKey: 'home.entry.libraryText' },
    { href: '/find-a-doctor', icon: 'stethoscope', titleKey: 'home.entry.doctors', textKey: 'home.entry.doctorsText' },
    { href: '/hospitals', icon: 'hospital', titleKey: 'home.entry.hospitals', textKey: 'home.entry.hospitalsText' },
    { href: '/assistant', icon: 'bot', titleKey: 'home.entry.ask', textKey: 'home.entry.askText' },
  ];

  constructor() {
    this.ontology.stats().subscribe({ next: (stats) => this.stats.set(stats), error: () => this.stats.set(null) });
  }

  protected count(key: keyof OntologyStats): string {
    const value = this.stats()?.[key];
    return typeof value === 'number' ? compact(value) : '—';
  }

  protected entity(key: 'patients' | 'doctors' | 'diseases' | 'hospitals'): string {
    const value = this.stats()?.individualsByEntity?.[key];
    return typeof value === 'number' ? compact(value) : '—';
  }
}
