import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Module boundaries from docs/plan.md §1.1.
const engineBoundary = {
  patterns: [
    { regex: '(^|/)ui(/|$)', message: 'The engine may not import from ui/.' },
    { regex: '(^|/)data/persistence', message: 'The engine may not import persistence.' },
    { group: ['react', 'react-dom', 'react/*', 'zustand'], message: 'The engine is UI-free.' },
  ],
};
const dataBoundary = {
  patterns: [
    { regex: '(^|/)(ui|engine)(/|$)', message: 'data/ may not import from ui/ or engine/.' },
    { group: ['react', 'react-dom', 'react/*', 'zustand'], message: 'data/ is UI-free.' },
  ],
};
const uiBoundary = {
  patterns: [
    {
      regex: '(^|/)engine(/|$)',
      message: 'ui/ reaches the engine only through ui/engineClient.ts.',
    },
  ],
};

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'test-results', 'playwright-report'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
      globals: globals.node,
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // All styling goes through CSS files that use tokens (spec §12), which
      // tests/unit/design-tokens.test.ts checks; inline styles would bypass that.
      'no-restricted-syntax': [
        'error',
        {
          selector: 'JSXAttribute[name.name="style"]',
          message: 'Use a CSS class that reads design tokens instead of an inline style.',
        },
      ],
    },
  },
  { ...jsxA11y.flatConfigs.strict, files: ['src/**/*.tsx'] },
  {
    files: ['src/**/*.tsx'],
    rules: {
      // A tab panel without focusable content takes a tab stop (WAI-ARIA APG, tabs).
      'jsx-a11y/no-noninteractive-tabindex': ['error', { roles: ['tabpanel'] }],
    },
  },
  { files: ['src/engine/**/*.ts'], rules: { 'no-restricted-imports': ['error', engineBoundary] } },
  { files: ['src/data/**/*.ts'], rules: { 'no-restricted-imports': ['error', dataBoundary] } },
  {
    files: ['src/ui/**/*.{ts,tsx}'],
    ignores: ['src/ui/engineClient.ts'],
    rules: { 'no-restricted-imports': ['error', uiBoundary] },
  },
  {
    files: ['tests/**/*.ts', 'scripts/**/*.ts', '*.config.ts'],
    languageOptions: { globals: globals.node },
  },
  prettier,
);
