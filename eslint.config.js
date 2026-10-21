import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

const storageGatewayFiles = [
  'src/**/storageGateway.{js,jsx}',
  'src/**/localStorageGateway.{js,jsx}',
  'src/**/storage.gateway.{js,jsx}',
];

export default [
  {
    ignores: [
      'coverage/**',
      'dist/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
        sourceType: 'module',
      },
    },
  },
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-console': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.name="fetch"]',
          message: 'Do not use fetch directly. Use the application network gateway.',
        },
        {
          selector:
            'CallExpression[callee.object.name=/^(window|globalThis|self)$/][callee.property.name="fetch"]',
          message: 'Do not use fetch directly. Use the application network gateway.',
        },
        {
          selector: 'NewExpression[callee.name=/^(XMLHttpRequest|WebSocket|EventSource)$/]',
          message: 'Do not use network primitives directly. Use the application network gateway.',
        },
        {
          selector:
            'NewExpression[callee.object.name=/^(window|globalThis|self)$/][callee.property.name=/^(XMLHttpRequest|WebSocket|EventSource)$/]',
          message: 'Do not use network primitives directly. Use the application network gateway.',
        },
        {
          selector:
            'CallExpression[callee.object.name="navigator"][callee.property.name="sendBeacon"]',
          message: 'Do not use network primitives directly. Use the application network gateway.',
        },
        {
          selector:
            'CallExpression[callee.object.object.name=/^(window|globalThis|self)$/][callee.object.property.name="navigator"][callee.property.name="sendBeacon"]',
          message: 'Do not use network primitives directly. Use the application network gateway.',
        },
      ],
      'react-refresh/only-export-components': [
        'warn',
        {
          allowConstantExport: true,
        },
      ],
    },
  },
  {
    files: ['src/**/*.{js,jsx}'],
    ignores: storageGatewayFiles,
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'localStorage',
          message: 'Access localStorage through the storage gateway.',
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'window',
          property: 'localStorage',
          message: 'Access localStorage through the storage gateway.',
        },
        {
          object: 'globalThis',
          property: 'localStorage',
          message: 'Access localStorage through the storage gateway.',
        },
      ],
    },
  },
  {
    files: ['src/components/**/*.{js,jsx}', 'src/hooks/**/*.{js,jsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '../pages/**',
                '../../pages/**',
                '../../../pages/**',
                '**/pages/**',
              ],
              message: 'Reusable components and hooks must not import from the page layer.',
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      'src/services/**/*.{js,jsx}',
      'src/utils/**/*.{js,jsx}',
      'src/lib/**/*.{js,jsx}',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '../components/**',
                '../../components/**',
                '../../../components/**',
                '**/components/**',
                '../pages/**',
                '../../pages/**',
                '../../../pages/**',
                '**/pages/**',
              ],
              message: 'Infrastructure and utility modules must not import from UI layers.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/**/*.{test,spec}.{js,jsx}', 'src/test/**/*.{js,jsx}'],
    languageOptions: {
      globals: {
        afterAll: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        beforeEach: 'readonly',
        describe: 'readonly',
        expect: 'readonly',
        it: 'readonly',
        test: 'readonly',
        vi: 'readonly',
      },
    },
  },
];