import { defineConfig } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import prettier from 'eslint-config-prettier/flat';
import root from '../../eslint.config.mjs';

export default defineConfig([...root, ...nextVitals, prettier]);
