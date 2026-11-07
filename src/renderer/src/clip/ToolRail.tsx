import { useTranslation } from 'react-i18next';
import { CLIP_TOOLS, setTool, type ClipTool } from './state.ts';

/** One line drawing per tool, on an 18×18 grid. */
const ICONS: Record<ClipTool, string> = {
  framing: 'M3 7V3h4M11 3h4v4M15 11v4h-4M7 15H3v-4',
  captions: 'M3 4.5h12a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 12V6A1.5 1.5 0 0 1 3 4.5zM5 9.5h4M11 9.5h2M5 11.5h8',
  layers: 'M9 2.5l6.5 3.25L9 9 2.5 5.75zM2.5 9L9 12.25 15.5 9M2.5 12.25L9 15.5l6.5-3.25',
  effects: 'M9 2v3.5M9 12.5V16M2 9h3.5M12.5 9H16M4.4 4.4l2.4 2.4M11.2 11.2l2.4 2.4M13.6 4.4l-2.4 2.4M6.8 11.2l-2.4 2.4',
  pauses: 'M6.5 4v10M11.5 4v10',
  voices: 'M3 8v2M6 5.5v7M9 3v12M12 6v6M15 8v2',
  text: 'M3 4h12M3 7.5h12M3 11h12M3 14.5h7',
};

/**
 * The column of tools left of the picture. Pressing one opens its drawer
 * beside the picture; pressing it again closes it. A tool in `alerts` gets
 * a dot, with the reason as its tooltip, so a warning inside a closed
 * drawer isn't missed.
 */
export function ToolRail({ tool, alerts = {} }: { tool: ClipTool | null; alerts?: Partial<Record<ClipTool, string>> }) {
  const { t } = useTranslation();
  return (
    <nav className="tool-rail" aria-label={t('tools.title')}>
      {CLIP_TOOLS.map((id) => (
        <button
          key={id}
          type="button"
          className={alerts[id] ? 'alert' : undefined}
          aria-pressed={tool === id}
          aria-description={alerts[id]}
          title={alerts[id] ?? t(`tools.help.${id}`)}
          onClick={() => setTool(tool === id ? null : id)}
        >
          <svg width="20" height="20" viewBox="0 0 18 18" aria-hidden="true">
            <path d={ICONS[id]} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {t(`tools.names.${id}`)}
        </button>
      ))}
    </nav>
  );
}
