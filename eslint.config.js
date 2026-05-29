import js from '@eslint/js'
import globals from 'globals'
import reactPlugin from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'

export default [
  // ── Ignore generated / third-party outputs ───────────────────────────────
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'output/**'],
  },

  // ── Server-side (Node.js ESM) ─────────────────────────────────────────────
  {
    files: ['server/**/*.js', 'vite.config.js', 'postcss.config.js', 'tailwind.config.js'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off',
    },
  },

  // ── Tests (Node.js + vitest globals) ─────────────────────────────────────
  {
    files: ['tests/**/*.js'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        vi: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off',
    },
  },

  // ── Frontend (React + JSX) ────────────────────────────────────────────────
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooks,
    },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: '18' },
    },
    rules: {
      ...js.configs.recommended.rules,
      ...reactPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',  // not needed with React 17+ JSX transform
      'react/prop-types': 'off',           // project doesn't use PropTypes
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off',
      // useEffect(() => { loadData() }, [loadData]) is a valid and common pattern;
      // the rule fires on any setState inside an effect, even async/callback paths.
      'react-hooks/set-state-in-effect': 'off',
      // guessIcon() returns a stable lucide-react component reference — not a new component.
      'react-hooks/static-components': 'off',
    },
  },
]
