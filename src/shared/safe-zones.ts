/**
 * Where each platform puts its own buttons and text over a vertical video,
 * so the editor can show what stays clear (render/SafeZoneOverlay.tsx).
 * Only the editor draws them; the export and the saved cover don't. The
 * numbers are pixels of the 1080×1920 picture, rounded up from the apps as
 * they were in late 2026; they change from one version of an app to the
 * next, so they're a guide rather than an exact line.
 */
import { OUTPUT } from './framing.ts';

export const PLATFORMS = ['tiktok', 'reels', 'shorts'] as const;
export type Platform = (typeof PLATFORMS)[number];

/** How far in from each edge the platform's interface reaches. */
export interface Margins {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export const SAFE_ZONES: Record<Platform, Margins> = {
  // The Following / For You tabs on top; the name, caption and sound at the bottom; likes, comments and shares on the right.
  tiktok: { top: 130, bottom: 440, left: 60, right: 140 },
  // The Reels title and camera on top; the name, caption and audio at the bottom; the buttons on the right.
  reels: { top: 220, bottom: 420, left: 60, right: 120 },
  // Search and the menu on top; the title, channel and subscribe at the bottom; the buttons on the right.
  shorts: { top: 150, bottom: 380, left: 60, right: 140 },
};

/** Instagram's profile grid shows a Reel's cover cut to 3:4, from the middle. */
export const GRID_ASPECT = 3 / 4;

/** A box as shares of the picture, 0..1. */
export interface UnitBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The part of the picture `platform` leaves clear, as shares of the picture. */
export function clearArea(platform: Platform): UnitBox {
  const m = SAFE_ZONES[platform];
  return {
    x: m.left / OUTPUT.width,
    y: m.top / OUTPUT.height,
    w: (OUTPUT.width - m.left - m.right) / OUTPUT.width,
    h: (OUTPUT.height - m.top - m.bottom) / OUTPUT.height,
  };
}

/** The part of the cover Instagram's profile grid shows, as shares of the picture. */
export function gridCrop(): UnitBox {
  const h = OUTPUT.width / GRID_ASPECT / OUTPUT.height;
  return { x: 0, y: (1 - h) / 2, w: 1, h };
}
