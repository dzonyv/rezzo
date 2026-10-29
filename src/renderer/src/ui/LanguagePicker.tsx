import { useTranslation } from 'react-i18next';
import { UI_LANGUAGES, type UiLanguage } from '../../../shared/settings.ts';

export function LanguagePicker() {
  const { t, i18n } = useTranslation();
  return (
    <label className="language">
      {t('settings.uiLanguage')}
      <select
        value={i18n.language}
        onChange={(e) => void window.rezzo.invoke('settings:set', { uiLanguage: e.target.value as UiLanguage })}
      >
        {UI_LANGUAGES.map((lng) => (
          <option key={lng} value={lng}>
            {t(`language.${lng}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
