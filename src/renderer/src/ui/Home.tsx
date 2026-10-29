import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RecentProject, RecoveredProject } from '../../../shared/api.ts';
import { createProject, openProject, restoreProject } from '../project/actions.ts';
import { LanguagePicker } from './LanguagePicker.tsx';

export function Home() {
  const { t, i18n } = useTranslation();
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const [recovered, setRecovered] = useState<RecoveredProject[]>([]);

  useEffect(() => {
    void window.rezzo.invoke('project:recent').then(setRecent);
    void window.rezzo.invoke('project:recovered').then(setRecovered);
  }, []);

  const discard = async (id: string) => {
    await window.rezzo.invoke('project:discard-recovery', id);
    setRecovered((list) => list.filter((r) => r.project.id !== id));
  };

  const when = (iso: string) =>
    new Date(iso).toLocaleString(i18n.language === 'sh' ? 'sr-Latn' : 'en', { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <main
      className="home"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) void createProject(window.rezzo.pathForFile(file));
      }}
    >
      <h1>{t('app.name')}</h1>
      <p className="tagline">{t('app.tagline')}</p>

      <div className="actions">
        <button type="button" className="primary" onClick={() => void createProject()}>
          {t('home.newProject')}
        </button>
        <button type="button" onClick={() => void openProject()}>
          {t('home.openProject')}
        </button>
      </div>
      <p className="hint">{t('home.dropHint')}</p>

      {recovered.length > 0 && (
        <section className="home-list recovered">
          <h2>{t('home.recovered')}</h2>
          <ul>
            {recovered.map((r) => (
              <li key={r.project.id}>
                <span className="name">{r.project.name}</span>
                <span className="meta">{when(r.savedAt)}</span>
                <button type="button" onClick={() => void restoreProject(r.project, r.filePath)}>
                  {t('home.restore')}
                </button>
                <button type="button" onClick={() => void discard(r.project.id)}>
                  {t('home.discard')}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {recent.length > 0 && (
        <section className="home-list">
          <h2>{t('home.recent')}</h2>
          <ul>
            {recent.map((r) => (
              <li key={r.path}>
                <button type="button" className="link" title={r.path} onClick={() => void openProject(r.path)}>
                  <span className="name">{r.name}</span>
                  <span className="meta">{r.path}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <LanguagePicker />
    </main>
  );
}
