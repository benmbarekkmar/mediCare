import { Component, signal, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import type { ClassNode } from '../../../core/api/models';
import { TRANSLATE_TEST_IMPORTS } from '../translate-testing';
import { UiTreeComponent } from './ui-tree.component';

const NODES: ClassNode[] = [
  {
    id: 'Person',
    label: 'Person',
    individuals: 120,
    children: [
      {
        id: 'Patient',
        label: 'Patient',
        individuals: 40,
        children: [{ id: 'ChildPatient', label: 'Child patient', individuals: 4, children: [] }],
      },
      { id: 'Doctor', label: 'Doctor', individuals: 12, children: [] },
    ],
  },
  {
    id: 'Organisation',
    label: 'Organisation',
    individuals: 7,
    children: [{ id: 'Hospital', label: 'Hospital', individuals: 3, children: [] }],
  },
];

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'test-host',
  standalone: true,
  imports: [UiTreeComponent],
  template: `<ui-tree [nodes]="nodes()" [selectedId]="selected()" (nodeSelect)="select($event)" />`,
})
class TestHostComponent {
  readonly nodes = signal<ClassNode[]>(NODES);
  readonly selected = signal<string | null>(null);
  picked: string | null = null;
  readonly tree = viewChild.required(UiTreeComponent);

  select(id: string): void {
    this.picked = id;
    this.selected.set(id);
  }
}

describe('UiTreeComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let host: TestHostComponent;
  let root: HTMLElement;

  const rows = (): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('[role="treeitem"]')];
  const labels = (): string[] =>
    rows().map((row) => (row.querySelector('.ui-tree__label')?.textContent ?? '').trim());

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [...TRANSLATE_TEST_IMPORTS, TestHostComponent],
    }).compileComponents();

    TestBed.inject(TranslateService).setDefaultLang('en');
    fixture = TestBed.createComponent(TestHostComponent);
    host = fixture.componentInstance;
    root = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  it('opens the root branches only', () => {
    expect(labels()).toEqual(['Person', 'Patient', 'Doctor', 'Organisation', 'Hospital']);
    expect(rows()[0]?.getAttribute('aria-expanded')).toBe('true');
    expect(rows()[1]?.getAttribute('aria-expanded')).toBe('false');
    expect(rows()[3]?.getAttribute('aria-level')).toBe('1');
    expect(rows()[4]?.getAttribute('aria-level')).toBe('2');
  });

  it('announces the tree and the instance counts', () => {
    expect(root.querySelector('[role="tree"]')?.getAttribute('aria-label')).toBe('uidata.tree.label');
    expect(rows()[0]?.querySelector('.ui-tree__count')?.textContent?.trim()).toBe('120');
    expect(root.querySelector('input[type="search"]')).withContext('the search field is part of the explorer');
    expect(root.querySelector('input[type="search"]')?.getAttribute('id')).toBeTruthy();
  });

  it('selects a class and emits its id without collapsing it', () => {
    rows()[1]?.click();
    fixture.detectChanges();
    expect(host.picked).toBe('Patient');
    expect(rows()[1]?.getAttribute('aria-selected')).toBe('true');
    expect(labels()).toContain('Child patient');
  });

  it('collapses and expands through the twisty', () => {
    root.querySelector('.ui-tree__twisty')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    expect(labels()).toEqual(['Person', 'Organisation', 'Hospital']);
    expect(host.picked).toBeNull();

    root.querySelector('.ui-tree__twisty')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    expect(labels()).toEqual(['Person', 'Patient', 'Doctor', 'Organisation', 'Hospital']);
  });

  it('expands and collapses everything through the public methods', () => {
    host.tree().expandAll();
    fixture.detectChanges();
    expect(labels()).toEqual(['Person', 'Patient', 'Child patient', 'Doctor', 'Organisation', 'Hospital']);

    host.tree().collapseAll();
    fixture.detectChanges();
    expect(labels()).toEqual(['Person', 'Organisation']);
  });

  it('filters to the matching branch and keeps its ancestors', () => {
    const input = root.querySelector<HTMLInputElement>('input[type="search"]');
    input!.value = 'child';
    input!.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(labels()).toEqual(['Person', 'Patient', 'Child patient']);
    expect(rows()[2]?.getAttribute('aria-level')).toBe('3');

    input!.value = 'nothing here';
    input!.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(rows().length).toBe(0);
    expect(root.querySelector('.ui-tree__empty')?.textContent).toContain('uidata.tree.noMatch');
  });

  it('walks with the arrow keys using a single tab stop', () => {
    rows()[0]?.focus();
    rows()[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    fixture.detectChanges();
    expect(document.activeElement).toBe(rows()[1]);

    rows()[1]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    fixture.detectChanges();
    expect(rows()[1]?.getAttribute('aria-expanded')).toBe('true');

    rows()[1]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    fixture.detectChanges();
    expect(rows()[1]?.getAttribute('aria-expanded')).toBe('false');
  });

  it('selects with Enter', () => {
    rows()[2]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();
    expect(host.picked).toBe('Doctor');
  });

  it('highlights the selected class coming from the parent', () => {
    host.selected.set('ChildPatient');
    fixture.detectChanges();
    expect(labels()).toContain('Child patient');
    const selectedRow = rows().find((row) => row.getAttribute('data-node') === 'ChildPatient');
    expect(selectedRow?.getAttribute('aria-selected')).toBe('true');
  });

  it('survives an empty ontology', () => {
    host.nodes.set([]);
    fixture.detectChanges();
    expect(rows().length).toBe(0);
    expect(root.querySelector('.ui-tree__empty')?.textContent).toContain('ui.empty.title');
  });
});
