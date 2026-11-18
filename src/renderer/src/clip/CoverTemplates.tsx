import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BUILT_IN_TEMPLATES, templateOf, type CoverTemplate } from '../../../shared/cover-template.ts';
import type { Cover } from '../../../shared/project.ts';
import { applyCoverTemplate } from '../project/cover.ts';
import { setSettings, useSettings } from '../settings.ts';
import { notify } from '../ui/prompts.ts';

/**
 * The cover templates: the ones that come with the app and the user's own.
 * Pressing one puts it on the cover; the cover as it is can be saved as one.
 */
export function CoverTemplates({ clipId, cover }: { clipId: string; cover: Cover }) {
  const { t } = useTranslation();
  const saved = useSettings((s) => s.coverTemplates) ?? [];
  const [name, setName] = useState('');
  const use = (template: CoverTemplate) => applyCoverTemplate(clipId, template, t('cover.placeholder'));

  const save = async () => {
    const n = name.trim();
    if (!n) return;
    try {
      await setSettings({ coverTemplates: [...saved.filter((s) => s.name !== n), { name: n, template: templateOf(cover) }] });
      setName('');
      notify('info', t('cover.templateSaved', { name: n }));
    } catch {
      notify('error', t('cover.templateSaveFailed'));
    }
  };
  const remove = (n: string) => void setSettings({ coverTemplates: saved.filter((s) => s.name !== n) }).catch(() => notify('error', t('cover.templateSaveFailed')));

  return (
    <section className="cover-templates">
      <h3>{t('cover.templates')}</h3>
      <div className="cover-template-list" role="group" aria-label={t('cover.templates')}>
        {BUILT_IN_TEMPLATES.map((b) => (
          <button key={b.id} type="button" onClick={() => use(b.template)}>
            {t(`cover.templateNames.${b.id}` as 'cover.templateNames.classic')}
          </button>
        ))}
        {saved.map((s) => (
          <div key={s.name} className="saved">
            <button type="button" title={s.name} onClick={() => use(s.template)}>
              {s.name}
            </button>
            <button type="button" className="icon" aria-label={t('cover.deleteTemplate', { name: s.name })} title={t('cover.deleteTemplate', { name: s.name })} onClick={() => remove(s.name)}>
              <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
                <path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" strokeWidth="1.6" />
              </svg>
            </button>
          </div>
        ))}
      </div>
      <p className="dim hint">{t('cover.templatesHelp')}</p>
      <div className="caption-row">
        <input
          aria-label={t('cover.templateName')}
          placeholder={t('cover.templateName')}
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void save()}
        />
        <button type="button" disabled={!name.trim()} onClick={() => void save()}>
          {t('cover.saveTemplate')}
        </button>
      </div>
    </section>
  );
}
