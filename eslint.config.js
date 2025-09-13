// eslint.config.js — robust for ESLint v9 Flat Config
import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import prettierPlugin from 'eslint-plugin-prettier';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import * as tseslint from 'typescript-eslint';

// Safely read "recommended" rule sets if the plugin provides them.
// If not, fall back to empty objects so ESLint won't crash.
const reactRecommendedRules = reactPlugin.configs?.recommended?.rules ?? {};
const jsxA11yRecommendedRules = jsxA11y.configs?.recommended?.rules ?? {};

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,

  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    settings: { react: { version: 'detect' } },
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
      prettier: prettierPlugin,
    },
    rules: {
      // bring in recs
      ...reactRecommendedRules,
      ...jsxA11yRecommendedRules,

      // format
      'prettier/prettier': 'error',

      // 👇 make `any` a warning (overrides preset)
      '@typescript-eslint/no-explicit-any': 'warn',

      // other sensible defaults
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
];
