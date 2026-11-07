import { useTranslation } from 'react-i18next';
import { UI_LANGUAGES } from '../../../shared/settings.ts';

/** The interface language, as one button per language. */
export function LanguagePicker() {
  const { t, i18n } = useTranslation();
  return (
    <div className="language">
      <span id="ui-language">{t('settings.uiLanguage')}</span>
      <div className="segmented" role="group" aria-labelledby="ui-language">
        {UI_LANGUAGES.map((lng) => (
          <button
            key={lng}
            type="button"
            aria-pressed={i18n.language === lng}
            title={t(`language.${lng}`)}
            onClick={() => void window.rezzo.invoke('settings:set', { uiLanguage: lng })}
          >
            {t(`languageShort.${lng}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
