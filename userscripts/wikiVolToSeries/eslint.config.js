import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default [
  js.configs.recommended,
  prettier,
  { ignores: ['dist/'] },
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        $: 'readonly',
        subjectList: 'writable',
        addRelateSubject: 'readonly',
        findSubjectFunc: 'readonly',
        rmParent: 'readonly',
        nowmode: 'readonly',
        NormaltoWCODE: 'readonly',
        WCODEtoNormal: 'readonly',
      },
    },
    rules: {
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
