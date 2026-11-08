import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SOUND_GROUPS, SOUND_NAMES, SOUNDS, type SoundName } from '../../../shared/sounds.ts';
import { addLayerFile } from '../project/assets.ts';
import { addLibrarySound } from '../project/layers.ts';
import { listen, loadLibrarySound, stopListening } from '../render/sound-files.ts';
import { notify } from '../ui/prompts.ts';
import { pauseClip } from './playback.ts';
import { selectLayer } from './state.ts';

const PLAY = 'M6 4.5v9l7.5-4.5z';
const STOP = 'M5.5 5.5h7v7h-7z';

/**
 * The sound effects that come with the app, by group, and a button for a
 * sound file of your own. ▶ plays an effect to hear it; pressing its name
 * adds it at the playhead.
 */
export function SoundLibrary({ clipId, time }: { clipId: string; time: number }) {
  const { t } = useTranslation();
  const [playing, setPlaying] = useState<SoundName | null>(null);
  useEffect(() => stopListening, []);

  const hear = async (name: SoundName) => {
    if (playing === name) {
      stopListening();
      return;
    }
    try {
      const buffer = await loadLibrarySound(name);
      pauseClip();
      listen(buffer, () => setPlaying((p) => (p === name ? null : p)));
      setPlaying(name);
    } catch (e) {
      notify('error', t('sounds.errors.play', { detail: e instanceof Error ? e.message : String(e) }));
    }
  };
  const add = (name: SoundName) => {
    pauseClip();
    stopListening();
    const id = addLibrarySound(clipId, name, time);
    if (id) selectLayer(id);
  };
  const addFile = async () => {
    pauseClip();
    stopListening();
    const id = await addLayerFile('audio', clipId, time);
    if (id) selectLayer(id);
  };

  return (
    <div className="sound-library">
      <button type="button" className="tile own-sound" title={t('sounds.ownFileHelp')} onClick={() => void addFile()}>
        {t('sounds.ownFile')}
      </button>
      <div className="sound-groups">
        {SOUND_GROUPS.map((group) => (
          <div key={group} className="sound-group" role="group" aria-label={t(`sounds.groups.${group}`)}>
            <h4 className="sound-group-name">{t(`sounds.groups.${group}`)}</h4>
            {SOUND_NAMES.filter((name) => SOUNDS[name].group === group).map((name) => (
              <div key={name} className="sound-item">
                <button
                  type="button"
                  className="icon listen"
                  aria-pressed={playing === name}
                  aria-label={t('sounds.listen', { name: t(`sounds.names.${name}`) })}
                  title={t('sounds.listen', { name: t(`sounds.names.${name}`) })}
                  onClick={() => void hear(name)}
                >
                  <svg width="14" height="14" viewBox="0 0 18 18" aria-hidden="true">
                    <path d={playing === name ? STOP : PLAY} fill="currentColor" />
                  </svg>
                </button>
                <button type="button" className="add" title={t('sounds.addHelp')} onClick={() => add(name)}>
                  {t(`sounds.names.${name}`)}
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
