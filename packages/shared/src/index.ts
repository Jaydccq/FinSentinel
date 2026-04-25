export * from './enums';
export * from './schemas';
export * from './trading';
export { Decimal, decimalStringRegex, type DecimalValue } from './money';

/**
 * Re-export the exact `zod` instance the shared schemas were constructed
 * with. Consumers (e.g. the web typed-client registry) MUST import `z`
 * from this barrel rather than `import { z } from 'zod'` — node's module
 * resolution can otherwise pick up a different zod copy from a parent
 * node_modules and the resulting `z.array(sharedSchema)` blows up with
 * `Cannot read properties of undefined (reading 'run')` because the
 * inner schema's internal slot mismatches the wrapper's instance.
 */
export { z } from 'zod';
// NOTE: './utils' is intentionally NOT re-exported from the package root.
// `utils/hash.ts` uses `node:crypto`, which breaks Next.js client-side
// webpack bundling when the barrel pulls it in via consumer imports from
// `@finsentinel/shared`. Utilities are local to the shared package for now;
// if an external consumer needs them, add an explicit package.json subpath
// export (e.g. `@finsentinel/shared/utils`) rather than restoring the
// root-level barrel.
