import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // Entry point: only wires config and server to the stdio transport and exits
      // the process; not reachable from unit tests.
      exclude: ['src/index.ts'],
      // Set just below the measured values on 2026-08-17
      // (98.04 / 87.37 / 98.48 / 98.39), with headroom on functions. Raise these
      // when the measurement rises; answer a drop with tests, never by lowering
      // them. Vitest 4 measures AST-based and stricter than v3, so expect a drop
      // after a major bump and cover it rather than relaxing the gate.
      thresholds: {
        statements: 96,
        branches: 84,
        functions: 93,
        lines: 96,
      },
    },
  },
});
