import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TRANSLATE_TEST_IMPORTS } from '../translate-testing';
import { UiInputComponent } from './ui-input.component';

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'test-host',
  standalone: true,
  imports: [ReactiveFormsModule, UiInputComponent],
  template: `
    <form [formGroup]="form">
      <ui-input
        label="patients.field.email"
        formControlName="email"
        type="email"
        hint="Used to sign in"
        icon="mail"
        [required]="true"
      />
    </form>
  `,
})
class HostComponent {
  readonly form = new FormGroup({
    email: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email],
    }),
  });
}

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'test-password',
  standalone: true,
  imports: [ReactiveFormsModule, UiInputComponent],
  template: `<ui-input label="auth.password" type="password" suffix="units.chars" [formControl]="control" />`,
})
class PasswordHostComponent {
  readonly control = new FormControl<string>('hunter2', { nonNullable: true });
}

describe('UiInputComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let inputEl: HTMLInputElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [...TRANSLATE_TEST_IMPORTS, HostComponent, PasswordHostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();

    inputEl = (fixture.nativeElement as HTMLElement).querySelector('input') as HTMLInputElement;
  });

  const errors = (): string =>
    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.ui-error'))
      .map((node) => node.textContent?.trim() ?? '')
      .join(' | ');

  it('projects the control value into the native input', () => {
    host.form.controls['email'].setValue('ada@example.org');
    fixture.detectChanges();
    expect(inputEl.value).toBe('ada@example.org');
  });

  it('writes what the user types back to the control', () => {
    inputEl.value = 'ada@example.org';
    inputEl.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(host.form.controls['email'].value).toBe('ada@example.org');
    expect(host.form.controls['email'].dirty).toBeTrue();
  });

  it('marks itself touched on blur so the accessor chain stays honest', () => {
    expect(host.form.controls['email'].touched).toBeFalse();
    inputEl.dispatchEvent(new Event('blur'));
    expect(host.form.controls['email'].touched).toBeTrue();
  });

  it('associates the label and the hint for assistive technology', () => {
    const label = (fixture.nativeElement as HTMLElement).querySelector('label');
    expect(label?.getAttribute('for')).toBe(inputEl.id);
    expect(label?.textContent).toContain('patients.field.email');
    expect(inputEl.getAttribute('aria-required')).toBe('true');
    expect(inputEl.getAttribute('aria-describedby')).toContain(`${inputEl.id}-hint`);
    expect(inputEl.getAttribute('aria-invalid')).toBeNull();
  });

  it('draws the leading icon inside the shared control skin', () => {
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.shell--icon .shell__icon')).not.toBeNull();
    expect(root.querySelector('.ui-control-group input.ui-control')).not.toBeNull();
  });

  it('renders validation errors only once the field has been touched', () => {
    expect(errors()).toBe('');

    host.form.controls['email'].markAsTouched();
    fixture.detectChanges();
    expect(errors()).toContain('errors.field.required');
    expect(inputEl.getAttribute('aria-invalid')).toBe('true');
    expect(inputEl.getAttribute('aria-describedby')).toContain(`${inputEl.id}-errors`);
  });

  it('maps every failing validator onto its own catalogue key', () => {
    const control = host.form.controls['email'];
    control.setValidators([Validators.required, Validators.minLength(8), Validators.email]);
    control.setValue('no');
    control.markAsTouched();
    fixture.detectChanges();

    expect(errors()).toContain('errors.field.minlength');
    expect(errors()).toContain('errors.field.email');
  });

  it('lets the page override the message list', () => {
    const override = TestBed.createComponent(OverrideHostComponent);
    override.detectChanges();
    expect((override.nativeElement as HTMLElement).textContent).toContain('patients.email.taken');
  });

  it('disables the native input when the control is disabled', () => {
    host.form.controls['email'].disable();
    fixture.detectChanges();
    expect(inputEl.disabled).toBeTrue();
    expect(inputEl.getAttribute('disabled')).not.toBeNull();
  });

  it('reveals the password on demand and prints the unit addon', () => {
    const passwordFixture = TestBed.createComponent(PasswordHostComponent);
    passwordFixture.detectChanges();

    const field = passwordFixture.nativeElement.querySelector('input') as HTMLInputElement;
    expect(field.value).toBe('hunter2');
    expect(field.type).toBe('password');
    expect(passwordFixture.nativeElement.querySelector('.ui-control-addon')?.textContent).toContain('units.chars');

    const toggle = passwordFixture.nativeElement.querySelector('.shell__toggle') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-label')).toBe('ui.input.showPassword');
    toggle.click();
    passwordFixture.detectChanges();
    expect(field.type).toBe('text');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
  });
});

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'test-override',
  standalone: true,
  imports: [UiInputComponent],
  template: `<ui-input label="patients.field.email" [errors]="['patients.email.taken']" />`,
})
class OverrideHostComponent {}
