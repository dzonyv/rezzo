import { useTranslation } from 'react-i18next';
import { UI_LANGUAGES, type UiLanguage } from '../../shared/settings.ts';

export function App() {
  const { t, i18n } = useTranslation();

  return (
    <main className="home">
      <h1>{t('app.name')}</h1>
      <p className="tagline">{t('app.tagline')}</p>

      <div className="actions">
        <button type="button" disabled>
          {t('home.newProject')}
        </button>
        <button type="button" disabled>
          {t('home.openProject')}
        </button>
      </div>

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
    </main>
  );
}
