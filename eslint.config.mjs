import js from '@eslint/js';
import globals from 'globals';

const sharedNoUnusedVarsRule = ['error', {
  argsIgnorePattern: '^_',
  caughtErrorsIgnorePattern: '^_',
}];

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      '.wrangler/**',
      'public/**',
      'coverage/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
        ...globals.worker,
      },
    },
    rules: {
      'no-unused-vars': sharedNoUnusedVarsRule,
    },
  },
  {
    files: ['test/**/*.js', 'eslint.config.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
        ...globals.serviceworker,
        ...globals.worker,
      },
    },
    rules: {
      'no-unused-vars': sharedNoUnusedVarsRule,
    },
  },
];
