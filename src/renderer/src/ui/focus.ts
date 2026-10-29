/** True when keys pressed in `el` are text input, which shortcuts must leave alone. */
export function isTypingTarget(el: EventTarget | null): boolean {
  return el instanceof HTMLElement && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
}
