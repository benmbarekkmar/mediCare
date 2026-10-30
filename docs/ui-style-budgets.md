# Component style budget

The shared component-style hard error remains 12 kB. The warning threshold is 8.5 kB because the assistant (chat thread, result cards, history panel and responsive composer) currently emits 8.14 kB of encapsulated CSS, while the ontology explorer (graph stage, filters, hierarchy and detail panes) emits 6.40 kB. These are the two intentionally dense tool surfaces required by Phase 9. The threshold is below the existing hard error and is not a build bypass; a component still fails above 12 kB.

Keep styles with their components and review this budget if either tool UI is redesigned.
