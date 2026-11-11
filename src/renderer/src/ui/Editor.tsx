import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipEditor } from '../clip/ClipEditor.tsx';
import { useOpenClip } from '../clip/state.ts';
import { closeProject, save } from '../project/actions.ts';
import { isDirty, projectStore, useProject } from '../project/store.ts';
import { EpisodePlayer } from '../player/EpisodePlayer.tsx';
import { pauseEpisode } from '../player/playback.ts';
import { Transport } from '../player/Transport.tsx';
import { TranscriptView } from '../transcript/TranscriptView.tsx';
import { Brand } from './Brand.tsx';
import { ClipList } from './ClipList.tsx';
import { EpisodeStrip } from './EpisodeStrip.tsx';
import { ReplacementsDialog } from './ReplacementsDialog.tsx';
import { SourcePanel } from './SourcePanel.tsx';
import { TranscribePanel } from './TranscribePanel.tsx';
import { VoicesPanel } from './VoicesPanel.tsx';

export function Editor() {
  const fingerprint = useProject((s) => s.project?.source?.fingerprint);
  // Leaving an episode (closing it, or opening another) stops what was being made for it.
  useEffect(() => {
    if (!fingerprint) return;
    return () => void window.rezzo.invoke('episode:stop', fingerprint);
  }, [fingerprint]);
  const { t } = useTranslation();
  const name = useProject((s) => s.project?.name ?? '');
  const project = useProject((s) => s.project);
  const dirty = useProject(isDirty);
  const undoLabel = useProject((s) => s.undoLabel);
  const redoLabel = useProject((s) => s.redoLabel);
  const openClip = useOpenClip();
  const store = projectStore.getState();
  const clipOpen = openClip !== null && project?.source != null;
  // Until there is a transcript, the video is big and the transcription panel stands beside it.
  const transcribing = project?.source != null && !project.transcript;
  // With one: the video on the left, the transcript, the clips on the right, and the whole episode under them.
  const episode = !clipOpen && project?.source != null && project.transcript != null;
  const transcript =
    project?.source && project.transcript ? (
      <TranscriptView transcript={project.transcript} source={project.source} />
    ) : project?.source ? (
      <TranscribePanel project={project} />
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
      <section className={clipOpen ? 'workspace with-clip' : transcribing ? 'workspace transcribing' : episode ? 'workspace episode' : 'workspace'}>
        {/* Hidden, not removed, while a clip is open: the episode keeps its player. The voices and the clips move into the clip editor. */}
        <div className="side" hidden={clipOpen}>
          {project?.source && <EpisodePlayer key={project.source.fingerprint} source={project.source} />}
          {project?.source && <Transport duration={project.source.duration} />}
          {episode && <VoicesPanel project={project} />}
          {project?.source && <SourcePanel source={project.source} />}
        </div>
        {openClip && project?.source && (
          <ClipEditor
            key={openClip.id}
            clip={openClip}
            source={project.source}
            voices={project.transcript && <VoicesPanel project={project} />}
            side={<ClipList strip />}
          />
        )}
        {/* In the same place with a clip open or not, so it keeps its scroll, search and selection. Before there is one, the transcription panel. */}
        {transcript}
        {episode && (
          <aside className="episode-clips">
            <ClipList />
          </aside>
        )}
      </section>
      {/* Also under the transcription screen: the only way to go somewhere in the video before there is a transcript. */}
      {!clipOpen && project?.source && <EpisodeStrip duration={project.source.duration} clips={project.clips} />}
      <ReplacementsDialog />
    </div>
  );
}
