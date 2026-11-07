import { useTranslation } from 'react-i18next';
import icon from '../../../../resources/icon.svg?url';

/** The app's icon and name, as at the start of the top bar. */
export function Brand() {
  const { t } = useTranslation();
  return (
    <span className="brand">
      <img src={icon} alt="" />
      {t('app.name')}
    </span>
  );
}
