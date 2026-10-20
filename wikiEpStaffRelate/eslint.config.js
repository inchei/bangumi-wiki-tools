import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
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
        crtTypeList: 'readonly',
        OpenCC: 'readonly',
        openccCN: 'readonly',
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
