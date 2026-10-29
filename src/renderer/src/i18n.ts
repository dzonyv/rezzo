import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../../shared/locales/en.json';
import sh from '../../shared/locales/sh.json';
import type { UiLanguage } from '../../shared/settings.ts';

export function initI18n(language: UiLanguage): Promise<unknown> {
  return i18n.use(initReactI18next).init({
    resources: { en: { translation: en }, sh: { translation: sh } },
    lng: language,
    fallbackLng: 'en',
    interpolation: { escapeValue: false }, // React escapes already
  });
}

export function setLanguage(language: UiLanguage): void {
  void i18n.changeLanguage(language);
  document.documentElement.lang = language;
}
