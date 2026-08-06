// @ts-check

import eslint from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';
import tsdoc from 'eslint-plugin-tsdoc';
// import jest from 'eslint-plugin-jest';

export default defineConfig(
    globalIgnores(['**/doc/', 'jest.config.js', '**/coverage/', 'eslint.config.*js', '**/dist/']),
    eslint.configs.recommended,
    tseslint.configs.strictTypeChecked,
    {
        plugins: {
            tsdoc,
        },
        rules: {
            'tsdoc/syntax': 'error',
            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    'caughtErrors': 'none',
                }
            ],
            '@typescript-eslint/no-confusing-void-expression': [
                'error', {
                    'ignoreArrowShorthand': true,
                },
            ],
            '@typescript-eslint/no-unnecessary-condition': [
                'error',
                {
                    'allowConstantLoopConditions': 'only-allowed-literals',
                },
            ],
            '@typescript-eslint/no-invalid-void-type': [
                'error',
                {
                    allowAsThisParameter: true,
                },
            ],
        },
        languageOptions: {
            parserOptions: {
                projectService: true,
            },
        },
    },
    // {

    //     files: ['tests/**'],
    //     plugins: { jest },
    //     languageOptions: {
    //         globals: jest.environments.globals.globals,
    //     },
    //     rules: {
    //         ...jest.configs['flat/recommended'].rules,
    //         ...jest.configs['flat/style'].rules,
    //         'jest/unbound-method': 'error',
    //         '@typescript-eslint/unbound-method': 'off',
    //     },
    // },
);
