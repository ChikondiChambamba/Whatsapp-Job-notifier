import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['dist/**', 'web-dist/**', 'desktop-dist/**', 'release/**', 'node_modules/**', 'auth_session/**', 'data/**'],
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      // Express identifies error handlers by their four parameters.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['web/src/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        project: './web/tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Destructuring to drop fields is intentional.
      '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
    },
  },
);
