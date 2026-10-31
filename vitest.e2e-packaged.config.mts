import { defineConfig, mergeConfig } from 'vitest/config';
import e2e from './vitest.e2e.config.mts';

// The end-to-end tests against the installed layout, after `npm run pack`:
// the app from its asar archive and FFmpeg from resources/tools.
export default mergeConfig(
  e2e,
  defineConfig({
    test: {
      env: { REZZO_E2E_EXECUTABLE: 'release/win-unpacked/Rezzo.exe' },
    },
  }),
);
