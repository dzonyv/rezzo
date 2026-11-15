/** Every word the promo shows, in both languages the app speaks. */
export type Lang = 'sh' | 'en';

export interface Copy {
  hook: [string, string];
  select: [string, string];
  languages: string;
  layouts: { full: string; split: string; follow: string };
  features: string[];
  tagline: string;
  platform: string;
  credit: string;
}

const credit = 'Tears of Steel (CC) Blender Foundation | mango.blender.org · CC BY 3.0';

export const COPY: Record<Lang, Copy> = {
  sh: {
    hook: ['Od cele epizode', 'do gotovog klipa'],
    select: ['Označi par rečenica', 'i već imaš klip'],
    languages: 'Svaka reč sa svojim vremenom, uvek na latinici',
    // Same words as the app's own buttons (src/shared/locales/sh.json).
    layouts: { full: 'Ceo kadar', split: 'Podeljeno', follow: 'Praćenje' },
    features: ['Titlovi reč po reč', 'Automatski kadar', 'Slojevi, efekti i zvuk', 'Bez watermarka'],
    tagline: 'Besplatan i open source',
    platform: 'Windows · GPL-3.0',
    credit: `Snimak: ${credit}`,
  },
  en: {
    hook: ['From a whole episode', 'to a finished clip'],
    select: ['Select a few sentences', 'and you have a clip'],
    languages: 'Every word with its timing, always in Latin script',
    layouts: { full: 'Full frame', split: 'Split', follow: 'Follow' },
    features: ['Word-by-word captions', 'Automatic framing', 'Layers, effects and sound', 'No watermark'],
    tagline: 'Free and open source',
    platform: 'Windows · GPL-3.0',
    credit: `Footage: ${credit}`,
  },
};
