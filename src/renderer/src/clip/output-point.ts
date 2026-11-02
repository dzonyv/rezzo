import { OUTPUT } from '../../../shared/framing.ts';

/** A pointer position in output pixels, over an element that covers the whole preview. */
export function outputPoint(el: Element, clientX: number, clientY: number): { x: number; y: number } {
  const box = el.getBoundingClientRect();
  return { x: ((clientX - box.left) / box.width) * OUTPUT.width, y: ((clientY - box.top) / box.height) * OUTPUT.height };
}
