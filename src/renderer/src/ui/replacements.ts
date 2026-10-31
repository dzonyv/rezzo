/**
 * The replacement list as the page sees it, kept in the app settings so
 * every project shares it. Also the offer to add a rule right after a
 * correction that could have been one.
 */
import i18n from 'i18next';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { Replacement } from '../../../shared/replacements.ts';
import { notify } from './prompts.ts';

interface ReplacementsState {
  dialogOpen: boolean;
  /** A rule learned from the last correction, offered for a few seconds. */
  offer: Replacement | null;
}

export const replacementsStore = createStore<ReplacementsState>()(() => ({ dialogOpen: false, offer: null }));

export function useReplacements<T>(select: (s: ReplacementsState) => T): T {
  return useStore(replacementsStore, select);
}

export const openReplacements = (open: boolean): void => replacementsStore.setState({ dialogOpen: open });

const OFFER_MS = 8000;
let offerTimer: ReturnType<typeof setTimeout> | undefined;

export function offerRule(rule: Replacement | null): void {
  clearTimeout(offerTimer);
  replacementsStore.setState({ offer: rule });
  if (rule) offerTimer = setTimeout(() => replacementsStore.setState({ offer: null }), OFFER_MS);
}

export async function loadRules(): Promise<Replacement[]> {
  return (await window.rezzo.invoke('settings:get')).replacements;
}

/** Saves the list; rows left without a word to replace are dropped. */
export async function saveRules(rules: readonly Replacement[]): Promise<void> {
  await window.rezzo.invoke('settings:set', { replacements: rules.filter((r) => r.from.trim() !== '') });
}

/** Adds the offered rule to the list, in place of any rule for the same word. */
export async function acceptOffer(): Promise<void> {
  const rule = replacementsStore.getState().offer;
  offerRule(null);
  if (!rule) return;
  const rules = (await loadRules()).filter((r) => r.from.toLowerCase() !== rule.from);
  await saveRules([...rules, rule]);
  notify('info', i18n.t('replacements.added', { from: rule.from, to: rule.to }));
}
