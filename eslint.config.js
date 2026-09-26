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
// All styling goes through CSS files that use tokens (spec §12), which
// tests/unit/design-tokens.test.ts checks; inline styles would bypass that.
const noInlineStyle = {
  selector: 'JSXAttribute[name.name="style"]',
  message: 'Use a CSS class that reads design tokens instead of an inline style.',
};
// Anonymisation (spec §8) is applied at one rendering layer: the UI reads a
// member's name only through src/ui/state/names.ts, so no view can show a real
// name while names are hidden.
const nameMessage =
  'Read member names through useMemberNames() or memberNames() in src/ui/state/names.ts, which applies anonymisation.';
const noDisplayName = [
  { selector: 'MemberExpression[property.name="display_name"]', message: nameMessage },
  { selector: 'MemberExpression[property.value="display_name"]', message: nameMessage },
  { selector: 'Property[key.name="display_name"]', message: nameMessage },
];

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
      'no-restricted-syntax': ['error', noInlineStyle],
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
    files: ['src/ui/**/*.{ts,tsx}'],
    ignores: ['src/ui/state/names.ts'],
    rules: { 'no-restricted-syntax': ['error', noInlineStyle, ...noDisplayName] },
  },
  {
    files: ['tests/**/*.ts', 'scripts/**/*.ts', '*.config.ts'],
    languageOptions: { globals: globals.node },
  },
  prettier,
);
