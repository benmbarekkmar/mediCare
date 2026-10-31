import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';
import { AccountService } from '../../core/api/account.service';
import { EntitiesService } from '../../core/api/entity.service';
import { ToastService } from '../../core/toast/toast.service';
import type { PermissionMatrix, PublicUser } from '../../core/api/models';
import { TRANSLATE_TEST_IMPORTS } from '../../shared/ui/translate-testing';
import { UsersComponent } from './users.component';

const ADMIN_ACCOUNT: PublicUser = {
  id: 1,
  email: 'admin@medicare.tn',
  fullName: 'Admin MedicCare',
  role: 'ADMIN',
  linkedId: null,
  locale: 'fr',
  active: true,
  createdAt: '2026-10-27T18:13:40.699Z',
  lastLoginAt: null,
};

const MATRIX: PermissionMatrix = {
  role: 'ADMIN',
  permissions: {},
  matrix: { ADMIN: {}, DOCTOR: {}, RECEPTIONIST: {}, PATIENT: {} } as PermissionMatrix['matrix'],
  writableFields: {
    patients: 'all', doctors: 'all', diseases: 'all', symptoms: 'all', treatments: 'all',
    medications: 'all', tests: 'all', appointments: 'all', hospitals: 'all', departments: 'all',
  },
};

describe('UsersComponent', () => {
  let account: {
    list: jasmine.Spy;
    create: jasmine.Spy;
    update: jasmine.Spy;
    remove: jasmine.Spy;
    matrix: jasmine.Spy;
  };
  let toast: jasmine.SpyObj<ToastService>;

  beforeEach(() => {
    account = {
      list: jasmine.createSpy('list').and.returnValue(of({ items: [ADMIN_ACCOUNT] })),
      create: jasmine.createSpy('create'),
      update: jasmine.createSpy('update'),
      remove: jasmine.createSpy('remove').and.returnValue(of({ deleted: 1 })),
      matrix: jasmine.createSpy('matrix').and.returnValue(of(MATRIX)),
    };
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['show', 'success', 'error', 'warning', 'info']);
    TestBed.configureTestingModule({
      imports: [...TRANSLATE_TEST_IMPORTS, UsersComponent],
      providers: [
        provideRouter([]),
        { provide: AccountService, useValue: account },
        { provide: EntitiesService, useValue: { refs: () => of([]) } },
        { provide: ToastService, useValue: toast },
      ],
    });
    TestBed.inject(TranslateService).use('en');
  });

  function createComponent(): UsersComponent {
    const fixture = TestBed.createComponent(UsersComponent);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it('renders the loaded accounts in the table', () => {
    const fixture = TestBed.createComponent(UsersComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('admin@medicare.tn');
  });

  it('requires a linked individual for PATIENT and DOCTOR, not for other roles', () => {
    const component = createComponent();
    component.openCreate();
    const linked = component.form.get('linkedId');
    expect(component.linkedEntity()).toBe('patients');
    expect(linked?.hasError('required')).toBeTrue();
    expect(component.form.invalid).toBeTrue();

    component.form.get('role')?.setValue('DOCTOR');
    expect(component.linkedEntity()).toBe('doctors');
    expect(linked?.hasError('required')).toBeTrue();

    component.form.get('role')?.setValue('RECEPTIONIST');
    expect(component.linkedEntity()).toBeNull();
    expect(linked?.hasError('required')).toBeFalse();

    component.form.get('role')?.setValue('PATIENT');
    expect(linked?.hasError('required')).toBeTrue();
    linked?.setValue('Patient_Ahmed');
    expect(linked?.errors ?? null).toBeNull();
  });

  it('surfaces the API refusal when deleting your own account', () => {
    const component = createComponent();
    account.remove.and.returnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: { status: 400, code: 'BAD_REQUEST', message: 'You cannot delete your own account' },
          }),
      ),
    );
    component.askDelete(ADMIN_ACCOUNT);
    expect(component.deleteOpen()).toBeTrue();
    component.confirmDelete();
    expect(account.remove).toHaveBeenCalledWith(ADMIN_ACCOUNT.id);
    expect(toast.error).toHaveBeenCalledWith('You cannot delete your own account', 'You cannot delete your own account');
    expect(component.users().length).toBe(1);
  });

  it('sends no password when editing an account', () => {
    const component = createComponent();
    account.update.and.returnValue(of(ADMIN_ACCOUNT));
    component.openEdit(ADMIN_ACCOUNT);
    expect(component.form.get('password')?.disabled).toBeTrue();
    component.save();
    const patch = account.update.calls.mostRecent()?.args[1] as Record<string, unknown>;
    expect('password' in patch).toBeFalse();
    expect(toast.success).toHaveBeenCalled();
  });
});
