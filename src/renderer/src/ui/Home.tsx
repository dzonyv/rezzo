import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { version } from '../../../../package.json';
import type { RecentProject, RecoveredProject } from '../../../shared/api.ts';
import { createProject, openProject, restoreProject } from '../project/actions.ts';
import { ChangelogDialog } from './ChangelogDialog.tsx';
import { LanguagePicker } from './LanguagePicker.tsx';
import { shortName } from './short-name.ts';

/** Names, not words to translate. */
const REPOSITORY = { name: 'GitHub', url: 'https://github.com/dzonyv/rezzo' };
const AUTHOR = { name: 'Nikola', url: 'https://github.com/dzonyv' };

/**
 * The first screen: a big yellow slab to drop a video on (cut like the
 * icon), and beside it unsaved work from last time and recent projects.
 */
export function Home() {
  const { t, i18n } = useTranslation();
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const [recovered, setRecovered] = useState<RecoveredProject[]>([]);
  const [changelog, setChangelog] = useState(false);

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
      <section className="hero" aria-labelledby="home-title">
        <div className="slab lower" aria-hidden="true" />
        <div className="slab" aria-hidden="true" />
        <div className="hero-content">
          <span className="wordmark">{t('app.name')}</span>
          <h1 id="home-title">{t('home.drop')}</h1>
          <p className="tagline">{t('app.tagline')}</p>
          <div className="actions">
            <button type="button" className="on-slab" onClick={() => void createProject()}>
              {t('home.newProject')}
            </button>
            <button type="button" className="on-slab outline" onClick={() => void openProject()}>
              {t('home.openProject')}
            </button>
          </div>
        </div>
        {/* On the slab's lower part. Links open in the browser (see setWindowOpenHandler in main). */}
        <footer className="hero-foot">
          <div className="about">
            <span>{t('home.free')}</span>
            <div className="credits">
              <span>
                {t('home.madeBy')}{' '}
                <a href={AUTHOR.url} target="_blank" rel="noreferrer">
                  {AUTHOR.name}
                </a>
              </span>
              <nav className="links" aria-label={t('home.links')}>
                <a href={REPOSITORY.url} target="_blank" rel="noreferrer">
                  {REPOSITORY.name}
                </a>
                <a href={`${REPOSITORY.url}/issues/new`} target="_blank" rel="noreferrer">
                  {t('home.report')}
                </a>
                <button type="button" className="link" onClick={() => void window.rezzo.invoke('app:licenses')}>
                  {t('home.licenses')}
                </button>
              </nav>
            </div>
          </div>
          {/* In the corner, where a version is looked for. */}
          <button
            type="button"
            className="version"
            title={t('home.changelog')}
            aria-description={t('home.changelog')}
            onClick={() => setChangelog(true)}
          >
            {version}
          </button>
        </footer>
      </section>

      <aside className="home-side">
        {recovered.length > 0 && (
          <section className="recovered">
            <h2>{t('home.recovered')}</h2>
            <ul>
              {recovered.map((r) => (
                <li key={r.project.id}>
                  <span className="text">
                    <span className="name">{r.project.name}</span>
                    <span className="meta">{when(r.savedAt)}</span>
                  </span>
                  <button type="button" className="primary" onClick={() => void restoreProject(r.project, r.filePath)}>
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

        <section className="recent">
          <h2>{t('home.recent')}</h2>
          {recent.length === 0 ? (
            <p className="dim">{t('home.noRecent')}</p>
          ) : (
            <ul>
              {recent.map((r) => (
                <li key={r.path}>
                  <button type="button" className="project" title={r.path} onClick={() => void openProject(r.path)}>
                    <span className="badge" aria-hidden="true">
                      {shortName(r.name)}
                    </span>
                    <span className="text">
                      <span className="name">{r.name}</span>
                      <span className="meta">{r.path}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <LanguagePicker />
      </aside>
      <ChangelogDialog open={changelog} onClose={() => setChangelog(false)} />
    </main>
  );
}
