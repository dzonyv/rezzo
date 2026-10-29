import type { RezzoApi } from '../../shared/api.ts';
import type en from '../../shared/locales/en.json';

declare global {
  interface Window {
    /** Exposed by the preload script; see shared/api.ts. */
    rezzo: RezzoApi;
  }
}

// Type-checked translation keys: t('home.newProject') compiles, a typo doesn't.
declare module 'i18next' {
  interface CustomTypeOptions {
    resources: { translation: typeof en };
  }
}
