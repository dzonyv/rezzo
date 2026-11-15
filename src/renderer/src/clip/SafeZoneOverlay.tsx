import { useTranslation } from 'react-i18next';
import { clearArea, gridCrop, type Platform, type UnitBox } from '../../../shared/safe-zones.ts';

const percent = (b: UnitBox) => ({ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` });

/**
 * Over the preview: the edges `platform` covers with its own buttons and
 * text, shaded, around the part that stays clear. On a Reel's cover, also
 * the part Instagram's profile grid shows. Only the editor shows it.
 */
export function SafeZoneOverlay({ platform, onCover }: { platform: Platform; onCover: boolean }) {
  const { t } = useTranslation();
  const clear = clearArea(platform);
  return (
    <div className="safe-zones" data-platform={platform}>
      <div className="clear" style={percent(clear)}>
        <span>{t(`safeZones.platforms.${platform}`)}</span>
      </div>
      {onCover && platform === 'reels' && (
        <div className="grid-crop" style={percent(gridCrop())}>
          <span>{t('safeZones.grid')}</span>
        </div>
      )}
    </div>
  );
}
