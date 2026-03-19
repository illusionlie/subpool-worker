import js from '@eslint/js';
import globals from 'globals';

const sharedNoUnusedVarsRule = ['error', {
  argsIgnorePattern: '^_',
  varsIgnorePattern: '^_',
  caughtErrorsIgnorePattern: '^_',
}];

const baseStyleRules = {
  'prefer-const': 'warn',
  quotes: ['warn', 'single', { avoidEscape: true }],
  semi: ['warn', 'always'],
  'comma-dangle': ['warn', 'never'],
  'object-curly-spacing': ['warn', 'always'],
  'no-trailing-spaces': 'warn',
  'eol-last': ['warn', 'always']
};

const baseJavaScriptRules = {
  'no-unused-vars': sharedNoUnusedVarsRule,
  ...baseStyleRules
};

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      '.wrangler/**',
      'coverage/**'
    ]
  },
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.es2024,
        ...globals.serviceworker,
        ...globals.worker
      }
    },
    rules: baseJavaScriptRules
  },
  {
    files: ['public/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: {
        ...globals.es2024,
        ...globals.browser
      }
    },
    rules: baseJavaScriptRules
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
        ...globals.worker
      }
    },
    rules: {
      'no-unused-vars': sharedNoUnusedVarsRule
    }
  }
];

