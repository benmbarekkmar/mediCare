import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TRANSLATE_TEST_IMPORTS } from '../translate-testing';
import { UiButtonComponent } from './ui-button.component';

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'test-host',
  standalone: true,
  imports: [UiButtonComponent],
  template: `
    <ui-button
      [variant]="variant"
      [size]="size"
      [icon]="icon"
      [iconRight]="iconRight"
      [loading]="loading"
      [disabled]="disabled"
      [href]="href"
      [fullWidth]="fullWidth"
      (click)="clicks = clicks + 1"
      >patients.actions.create</ui-button
    >
  `,
})
class HostComponent {
  variant: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' = 'primary';
  size: 'sm' | 'md' | 'lg' = 'md';
  icon: 'plus' | null = null;
  iconRight: 'chevron-right' | null = null;
  loading = false;
  disabled = false;
  href: string | null = null;
  fullWidth = false;
  clicks = 0;
}

describe('UiButtonComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [...TRANSLATE_TEST_IMPORTS, HostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  const button = (): HTMLButtonElement | null =>
    (fixture.nativeElement as HTMLElement).querySelector('button');
  const anchor = (): HTMLAnchorElement | null => (fixture.nativeElement as HTMLElement).querySelector('a');

  it('renders a native button and projects the label', () => {
    const element = button();
    expect(element).not.toBeNull();
    expect(element?.getAttribute('type')).toBe('button');
    expect(element?.textContent).toContain('patients.actions.create');
    expect(element?.classList.contains('ui-button--primary')).toBeTrue();
    expect(element?.classList.contains('ui-button--md')).toBeTrue();
  });

  it('forwards the click while enabled', () => {
    button()?.click();
    expect(host.clicks).toBe(1);
  });

  it('is really disabled, so no click escapes', () => {
    host.disabled = true;
    fixture.detectChanges();
    const element = button();
    expect(element?.disabled).toBeTrue();
    element?.click();
    expect(host.clicks).toBe(0);
  });

  it('swaps the leading icon for a spinner and marks itself busy', () => {
    host.icon = 'plus';
    fixture.detectChanges();
    expect(button()?.querySelector('ui-icon')).not.toBeNull();

    host.loading = true;
    fixture.detectChanges();
    const element = button();
    expect(element?.disabled).toBeTrue();
    expect(element?.getAttribute('aria-busy')).toBe('true');
    expect(element?.querySelector('.ui-button__spinner')).not.toBeNull();
    expect(element?.getAttribute('aria-busy')).toBe('true');
  });

  it('renders an anchor styled as a button when href is set', () => {
    host.href = 'https://example.org';
    host.variant = 'outline';
    fixture.detectChanges();
    const link = anchor();
    expect(link).not.toBeNull();
    expect(link?.getAttribute('role')).toBe('button');
    expect(link?.getAttribute('href')).toBe('https://example.org');
    expect(button()).toBeNull();

    host.disabled = true;
    fixture.detectChanges();
    expect(anchor()?.getAttribute('aria-disabled')).toBe('true');
    expect(anchor()?.getAttribute('tabindex')).toBe('-1');
  });

  it('spreads full width and honours the size scale', () => {
    host.size = 'sm';
    host.fullWidth = true;
    fixture.detectChanges();
    const element = button();
    expect(element?.classList.contains('ui-button--sm')).toBeTrue();
    expect(element?.classList.contains('ui-button--full')).toBeTrue();
    expect((fixture.nativeElement as HTMLElement).querySelector('ui-button')?.classList.contains('ui-button--full-width')).toBeTrue();
  });
});
