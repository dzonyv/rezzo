import { useTranslation } from 'react-i18next';
import { closeProject, save } from '../project/actions.ts';
import { isDirty, projectStore, useProject } from '../project/store.ts';
import { SourcePanel } from './SourcePanel.tsx';
import { TranscribePanel } from './TranscribePanel.tsx';

export function Editor() {
  const { t } = useTranslation();
  const name = useProject((s) => s.project?.name ?? '');
  const project = useProject((s) => s.project);
  const dirty = useProject(isDirty);
  const undoLabel = useProject((s) => s.undoLabel);
  const redoLabel = useProject((s) => s.redoLabel);
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
      <section className="workspace">
        {project?.source && <SourcePanel source={project.source} />}
        {project?.source && !project.transcript && <TranscribePanel project={project} />}
        {project?.transcript && (
          <p className="transcript-summary">
            {t('transcribe.words', { count: project.transcript.segments.reduce((n, s) => n + s.words.length, 0) })}
          </p>
        )}
      </section>
    </div>
  );
}
