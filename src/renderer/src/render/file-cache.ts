/**
 * Files the layers show, read once per file and shared by the preview and
 * the export: images (render/images.ts) and animations (render/lottie.ts).
 * Kept by fingerprint and path, so a file found somewhere else is read
 * again from there.
 */
import type { AssetFile } from '../../../shared/assets.ts';

const key = (file: AssetFile) => `${file.fingerprint}:${file.path}`;

export class FileCache<T> {
  private readonly entries = new Map<string, Promise<T>>();
  private readonly read: (url: string) => Promise<T>;
  private readonly release: (value: T) => void;

  /** `read` turns the file at a URL into what's kept; `release` frees it once it's let go of. */
  constructor(read: (url: string) => Promise<T>, release: (value: T) => void = () => {}) {
    this.read = read;
    this.release = release;
  }

  /**
   * The file's contents. Rejects when the file isn't there any more, even
   * if it was read before, so the preview shows what the export and the
   * next start of the app will.
   */
  async load(file: AssetFile): Promise<T> {
    if ((await window.rezzo.invoke('asset:check', file)) === 'missing') throw new Error(`${file.path} is missing`);
    const k = key(file);
    let loading = this.entries.get(k);
    if (!loading) {
      loading = window.rezzo.invoke('asset:url', file).then(this.read);
      // A failure isn't kept: the file may be back (or found) next time.
      loading.catch(() => this.entries.delete(k));
      this.entries.set(k, loading);
    }
    return loading;
  }

  /** Puts contents just read (when the file was added) where load() will find them. */
  put(file: AssetFile, value: T): void {
    this.entries.set(key(file), Promise.resolve(value));
  }

  /**
   * Lets go of everything except the contents of `files` (the open
   * project's assets); a closed project keeps nothing. A file needed again
   * later is read again.
   */
  keepOnly(files: readonly AssetFile[]): void {
    const wanted = new Set(files.map(key));
    for (const [k, loading] of this.entries) {
      if (wanted.has(k)) continue;
      this.entries.delete(k);
      loading.then(this.release, () => {});
    }
  }
}
