import { useTranslation } from 'react-i18next';
import { ClipEditor } from '../clip/ClipEditor.tsx';
import { useOpenClip } from '../clip/state.ts';
import { closeProject, save } from '../project/actions.ts';
import { isDirty, projectStore, useProject } from '../project/store.ts';
import { EpisodePlayer } from '../player/EpisodePlayer.tsx';
import { TranscriptView } from '../transcript/TranscriptView.tsx';
import { ClipList } from './ClipList.tsx';
import { ReplacementsDialog } from './ReplacementsDialog.tsx';
import { SourcePanel } from './SourcePanel.tsx';
import { TranscribePanel } from './TranscribePanel.tsx';

export function Editor() {
  const { t } = useTranslation();
  const name = useProject((s) => s.project?.name ?? '');
  const project = useProject((s) => s.project);
  const dirty = useProject(isDirty);
  const undoLabel = useProject((s) => s.undoLabel);
  const redoLabel = useProject((s) => s.redoLabel);
  const openClip = useOpenClip();
  const store = projectStore.getState();

  return (
    <div className="editor">
      <header className="topbar">
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
      <section className={openClip ? 'workspace with-clip' : 'workspace'}>
        <div className="side">
          {project?.source && <EpisodePlayer key={project.source.fingerprint} source={project.source} />}
          {project?.source && <SourcePanel source={project.source} />}
          {project?.source && !project.transcript && <TranscribePanel project={project} />}
          {project?.source && project.transcript && <ClipList />}
        </div>
        {project?.source && project.transcript ? (
          <TranscriptView transcript={project.transcript} source={project.source} />
        ) : (
          <p className="transcript-empty">{t('transcript.empty')}</p>
        )}
        {openClip && project?.source && <ClipEditor key={openClip.id} clip={openClip} source={project.source} />}
      </section>
      <ReplacementsDialog />
    </div>
  );
}
