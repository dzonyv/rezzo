import type { Lang } from '../i18n.ts';
import { en } from './en.ts';
import { sr, type Text } from './sr.ts';

export const text: Record<Lang, Text> = { sr, en };
export type { Text };
