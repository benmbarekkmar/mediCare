import { sparql } from '../sparql/client';
import { prefixes } from '../sparql/prefixes';

export interface ConsistencyCheck {
  id: string;
  title: string;
  axiom: string;
  violations: { subject: string; detail: string }[];
  count: number;
  query: string;
  fix: string | null;
}

const P = (body: string): string => prefixes.withPrefixes(body);

const compact = (iri: string): string => prefixes.compact(iri).replace(/^ont:/, ':');

interface Definition {
  id: string;
  title: string;
  axiom: string;
  /** SELECT ?s ?detail returning one row per violation */
  select: string;
  /** SPARQL Update that restores the invariant, null when manual work is needed */
  fix: string | null;
}

/**
 * Fuseki runs without a reasoner, so the application writer materializes the
 * consequences of every axiom. These checks verify that the stored graph really
 * is closed under the axioms declared in the TBox.
 */
const DEFINITIONS: Definition[] = [
  {
    id: 'subclass-closure',
    title: 'Missing superclass assertions',
    axiom: 'rdfs:subClassOf+',
    select: P(`SELECT ?s ?detail WHERE {
  ?s rdf:type ?c .
  ?c rdfs:subClassOf+ ?parent .
  FILTER(isIRI(?c) && isIRI(?parent))
  FILTER NOT EXISTS { ?s rdf:type ?parent }
  BIND(CONCAT(STR(?c), " is not asserted as ", STR(?parent)) AS ?detail)
}`),
    // anonymous restriction classes are excluded: they are only meaningful to a
    // reasoner, and asserting an individual as instance of one would inject blank nodes
    fix: P(`INSERT { ?s rdf:type ?parent } WHERE {
  ?s rdf:type ?c .
  ?c rdfs:subClassOf+ ?parent .
  FILTER(isIRI(?c) && isIRI(?parent))
  FILTER NOT EXISTS { ?s rdf:type ?parent }
}`),
  },
  {
    id: 'named-class-typing',
    title: 'Individual typed with an anonymous class',
    axiom: 'materialization rule: only named classes are asserted',
    select: P(`SELECT ?s ?detail WHERE {
  ?s rdf:type ?anon .
  FILTER(!isIRI(?anon))
  BIND("rdf:type points at a blank node class expression" AS ?detail)
}`),
    fix: P(`DELETE { ?s rdf:type ?anon } WHERE {
  ?s rdf:type ?anon .
  FILTER(!isIRI(?anon))
}`),
  },
  {
    id: 'named-individual',
    title: 'Individuals without owl:NamedIndividual',
    axiom: 'owl:NamedIndividual typing',
    select: P(`SELECT ?s ?detail WHERE {
  ?s rdf:type ?c .
  FILTER(STRSTARTS(STR(?c), "${prefixes.get('ont')}"))
  FILTER NOT EXISTS { ?s rdf:type owl:NamedIndividual }
  BIND("instance of a domain class but not tagged owl:NamedIndividual" AS ?detail)
}`),
    fix: P(`INSERT { ?s rdf:type owl:NamedIndividual } WHERE {
  ?s rdf:type ?c .
  FILTER(STRSTARTS(STR(?c), "${prefixes.get('ont')}"))
  FILTER NOT EXISTS { ?s rdf:type owl:NamedIndividual }
}`),
  },
  {
    id: 'label-presence',
    title: 'Individuals without rdfs:label',
    axiom: 'rdfs:label documentation rule',
    select: P(`SELECT ?s ?detail WHERE {
  ?s rdf:type ?c .
  FILTER(STRSTARTS(STR(?c), "${prefixes.get('ont')}"))
  FILTER NOT EXISTS { ?s rdfs:label ?l }
  BIND("no human readable label" AS ?detail)
}`),
    fix: null,
  },
  {
    id: 'inverse-forward',
    title: 'Missing inverse triples (property -> inverse)',
    axiom: 'owl:inverseOf',
    select: P(`SELECT ?s ?detail WHERE {
  ?p owl:inverseOf ?inv .
  ?s ?p ?o .
  FILTER(isIri(?o))
  FILTER NOT EXISTS { ?o ?inv ?s }
  BIND(CONCAT(STR(?o), " should link back through ", STR(?inv)) AS ?detail)
}`),
    fix: P(`INSERT { ?o ?inv ?s } WHERE {
  ?p owl:inverseOf ?inv .
  ?s ?p ?o .
  FILTER(isIri(?o))
  FILTER NOT EXISTS { ?o ?inv ?s }
}`),
  },
  {
    id: 'inverse-backward',
    title: 'Missing inverse triples (inverse -> property)',
    axiom: 'owl:inverseOf',
    select: P(`SELECT ?s ?detail WHERE {
  ?p owl:inverseOf ?inv .
  ?s ?inv ?o .
  FILTER(isIri(?o))
  FILTER NOT EXISTS { ?o ?p ?s }
  BIND(CONCAT(STR(?o), " should link back through ", STR(?p)) AS ?detail)
}`),
    fix: P(`INSERT { ?o ?p ?s } WHERE {
  ?p owl:inverseOf ?inv .
  ?s ?inv ?o .
  FILTER(isIri(?o))
  FILTER NOT EXISTS { ?o ?p ?s }
}`),
  },
  {
    id: 'chain-department',
    title: 'Missing :followedInDepartment (property chain)',
    axiom: 'owl:propertyChainAxiom (:treatedBy :worksIn)',
    select: P(`SELECT ?s ?detail WHERE {
  ?p ont:treatedBy ?d .
  ?d ont:worksIn ?dep .
  BIND(?p AS ?s)
  FILTER NOT EXISTS { ?p ont:followedInDepartment ?dep }
  BIND(CONCAT("expected :followedInDepartment ", STR(?dep)) AS ?detail)
}`),
    fix: P(`INSERT { ?p ont:followedInDepartment ?dep } WHERE {
  ?p ont:treatedBy ?d .
  ?d ont:worksIn ?dep .
  FILTER NOT EXISTS { ?p ont:followedInDepartment ?dep }
}`),
  },
  {
    id: 'stale-department',
    title: 'Stale :followedInDepartment assertion',
    axiom: 'owl:propertyChainAxiom (:treatedBy :worksIn)',
    select: P(`SELECT ?s ?detail WHERE {
  ?p ont:followedInDepartment ?dep .
  BIND(?p AS ?s)
  FILTER NOT EXISTS { ?p ont:treatedBy ?d . ?d ont:worksIn ?dep }
  BIND(CONCAT("no doctor of this patient works in ", STR(?dep)) AS ?detail)
}`),
    fix: P(`DELETE { ?p ont:followedInDepartment ?dep } WHERE {
  ?p ont:followedInDepartment ?dep .
  FILTER NOT EXISTS { ?p ont:treatedBy ?d . ?d ont:worksIn ?dep }
}`),
  },
  {
    id: 'chain-hospital',
    title: 'Missing :followedInHospital (property chain)',
    axiom: 'owl:propertyChainAxiom (:followedInDepartment :locatedIn)',
    select: P(`SELECT ?s ?detail WHERE {
  ?p ont:followedInDepartment ?dep .
  ?dep ont:locatedIn ?h .
  BIND(?p AS ?s)
  FILTER NOT EXISTS { ?p ont:followedInHospital ?h }
  BIND(CONCAT("expected :followedInHospital ", STR(?h)) AS ?detail)
}`),
    fix: P(`INSERT { ?p ont:followedInHospital ?h } WHERE {
  ?p ont:followedInDepartment ?dep .
  ?dep ont:locatedIn ?h .
  FILTER NOT EXISTS { ?p ont:followedInHospital ?h }
}`),
  },
  {
    id: 'stale-hospital',
    title: 'Stale :followedInHospital assertion',
    axiom: 'owl:propertyChainAxiom (:followedInDepartment :locatedIn)',
    select: P(`SELECT ?s ?detail WHERE {
  ?p ont:followedInHospital ?h .
  BIND(?p AS ?s)
  FILTER NOT EXISTS { ?p ont:followedInDepartment ?dep . ?dep ont:locatedIn ?h }
  BIND("no followed department is located in this hospital" AS ?detail)
}`),
    fix: P(`DELETE { ?p ont:followedInHospital ?h } WHERE {
  ?p ont:followedInHospital ?h .
  FILTER NOT EXISTS { ?p ont:followedInDepartment ?dep . ?dep ont:locatedIn ?h }
}`),
  },
  {
    id: 'chronic-missing',
    title: 'Patient of a chronic disease not typed :ChronicPatient',
    axiom: 'owl:equivalentClass (:Patient ⊓ ∃:hasDisease.:ChronicDisease)',
    select: P(`SELECT ?s ?detail WHERE {
  ?p ont:hasDisease ?d .
  ?d rdf:type ont:ChronicDisease .
  BIND(?p AS ?s)
  FILTER NOT EXISTS { ?p rdf:type ont:ChronicPatient }
  BIND(CONCAT("carries chronic disease ", STR(?d)) AS ?detail)
}`),
    fix: P(`INSERT { ?p rdf:type ont:ChronicPatient } WHERE {
  ?p ont:hasDisease ?d .
  ?d rdf:type ont:ChronicDisease .
  FILTER NOT EXISTS { ?p rdf:type ont:ChronicPatient }
}`),
  },
  {
    id: 'chronic-stale',
    title: ':ChronicPatient without any chronic disease',
    axiom: 'owl:equivalentClass (:Patient ⊓ ∃:hasDisease.:ChronicDisease)',
    select: P(`SELECT ?s ?detail WHERE {
  ?p rdf:type ont:ChronicPatient .
  BIND(?p AS ?s)
  FILTER NOT EXISTS { ?p ont:hasDisease ?d . ?d rdf:type ont:ChronicDisease }
  BIND("no chronic disease left to justify the class" AS ?detail)
}`),
    fix: P(`DELETE { ?p rdf:type ont:ChronicPatient } WHERE {
  ?p rdf:type ont:ChronicPatient .
  FILTER NOT EXISTS { ?p ont:hasDisease ?d . ?d rdf:type ont:ChronicDisease }
}`),
  },
  {
    id: 'emergency-missing',
    title: 'Emergency appointment without :EmergencyPatient',
    axiom: 'owl:equivalentClass (:Patient ⊓ ∃:hasAppointment.:EmergencyAppointment)',
    select: P(`SELECT ?s ?detail WHERE {
  ?p ont:hasAppointment ?a .
  ?a rdf:type ont:EmergencyAppointment .
  BIND(?p AS ?s)
  FILTER NOT EXISTS { ?p rdf:type ont:EmergencyPatient }
  BIND(CONCAT("has emergency appointment ", STR(?a)) AS ?detail)
}`),
    fix: P(`INSERT { ?p rdf:type ont:EmergencyPatient } WHERE {
  ?p ont:hasAppointment ?a .
  ?a rdf:type ont:EmergencyAppointment .
  FILTER NOT EXISTS { ?p rdf:type ont:EmergencyPatient }
}`),
  },
  {
    id: 'emergency-stale',
    title: ':EmergencyPatient without emergency appointment',
    axiom: 'owl:equivalentClass (:Patient ⊓ ∃:hasAppointment.:EmergencyAppointment)',
    select: P(`SELECT ?s ?detail WHERE {
  ?p rdf:type ont:EmergencyPatient .
  BIND(?p AS ?s)
  FILTER NOT EXISTS { ?p ont:hasAppointment ?a . ?a rdf:type ont:EmergencyAppointment }
  BIND("no emergency appointment left to justify the class" AS ?detail)
}`),
    fix: P(`DELETE { ?p rdf:type ont:EmergencyPatient } WHERE {
  ?p rdf:type ont:EmergencyPatient .
  FILTER NOT EXISTS { ?p ont:hasAppointment ?a . ?a rdf:type ont:EmergencyAppointment }
}`),
  },
  {
    id: 'age-class-missing',
    title: 'Patient without the age class of their :hasAge',
    axiom: 'owl:equivalentClass on xsd:integer ranges',
    select: P(`SELECT ?s ?detail WHERE {
  ?p ont:hasAge ?a .
  BIND(?p AS ?s)
  BIND(IF(?a < 18, ont:ChildPatient, IF(?a < 65, ont:AdultPatient, ont:ElderlyPatient)) AS ?expected)
  FILTER NOT EXISTS { ?p rdf:type ?expected }
  BIND(CONCAT("age ", STR(?a), " implies ", STR(?expected)) AS ?detail)
}`),
    fix: P(`INSERT { ?p rdf:type ont:ChildPatient } WHERE { ?p ont:hasAge ?a FILTER(?a < 18) FILTER NOT EXISTS { ?p rdf:type ont:ChildPatient } }`),
  },
  {
    id: 'age-class-stale',
    title: 'Patient typed in the wrong age class',
    axiom: 'owl:equivalentClass on xsd:integer ranges',
    select: P(`SELECT ?s ?detail WHERE {
  ?p ont:hasAge ?a .
  { ?p rdf:type ont:ChildPatient ; ont:hasAge ?a . FILTER(?a >= 18) } UNION
  { ?p rdf:type ont:AdultPatient ; ont:hasAge ?a . FILTER(?a < 18 || ?a >= 65) } UNION
  { ?p rdf:type ont:ElderlyPatient ; ont:hasAge ?a . FILTER(?a < 65) }
  BIND(?p AS ?s)
  BIND(CONCAT("age ", STR(?a), " contradicts the asserted patient class") AS ?detail)
}`),
    fix: null,
  },
];

export interface ConsistencyReport {
  checkedAt: string;
  ok: boolean;
  violations: number;
  fixable: number;
  checks: ConsistencyCheck[];
}

export class ConsistencyService {
  async audit(): Promise<ConsistencyReport> {
    const checks = await Promise.all(
      DEFINITIONS.map(async (def): Promise<ConsistencyCheck> => {
        const { rows } = await sparql.select(def.select);
        return {
          id: def.id,
          title: def.title,
          axiom: def.axiom,
          count: rows.length,
          violations: rows.slice(0, 20).map((row) => ({
            subject: compact(row['s']?.value ?? ''),
            detail: String(row['detail']?.value ?? ''),
          })),
          query: def.select,
          fix: def.fix,
        };
      }),
    );
    const violations = checks.reduce((acc, c) => acc + c.count, 0);
    return {
      checkedAt: new Date().toISOString(),
      ok: violations === 0,
      violations,
      fixable: checks.filter((c) => c.count > 0 && c.fix).reduce((acc, c) => acc + c.count, 0),
      checks,
    };
  }

  /**
   * Re-establishes materialization in one atomic update: every INSERT/DELETE
   * WHERE below is a bounded annotation repair executed by Fuseki itself.
   */
  async repair(): Promise<{ applied: number; operations: number; report: ConsistencyReport }> {
    const before = await this.audit();
    const applicable = DEFINITIONS.filter((d) => d.fix && before.checks.find((c) => c.id === d.id)?.count);
    const extra = AGE_STALE_FIXES.map((f) => P(f));
    if (applicable.length === 0 && before.violations === 0)
      return { applied: 0, operations: 0, report: before };

    const operations = [...applicable.map((d) => d.fix as string), ...extra].filter(Boolean);
    if (operations.length > 0) await sparql.update(operations.join('\n;\n'));
    const report = await this.audit();
    return {
      applied: Math.max(0, before.violations - report.violations),
      operations: operations.length,
      report,
    };
  }
}

const AGE_STALE_FIXES = [
  `DELETE { ?p rdf:type ont:ChildPatient } WHERE { ?p rdf:type ont:ChildPatient . ?p ont:hasAge ?a . FILTER(?a >= 18) }`,
  `DELETE { ?p rdf:type ont:AdultPatient } WHERE { ?p rdf:type ont:AdultPatient . ?p ont:hasAge ?a . FILTER(?a < 18 || ?a >= 65) }`,
  `DELETE { ?p rdf:type ont:ElderlyPatient } WHERE { ?p rdf:type ont:ElderlyPatient . ?p ont:hasAge ?a . FILTER(?a < 65) }`,
  `INSERT { ?p rdf:type ont:AdultPatient } WHERE { ?p ont:hasAge ?a . FILTER(?a >= 18 && ?a < 65) . FILTER NOT EXISTS { ?p rdf:type ont:AdultPatient } }`,
  `INSERT { ?p rdf:type ont:ElderlyPatient } WHERE { ?p ont:hasAge ?a . FILTER(?a >= 65) . FILTER NOT EXISTS { ?p rdf:type ont:ElderlyPatient } }`,
  // a patient class always implies its superclass
  `INSERT { ?p rdf:type ont:Patient } WHERE { VALUES ?cls { ont:ChildPatient ont:AdultPatient ont:ElderlyPatient ont:ChronicPatient ont:EmergencyPatient } ?p rdf:type ?cls FILTER NOT EXISTS { ?p rdf:type ont:Patient } }`,
];

export const consistencyService = new ConsistencyService();
