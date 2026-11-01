import {
  ChangeDetectionStrategy,
  Component,
  OnChanges,
  SimpleChanges,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, ValidatorFn, Validators } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Observable, of } from 'rxjs';
import { EntitiesService } from '../../core/api/entity.service';
import type { DataFieldMeta, EntityInput, EntityKey, EntityMeta, Individual, Ref, RelationMeta } from '../../core/api/models';
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
export class EntityFormComponent implements OnChanges {
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

  readonly form = this.fb.group({});
  readonly relationIds = signal<Record<string, Ref[]>>({});

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['meta'] || changes['value'] || changes['writable']) this.build();
  }

  get controls(): readonly DataFieldMeta[] {
    return this.meta().data.filter((field) => !HIDDEN_FIELDS.has(field.field) && this.editable(field.field));
  }

  get relations(): readonly RelationMeta[] {
    return this.meta().relations.filter((relation) => !relation.readOnly && !relation.virtual && this.editable(relation.field));
  }

  get hasIdentityFields(): boolean {
    const facet = this.typeFacet;
    return this.controls.length > 0 || (!!facet && this.editable(facet.field));
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
    const entity = labelOf(this.translate, 'entities.' + target + '.plural', target);
    return this.translate.instant('form.searchEntity', { entity });
  }

  relationLabel(relation: RelationMeta): string {
    return labelOf(this.translate, 'entities.' + relation.target + '.singular', relation.targetLabel);
  }

  labelOfValue(value: string): string {
    return labelOf(this.translate, 'entities.values.' + value, value);
  }

  facetOptions(values: readonly string[]): SelectOption[] {
    return values.map((value) => ({ value, label: this.labelOfValue(value) }));
  }

  facetInitial(): Ref[] {
    const facet = this.typeFacet;
    if (!facet) return [];
    const types = this.value()?.types ?? [];
    return facet.classes
      .filter((value) => types.includes(value))
      .map((value) => ({ id: value, iri: '', label: this.labelOfValue(value), type: value }));
  }

  searchFacet(values: readonly string[]): (term: string) => Observable<Ref[]> {
    return (term: string) => {
      const query = term.trim().toLocaleLowerCase();
      return of(
        values
          .filter((value) => !query || value.toLocaleLowerCase().includes(query) || this.labelOfValue(value).toLocaleLowerCase().includes(query))
          .map((value) => ({ id: value, iri: '', label: this.labelOfValue(value), type: value })),
      );
    };
  }

  searchRefs(target: string): (term: string) => Observable<Ref[]> {
    return (term: string) => this.entities.refs(target as EntityKey, term, 20);
  }

  initialRefs(relation: RelationMeta): Ref[] {
    return this.relationIds()[relation.field] ?? [];
  }

  errorsFor(field: string): string[] {
    const control = this.form.get(field);
    if (!control || control.valid || (control.pristine && !control.touched)) return [];
    const out: string[] = [];
    if (control.hasError('required')) out.push(this.translate.instant('errors.field.required'));
    if (control.hasError('min')) out.push(this.translate.instant('errors.field.min', { min: control.getError('min')['min'] }));
    if (control.hasError('max')) out.push(this.translate.instant('errors.field.max', { max: control.getError('max')['max'] }));
    if (control.hasError('maxlength'))
      out.push(this.translate.instant('errors.field.maxlength', { requiredLength: control.getError('maxlength')['requiredLength'] }));
    if (control.hasError('minlength'))
      out.push(this.translate.instant('errors.field.minlength', { requiredLength: control.getError('minlength')['requiredLength'] }));
    if (control.hasError('pattern')) out.push(this.translate.instant('errors.field.pattern'));
    if (control.hasError('email')) out.push(this.translate.instant('errors.field.email'));
    if (control.hasError('date')) out.push(this.translate.instant('errors.field.date'));
    return out;
  }

  get canSubmit(): boolean {
    return !this.busy();
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const meta = this.meta();
    const current = this.value();
    const facet = this.typeFacet;
    const raw = this.form.getRawValue() as Record<string, unknown>;
    const body: EntityInput = { relations: {}, label: '' };
    for (const [key, value] of Object.entries(raw)) {
      if (key.startsWith('rel:') || key === facet?.field || !meta.data.some((field) => field.field === key)) continue;
      if (current && !this.form.get(key)?.dirty) continue;
      if (value === '' || value === null || value === undefined) {
        if (current) body[key] = null;
        continue;
      }
      body[key] = value as string | number | boolean | string[];
    }
    // the label is the human name the store indexes and the tables show
    const nameValue = body[meta.nameField];
    if (nameValue !== undefined) body['label'] = typeof nameValue === 'string' ? nameValue : String(nameValue ?? '');
    for (const relation of this.relations) {
      if (!this.editable(relation.field)) continue;
      const control = this.form.get(`rel:${relation.field}`);
      if (!control) continue;
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
    if (facet && this.editable(facet.field)) {
      const control = this.form.get(facet.field);
      if (control && (!current || control.dirty)) {
        const selected = raw[facet.field];
        const types = Array.isArray(selected) ? selected.map(String) : selected ? [String(selected)] : [];
        body['types'] = types;
      }
    }
    this.submitted.emit(body);
  }

  cancel(): void {
    this.cancelled.emit();
  }

  private build(): void {
    for (const name of Object.keys(this.form.controls)) this.form.removeControl(name);
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
    if (facet && this.editable(facet.field)) {
      const selectedTypes = facet.classes.filter((type) => current?.types.includes(type) ?? false);
      const value = facet.multiple ? selectedTypes : selectedTypes[0] ?? '';
      this.form.addControl(facet.field, this.fb.control(value, facet.required ? [Validators.required] : []));
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
