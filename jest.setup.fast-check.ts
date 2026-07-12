import * as fc from 'fast-check';

// Lower the global fast-check default iteration count so the property-based
// test suite runs faster. Inline `{ numRuns: N }` options in individual tests
// still override this global default.
fc.configureGlobal({ numRuns: 10 });
