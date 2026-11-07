import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipEditor } from '../clip/ClipEditor.tsx';
import { useOpenClip } from '../clip/state.ts';
import { closeProject, save } from '../project/actions.ts';
import { isDirty, projectStore, useProject } from '../project/store.ts';
import { EpisodePlayer } from '../player/EpisodePlayer.tsx';
import { pauseEpisode } from '../player/playback.ts';
import { TranscriptView } from '../transcript/TranscriptView.tsx';
import { Brand } from './Brand.tsx';
import { ClipList } from './ClipList.tsx';
import { ReplacementsDialog } from './ReplacementsDialog.tsx';
import { SourcePanel } from './SourcePanel.tsx';
import { TranscribePanel } from './TranscribePanel.tsx';
import { VoicesPanel } from './VoicesPanel.tsx';

export function Editor() {
  const { t } = useTranslation();
  const name = useProject((s) => s.project?.name ?? '');
  const project = useProject((s) => s.project);
  const dirty = useProject(isDirty);
  const undoLabel = useProject((s) => s.undoLabel);
  const redoLabel = useProject((s) => s.redoLabel);
  const openClip = useOpenClip();
  const store = projectStore.getState();
  const clipOpen = openClip !== null && project?.source != null;
  const transcript =
    project?.source && project.transcript ? (
      <TranscriptView transcript={project.transcript} source={project.source} />
    ) : (
      <p className="transcript-empty">{t('transcript.empty')}</p>
    );

  // The episode stops when a clip opens: its player is hidden then.
  const openId = openClip?.id;
  useEffect(() => {
    if (openId) pauseEpisode();
  }, [openId]);

  return (
    <div className="editor">
      <header className="topbar">
        <Brand />
        <input
          className="project-name"
          aria-label={t('editor.projectName')}
          value={name}
          onFocus={() => store.beginGesture('history.rename')}
          onChange={(e) => store.edit('history.rename', (d) => void (d.name = e.target.value))}
          onBlur={() => store.endGesture()}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        {dirty && <span className="dirty" title={t('editor.unsavedMarker')} />}

        <div className="spacer" />

        <button
          type="button"
          disabled={!undoLabel}
          title={undoLabel ? t('editor.undoWhat', { what: t(undoLabel) }) : t('editor.undo')}
          onClick={() => store.undo()}
        >
          {t('editor.undo')}
        </button>
        <button
          type="button"
          disabled={!redoLabel}
          title={redoLabel ? t('editor.redoWhat', { what: t(redoLabel) }) : t('editor.redo')}
          onClick={() => store.redo()}
        >
          {t('editor.redo')}
        </button>
        <button type="button" onClick={() => void save(false)}>
          {t('editor.save')}
        </button>
        <button type="button" onClick={() => void save(true)}>
          {t('editor.saveAs')}
        </button>
        <button type="button" onClick={() => void closeProject()}>
          {t('editor.close')}
        </button>
      </header>
      <section className={clipOpen ? 'workspace with-clip' : 'workspace'}>
        {/* Hidden, not removed, while a clip is open: the episode keeps its player. The voices and the clips move into the clip editor. */}
        <div className="side" hidden={clipOpen}>
          {project?.source && <EpisodePlayer key={project.source.fingerprint} source={project.source} />}
          {project?.source && <SourcePanel source={project.source} />}
          {project?.source && !project.transcript && <TranscribePanel project={project} />}
          {!clipOpen && project?.source && project.transcript && <VoicesPanel project={project} />}
          {!clipOpen && project?.source && project.transcript && <ClipList />}
        </div>
        {openClip && project?.source ? (
          <ClipEditor
            key={openClip.id}
            clip={openClip}
            source={project.source}
            voices={project.transcript && <VoicesPanel project={project} />}
            side={
              <>
                <ClipList />
                {transcript}
              </>
            }
          />
        ) : (
          transcript
        )}
      </section>
      <ReplacementsDialog />
    </div>
  );
}
