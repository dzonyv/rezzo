/** What the caption styles and the cover templates the user saves have in common: a name to save under, and a way to delete one. */
import { useState, type ReactNode } from 'react';

/** `list` with `item` in it, in place of one of the same name. */
export const withNamed = <T extends { name: string }>(list: readonly T[], item: T): T[] => [...list.filter((s) => s.name !== item.name), item];

/** The cross on a saved item's delete button. */
export function DeleteIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

interface Props {
  /** The name field's label and placeholder. */
  label: string;
  /** The save button's text. */
  button: string;
  /** Nothing to save yet. */
  disabled?: boolean;
  /** Saves under the trimmed name; resolves true when it did, and the field empties. */
  onSave: (name: string) => Promise<boolean>;
  /** More buttons on the same row. */
  children?: ReactNode;
}

/** A name field and a button that saves under it; Enter saves too. */
export function NameAndSave({ label, button, disabled = false, onSave, children }: Props) {
  const [name, setName] = useState('');
  const save = async () => {
    const n = name.trim();
    if (!n || disabled) return;
    if (await onSave(n)) setName('');
  };
  return (
    <div className="caption-row">
      <input aria-label={label} placeholder={label} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} />
      <button type="button" disabled={disabled || !name.trim()} onClick={() => void save()}>
        {button}
      </button>
      {children}
    </div>
  );
}
