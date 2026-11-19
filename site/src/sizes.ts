// The `sizes` attribute for screenshots, so the browser picks a file no
// wider than the picture shows.

/** In a full .wrap: 1280 px at most, 24 px gutters (16 px below 720 px wide). */
export const wideSizes = '(min-width: 1280px) 1232px, (min-width: 720px) calc(100vw - 48px), calc(100vw - 32px)';

/** In .narrow: 800 px at most, gutters included. */
export const narrowSizes = '(min-width: 800px) 752px, (min-width: 720px) calc(100vw - 48px), calc(100vw - 32px)';
