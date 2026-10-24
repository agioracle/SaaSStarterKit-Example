import {defineConfig} from '@playwright/test';
import base from './playwright.config';
export default defineConfig({...base,testDir:'tests/privacy-browser',workers:1,use:{...base.use,trace:'off',screenshot:'off',video:'off'}});
