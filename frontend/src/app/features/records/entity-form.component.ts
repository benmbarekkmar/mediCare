import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, ValidatorFn, Validators } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Observable } from 'rxjs';
import { EntitiesService } from '../../core/api/entity.service';
import type { DataFieldMeta, EntityInput, EntityMeta, Individual, Ref, RelationMeta } from '../../core/api/models';
import { toDateInput, toDateTimeInput } from '../../core/util/format';
import { labelOf } from '../../core/util/labels';
import { UiCheckboxComponent } from '../../shared/ui/checkbox/ui-checkbox.component';
import { UiComboboxComponent } from '../../shared/ui/combobox/ui-combobox.component';
import { UiDateInputComponent } from '../../shared/ui/date/ui-date-input.component';
import { UiDatetimeInputComponent } from '../../shared/ui/date/ui-datetime-input.component';
import { UiInputComponent } from '../../shared/ui/input/ui-input.component';
import { UiSelectComponent, type SelectOption } from '../../shared/ui/select/ui-select.component';
import { UiTextareaComponent } from '../../shared/ui/textarea/ui-textarea.component';
import { UiIconComponent } from '../../shared/ui/icon/ui-icon.component';
import { UiButtonComponent } from '../../shared/ui/button/ui-button.component';

/** Fields the form can never show: derived or internal. */
const HIDDEN_FIELDS = new Set<string>();

/**
 * The create/update form for any of the ten entities, built entirely from
 * `EntityMeta`. Adding an entity to the ontology adds a screen here without a
 * line of component code changing, which is the point of the metadata mirror.
 */
@Component({
  selector: 'entity-form',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    TranslateModule,
    UiInputComponent,
    UiSelectComponent,
    UiTextareaComponent,
    UiCheckboxComponent,
    UiComboboxComponent,
    UiDateInputComponent,
    UiDatetimeInputComponent,
    UiIconComponent,
    UiButtonComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './entity-form.component.html',
  styleUrls: ['./entity-form.component.scss'],
})
export class EntityFormComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly entities = inject(EntitiesService);
  private readonly translate = inject(TranslateService);

  readonly meta = input.required<EntityMeta>();
  readonly value = input<Individual | null>(null);
  readonly showCancel = input(true);
  readonly busy = input(false);
  /** Field names the permission matrix marks writable; null means everything. */
  readonly writable = input<string[] | null>(null);

  readonly submitted = output<EntityInput>();
  readonly cancelled = output<void>();

  readonly form = inject(FormBuilder).group({});
  readonly relationIds = signal<Record<string, Ref[]>>({});

  ngOnInit(): void {
    // Create controls before the first render binds formControlName directives.
    this.build();
  }

  get controls(): readonly DataFieldMeta[] {
    return this.meta().data.filter((field) => !HIDDEN_FIELDS.has(field.field));
  }

  get relations(): readonly RelationMeta[] {
    return this.meta().relations.filter((relation) => !relation.readOnly && !relation.virtual);
  }

  get typeFacet(): EntityMeta['typeFacet'] {
    return this.meta().typeFacet ?? null;
  }

  editable(field: string): boolean {
    const list = this.writable();
    if (list === null) return true;
    return list.includes(field);
  }

  optionsFor(field: DataFieldMeta): SelectOption[] {
    return (field.values ?? []).map((value) => ({ value, label: this.labelOfValue(value) }));
  }

  fieldLabel(field: string): string {
    return labelOf(this.translate, `entities.fields.${field}`, field);
  }

  typeFacetLabel(): string {
    return this.translate.instant('form.section.type');
  }

  searchPlaceholder(target: string): string {
    return this.translate.instant('form.searchEntity', { entity: labelOf(this.translate, `entities.keys.${target}`, target) });
  }

  labelOfValue(value: string): string {
    return labelOf(this.translate, `entities.values.${value}`, value);
  }

  facetOptions(values: readonly string[]): SelectOption[] {
    return values.map((value) => ({ value, label: this.labelOfValue(value) }));
  }

  searchRefs(target: string): (term: string) => Observable<Ref[]> {
    return (term: string) => this.entities.refs(target as never, term, 20);
  }

  initialRefs(relation: RelationMeta): Ref[] {
    return this.relationIds()[relation.field] ?? [];
  }

  errorsFor(field: string): string[] {
    const control = this.form.get(field);
    if (!control || control.valid || control.pristine) return [];
    const out: string[] = [];
    if (control.hasError('required')) out.push(this.translate.instant('errors.field.required'));
    if (control.hasError('min')) out.push(this.translate.instant('errors.field.min', { min: control.getError('min')['min'] }));
    if (control.hasError('max')) out.push(this.translate.instant('errors.field.max', { max: control.getError('max')['max'] }));
    if (control.hasError('maxlength'))
      out.push(this.translate.instant('errors.field.maxlength', { required: control.getError('maxlength')['requiredLength'] }));
    if (control.hasError('pattern')) out.push(this.translate.instant('errors.field.pattern'));
    if (control.hasError('email')) out.push(this.translate.instant('errors.field.email'));
    if (control.hasError('date')) out.push(this.translate.instant('errors.field.date'));
    return out;
  }

  get canSubmit(): boolean {
    return this.form.valid && !this.busy();
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const meta = this.meta();
    const raw = this.form.getRawValue() as Record<string, unknown>;
    const body: EntityInput = { relations: {}, label: '' };
    for (const [key, value] of Object.entries(raw)) {
      if (key.startsWith('rel:')) continue;
      if (value === '' || value === null || value === undefined) continue;
      body[key] = value as string | number | boolean | string[];
    }
    // the label is the human name the store indexes and the tables show
    const nameValue = body[meta.nameField];
    body['label'] = typeof nameValue === 'string' ? nameValue : String(nameValue ?? '');
    for (const relation of this.relations) {
      const control = this.form.get(`rel:${relation.field}`);
      const selected = control ? (control.value as unknown as string | string[] | Ref | Ref[] | null) : null;
      const ids = Array.isArray(selected)
        ? selected.map((ref) => (typeof ref === 'string' ? ref : ref.id))
        : typeof selected === 'string'
          ? [selected]
          : selected
            ? [selected.id]
            : [];
      (body['relations'] as Record<string, string[]>)[relation.field] = ids;
    }
    const facet = this.typeFacet;
    if (facet) {
      const type = raw[facet.field] as string | undefined;
      if (type) body['types'] = [type];
    }
    this.submitted.emit(body);
  }

  cancel(): void {
    this.cancelled.emit();
  }

  private build(): void {
    const current = this.value();
    const fields = current?.fields ?? {};
    const relations = current?.relations ?? {};
    for (const field of this.controls) {
      if (!this.editable(field.field)) continue;
      const existing = fields[field.field];
      const control = this.fb.control(
        { value: this.initialDataValue(field, existing), disabled: false },
        this.validatorsFor(field),
      );
      this.form.addControl(field.field, control);
    }
    const initial: Record<string, Ref[]> = {};
    for (const relation of this.relations) {
      if (!this.editable(relation.field)) continue;
      const raw = relations[relation.field];
      const refs = (Array.isArray(raw) ? raw : raw ? [raw] : []).map((ref) => ref as unknown as Ref);
      initial[relation.field] = refs;
      const value = relation.cardinality === 'one' ? (refs[0]?.id ?? null) : refs.map((ref) => ref.id);
      this.form.addControl(`rel:${relation.field}`, this.fb.control(value, relation.required ? [Validators.required] : []));
    }
    this.relationIds.set(initial);
    const facet = this.typeFacet;
    if (facet && !current) {
      this.form.addControl(facet.field, this.fb.control(facet.classes[0] ?? '', [Validators.required]));
    } else if (facet) {
      this.form.addControl(facet.field, this.fb.control(facet.classes[0] ?? ''));
    }
  }

  private initialDataValue(field: DataFieldMeta, existing: unknown): unknown {
    if (existing === null || existing === undefined) return field.datatype === 'boolean' ? false : '';
    if (field.datatype === 'boolean') return existing === true || String(existing) === 'true';
    if (field.datatype === 'date') return toDateInput(String(existing));
    if (field.datatype === 'dateTime') return toDateTimeInput(String(existing));
    if (field.datatype === 'integer' || field.datatype === 'decimal') return Number(existing);
    return String(existing);
  }

  private validatorsFor(field: DataFieldMeta): ValidatorFn[] {
    const list: ValidatorFn[] = [];
    if (field.required) list.push(Validators.required);
    if (field.datatype === 'integer' || field.datatype === 'decimal') {
      if (field.min !== null) list.push(Validators.min(field.min));
      if (field.max !== null) list.push(Validators.max(field.max));
    }
    if (field.maxLength) list.push(Validators.maxLength(field.maxLength));
    if (field.pattern) list.push(Validators.pattern(field.pattern));
    return list;
  }
}
