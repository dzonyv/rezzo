import { useTranslation } from 'react-i18next';
import { BUILT_IN_TEMPLATES, templateOf, type CoverTemplate } from '../../../shared/cover-template.ts';
import type { Cover } from '../../../shared/project.ts';
import { applyCoverTemplate } from '../project/cover.ts';
import { setSettings, useSettings } from '../settings.ts';
import { notify } from '../ui/prompts.ts';
import { DeleteIcon, NameAndSave, withNamed } from './saved-items.tsx';

/**
 * The cover templates: the ones that come with the app and the user's own.
 * Pressing one puts it on the cover; the cover as it is can be saved as one.
 */
export function CoverTemplates({ clipId, cover }: { clipId: string; cover: Cover }) {
  const { t } = useTranslation();
  const saved = useSettings((s) => s.coverTemplates) ?? [];
  const use = (template: CoverTemplate) => applyCoverTemplate(clipId, template, t('cover.placeholder'));
  const builtInName = (id: string) => t(`cover.templateNames.${id}` as 'cover.templateNames.classic');
  const current = templateOf(cover);
  // A template of only images (or nothing) would just take the cutout and effects off a cover.
  const empty = current.layers.length === 0;

  const save = async (n: string) => {
    // A name like a built-in's would put two of the same name side by side.
    if (BUILT_IN_TEMPLATES.some((b) => builtInName(b.id).toLocaleLowerCase() === n.toLocaleLowerCase())) {
      notify('error', t('cover.templateNameTaken', { name: n }));
      return false;
    }
    try {
      await setSettings({ coverTemplates: withNamed(saved, { name: n, template: current }) });
      notify('info', t('cover.templateSaved', { name: n }));
      return true;
    } catch {
      notify('error', t('cover.templateSaveFailed'));
      return false;
    }
  };
  const remove = (n: string) => void setSettings({ coverTemplates: saved.filter((s) => s.name !== n) }).catch(() => notify('error', t('cover.templateSaveFailed')));

  return (
    <section className="cover-templates">
      <h3>{t('cover.templates')}</h3>
      <div className="cover-template-list" role="group" aria-label={t('cover.templates')}>
        {BUILT_IN_TEMPLATES.map((b) => (
          <button key={b.id} type="button" onClick={() => use(b.template)}>
            {builtInName(b.id)}
          </button>
        ))}
        {saved.map((s) => (
          <div key={s.name} className="saved">
            <button type="button" title={s.name} onClick={() => use(s.template)}>
              {s.name}
            </button>
            <button type="button" className="icon" aria-label={t('cover.deleteTemplate', { name: s.name })} title={t('cover.deleteTemplate', { name: s.name })} onClick={() => remove(s.name)}>
              <DeleteIcon />
            </button>
          </div>
        ))}
      </div>
      <p className="dim hint">{t('cover.templatesHelp')}</p>
      <NameAndSave label={t('cover.templateName')} button={t('cover.saveTemplate')} disabled={empty} onSave={save} />
      {empty && <p className="dim hint">{t('cover.templateEmpty')}</p>}
    </section>
  );
}
