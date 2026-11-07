import type { UiLanguage } from './settings.ts';

/** One version of the app and what it brought, in every interface language. */
export interface Release {
  version: string;
  changes: Record<UiLanguage, string[]>;
}

/**
 * What changed in each version, newest first; shown when the version on
 * the home screen is clicked. Add an entry with every version bump: a test
 * checks the first one matches package.json.
 */
export const CHANGELOG: Release[] = [
  {
    version: '0.1.0',
    changes: {
      en: [
        'Transcription in Serbian, Croatian and Bosnian, with a time for every word, always in Latin script.',
        'Clips made by selecting words in the transcript, framed on one person, two stacked, or the whole picture.',
        'Word-by-word captions with styles and your own fonts.',
        'Layers over the picture: images, videos with green screen, Lottie animations and effects.',
        'Voices told apart, and the camera following whoever is talking.',
        'Pauses and words cut out of a clip.',
        'Export at 1080×1920 on the graphics card, with no watermark.',
      ],
      sh: [
        'Transkripcija na srpskom, hrvatskom i bosanskom, sa vremenom svake reči, uvek na latinici.',
        'Klipovi se prave izborom reči u transkriptu, sa kadrom na jednoj osobi, dve jednu iznad druge ili celom slikom.',
        'Titlovi reč po reč, sa stilovima i tvojim fontovima.',
        'Slojevi preko slike: slike, video sa zelenim platnom, Lottie animacije i efekti.',
        'Glasovi se razlikuju, a kadar prati onoga ko priča.',
        'Izbacivanje pauza i reči iz klipa.',
        'Izvoz u 1080×1920 preko grafičke kartice, bez watermarka.',
      ],
    },
  },
];
