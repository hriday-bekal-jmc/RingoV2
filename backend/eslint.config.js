// ESLint 9 flat config. Pragmatic ruleset focused on real bugs, not style.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'uploads/**', 'migrations/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType:  'module',
      globals: { ...globals.node },
    },
    rules: {
      // Catch real bugs
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern:        '^_',
        varsIgnorePattern:        '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      '@typescript-eslint/no-explicit-any': 'off',  // pragmatic: too many JSON fields
      '@typescript-eslint/no-non-null-assertion': 'off', // req.user! is fine after requireAuth
      'no-console': 'off',
      'prefer-const': 'warn',
      'no-var':      'error',
      'eqeqeq':      ['error', 'always', { null: 'ignore' }],
      // False-positive prone — fires on common patterns like `let x = ''; if (...) x = ...`
      'no-useless-assignment': 'off',
    },
  },
];
