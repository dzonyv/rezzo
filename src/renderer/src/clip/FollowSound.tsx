import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AudioAsset } from '../../../shared/assets.ts';
import { suggestedSound } from '../../../shared/follow-sounds.ts';
import type { PlacedLayer, SoundLayer } from '../../../shared/project.ts';
import { SOUND_GROUPS, SOUND_NAMES, SOUNDS, type FollowPart, type SoundName } from '../../../shared/sounds.ts';
import { addFollowSoundFile } from '../project/assets.ts';
import { setFollowSound, setFollowSoundAsset } from '../project/layers.ts';
import { listen, loadLibrarySound, loadSoundFile, stopListening } from '../render/sound-files.ts';
import { notify } from '../ui/prompts.ts';
import { pauseClip } from './playback.ts';

const PLAY = 'M6 4.5v9l7.5-4.5z';
const STOP = 'M5.5 5.5h7v7h-7z';

/** What the picker's options stand for: no sound, one from the library, one of the project's files, or a new file to pick. */
const NONE = '';
const PICK_FILE = 'file';
const libraryValue = (name: SoundName) => `library:${name}`;
const assetValue = (id: string) => `asset:${id}`;

interface Props {
  clipId: string;
  layer: PlacedLayer;
  part: FollowPart;
  /** The sound that goes with this part now, if any. */
  sound: SoundLayer | null;
  /** The project's sound files, to pick one again. */
  files: readonly AudioAsset[];
}

/**
 * The sound that goes with a layer's entrance or exit: none, one from the
 * library (the one that suits the animation first), one of the project's
 * sound files, or a new file. ▶ plays it.
 */
export function FollowSound({ clipId, layer, part, sound, files }: Props) {
  const { t } = useTranslation();
  const [playing, setPlaying] = useState(false);
  useEffect(() => stopListening, []);
  const suggested = suggestedSound(layer, part);
  const source = sound?.sound;
  const value = !source ? NONE : 'library' in source ? libraryValue(source.library) : assetValue(source.assetId);
  const asset = source && 'assetId' in source ? files.find((f) => f.id === source.assetId) : undefined;

  const pick = async (next: string) => {
    stopListening();
    if (next === PICK_FILE) {
      pauseClip();
      await addFollowSoundFile(clipId, layer.id, part);
    } else if (next.startsWith('asset:')) setFollowSoundAsset(clipId, layer.id, part, next.slice('asset:'.length));
    else setFollowSound(clipId, layer.id, part, next === NONE ? null : (next.slice('library:'.length) as SoundName));
  };

  const hear = async () => {
    if (playing) {
      stopListening();
      return;
    }
    const load = source && 'library' in source ? () => loadLibrarySound(source.library) : asset ? () => loadSoundFile(asset) : null;
    if (!load) return;
    try {
      const buffer = await load();
      pauseClip();
      listen(buffer, () => setPlaying(false));
      setPlaying(true);
    } catch (e) {
      notify('error', t('sounds.errors.play', { detail: e instanceof Error ? e.message : String(e) }));
    }
  };

  const label = t(`sounds.follow.${part}`);
  return (
    <div className="follow-sound">
      <label>
        <span>{label}</span>
        <select value={value} onChange={(e) => void pick(e.target.value)}>
          <option value={NONE}>{t('sounds.follow.none')}</option>
          {suggested && (
            <optgroup label={t('sounds.follow.suggested')}>
              <option value={libraryValue(suggested)}>{t(`sounds.names.${suggested}`)}</option>
            </optgroup>
          )}
          {SOUND_GROUPS.map((group) => (
            <optgroup key={group} label={t(`sounds.groups.${group}`)}>
              {SOUND_NAMES.filter((name) => SOUNDS[name].group === group && name !== suggested).map((name) => (
                <option key={name} value={libraryValue(name)}>
                  {t(`sounds.names.${name}`)}
                </option>
              ))}
            </optgroup>
          ))}
          {files.length > 0 && (
            <optgroup label={t('sounds.follow.files')}>
              {files.map((f) => (
                <option key={f.id} value={assetValue(f.id)}>
                  {f.name}
                </option>
              ))}
            </optgroup>
          )}
          <option value={PICK_FILE}>{t('sounds.ownFile')}</option>
        </select>
      </label>
      {sound && (
        <button
          type="button"
          className="icon listen"
          aria-pressed={playing}
          aria-label={t('sounds.follow.listen', { part: label })}
          title={t('sounds.follow.listen', { part: label })}
          onClick={() => void hear()}
        >
          <svg width="14" height="14" viewBox="0 0 18 18" aria-hidden="true">
            <path d={playing ? STOP : PLAY} fill="currentColor" />
          </svg>
        </button>
      )}
    </div>
  );
}
