import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['eslint.config.js'] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...globals.greasemonkey,
      },
    },
    rules: {
      indent: ['error', 2],
      semi: 'error',
      quotes: ['error', 'single'],
      'comma-spacing': 'error',
      'keyword-spacing': 'error',
      'brace-style': 'error',
      'no-trailing-spaces': 'error',
      'eol-last': 'error',
      'object-curly-spacing': ['error', 'always'],
      'key-spacing': 'error',
      'no-undef': 'error',
      'no-unused-vars': 'off',
    },
  },
];
