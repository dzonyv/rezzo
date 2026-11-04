import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { HeardVoice, VoiceTurn } from '../../../shared/voices.ts';
import { correctTurn, mergeVoice, splitTurn } from '../project/voices.ts';
import { voiceColor, voiceLabel } from '../voice-colors.ts';

interface Props {
  turn: VoiceTurn;
  /** Source seconds under the pointer, where "Split here" splits. */
  at: number;
  /** Where the menu opens, in window pixels. */
  x: number;
  y: number;
  voices: readonly HeardVoice[];
  onClose: () => void;
}

/** A voice with its colour, for a menu item. */
function VoiceItem({ voice, onClick }: { voice: HeardVoice; onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button type="button" onClick={onClick}>
      <span className="voice-chip" style={{ background: voiceColor(voice.id) }} />
      {voiceLabel(t, voice)}
    </button>
  );
}

/** What a right click on a turn in the Voices row offers. Every choice is one undo step. */
export function VoiceTurnMenu({ turn, at, x, y, voices, onClose }: Props) {
  const { t } = useTranslation();
  const menu = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState({ left: x, top: y });
  const others = voices.filter((v) => v.id !== turn.voice);
  const middle = (turn.start + turn.end) / 2;

  // The Voices row sits low in the window: keep the menu on screen.
  useLayoutEffect(() => {
    const box = menu.current!.getBoundingClientRect();
    setPlace({ left: Math.max(0, Math.min(x, window.innerWidth - box.width)), top: Math.max(0, Math.min(y, window.innerHeight - box.height)) });
  }, [x, y]);

  // The timeline draws on every frame of playback; that shouldn't touch these listeners.
  const close = useEffectEvent(onClose);
  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      close();
    };
    document.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, []);

  const then = (action: () => void) => () => {
    action();
    onClose();
  };

  return (
    <div ref={menu} className="turn-menu" role="menu" aria-label={t('voices.whoTalks')} style={place}>
      <h4>{t('voices.whoTalks')}</h4>
      {others.map((v) => (
        <VoiceItem key={v.id} voice={v} onClick={then(() => correctTurn(turn, v.at))} />
      ))}
      <button type="button" onClick={then(() => correctTurn(turn, 'new'))}>
        {t('voices.newVoice')}
      </button>
      <button type="button" onClick={then(() => correctTurn(turn, null))}>
        {t('voices.nobody')}
      </button>
      <button type="button" onClick={then(() => splitTurn(at))}>
        {t('voices.split')}
      </button>
      {others.length > 0 && <h4>{t('voices.wholeVoice')}</h4>}
      {others.map((v) => (
        <VoiceItem key={v.id} voice={v} onClick={then(() => mergeVoice(middle, v.at))} />
      ))}
    </div>
  );
}
