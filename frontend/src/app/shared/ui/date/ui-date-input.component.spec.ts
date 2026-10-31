import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { TRANSLATE_TEST_IMPORTS } from '../translate-testing';
import { UiDateInputComponent } from './ui-date-input.component';
import { UiDatetimeInputComponent } from './ui-datetime-input.component';

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'test-host',
  standalone: true,
  imports: [ReactiveFormsModule, UiDateInputComponent, UiDatetimeInputComponent],
  template: `
    <ui-date-input
      label="patients.field.birthDate"
      hint="Date of birth"
      [min]="dateMin"
      [max]="dateMax"
      [required]="true"
      [formControl]="birthDate"
    />
    <ui-datetime-input
      label="appointments.field.startsAt"
      [min]="dateTimeMin"
      [formControl]="startsAt"
    />
  `,
})
class HostComponent {
  readonly dateMin = '2020-01-01';
  readonly dateMax = '2026-12-31';
  readonly dateTimeMin = '2026-01-01T08:00';

  readonly birthDate = new FormControl<string | null>(null, [Validators.required]);
  readonly startsAt = new FormControl<string | null>(null);
}

describe('date inputs', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let dateEl: HTMLInputElement;
  let dateTimeEl: HTMLInputElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [...TRANSLATE_TEST_IMPORTS, HostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();

    const inputs = (fixture.nativeElement as HTMLElement).querySelectorAll('input');
    dateEl = inputs[0] as HTMLInputElement;
    dateTimeEl = inputs[1] as HTMLInputElement;
  });

  const errorText = (): string =>
    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.ui-error'))
      .map((node) => node.textContent?.trim() ?? '')
      .join(' | ');

  it('renders native date and datetime-local fields with the shared skin', () => {
    expect(dateEl.type).toBe('date');
    expect(dateTimeEl.type).toBe('datetime-local');
    expect(dateEl.classList.contains('ui-control')).toBeTrue();
    expect(dateEl.getAttribute('min')).toBe('2020-01-01');
    expect(dateTimeEl.getAttribute('min')).toBe('2026-01-01T08:00');
    expect(dateEl.getAttribute('aria-describedby')).toContain(`${dateEl.id}-hint`);
    expect(dateEl.getAttribute('aria-required')).toBe('true');
  });

  it('normalises the API strings on writeValue', () => {
    host.birthDate.setValue('1985-11-05T00:00:00Z');
    host.startsAt.setValue('2026-03-04T14:30:00');
    fixture.detectChanges();
    expect(dateEl.value).toBe('1985-11-05');
    expect(dateTimeEl.value).toBe('2026-03-04T14:30');
  });

  it('keeps the raw XSD string as the form value', () => {
    dateEl.value = '2026-05-20';
    dateEl.dispatchEvent(new Event('input'));
    dateTimeEl.value = '2026-05-20T09:15';
    dateTimeEl.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(host.birthDate.value).toBe('2026-05-20');
    expect(host.startsAt.value).toBe('2026-05-20T09:15');
    expect(host.birthDate.dirty).toBeTrue();
  });

  it('clears the control when the field is emptied', () => {
    host.birthDate.setValue('2026-05-20');
    fixture.detectChanges();
    dateEl.value = '';
    dateEl.dispatchEvent(new Event('input'));
    expect(host.birthDate.value).toBeNull();
  });

  it('prints the required error only after the field was touched', () => {
    expect(errorText()).toBe('');
    host.birthDate.markAsTouched();
    fixture.detectChanges();
    expect(errorText()).toContain('errors.field.required');
    expect(dateEl.getAttribute('aria-invalid')).toBe('true');
  });

  it('rejects a value outside the allowed window', () => {
    dateEl.value = '2027-02-01';
    dateEl.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(errorText()).toContain('ui.date.before');

    dateEl.value = '2019-02-01';
    dateEl.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(errorText()).toContain('ui.date.after');
  });

  it('disables both fields together with their controls', () => {
    host.birthDate.disable();
    host.startsAt.disable();
    fixture.detectChanges();
    expect(dateEl.disabled).toBeTrue();
    expect(dateTimeEl.disabled).toBeTrue();

    host.birthDate.enable();
    fixture.detectChanges();
    expect(dateEl.disabled).toBeFalse();
  });
});
