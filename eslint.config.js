import js from '@eslint/js';
import globals from 'globals';
export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      '.audit/**',
      '.npm-cache/**',
      'playwright-report/**',
      'test-results/**',
      'releases/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }] },
  },
];
