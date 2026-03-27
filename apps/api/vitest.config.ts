import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Disable Oxc transform — SWC plugin handles TypeScript + decorators
  // This also suppresses the vitest 4.x esbuild/oxc deprecation warning
  // from unplugin-swc which still sets esbuild: false internally
  oxc: false as unknown as undefined,
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts', '**/*.e2e-spec.ts'],
  },
  plugins: [
    swc.vite({
      jsc: {
        target: 'es2022',
        parser: {
          syntax: 'typescript',
          decorators: true,
        },
        transform: {
          legacyDecorator: true,
          decoratorMetadata: true,
        },
      },
    }),
  ],
});
