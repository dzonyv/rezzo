import js from '@eslint/js';
import i18next from 'eslint-plugin-i18next';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['out/', 'dist/', 'release/', 'spikes/', 'vendor/', 'models/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/main/**', 'src/preload/**', 'src/workers/**', 'src/node/**', 'scripts/**', 'e2e/**', '*.config.*'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/renderer/**'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    // The UI is localized: text in JSX must come from t(), not a literal.
    files: ['src/renderer/**/*.tsx'],
    ignores: ['**/*.test.tsx'],
    plugins: { i18next },
    rules: { 'i18next/no-literal-string': ['error', { mode: 'jsx-only' }] },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
);
