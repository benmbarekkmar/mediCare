# Production build

The Angular production build disables CLI font inlining. This keeps builds deterministic when the build host cannot reach Google Fonts. The stylesheet still requests Inter and provides a system sans-serif fallback; font inlining is a build-time optimization, not a runtime requirement. JavaScript and CSS optimization remain enabled, and the component-style hard budget remains 12 kB.
