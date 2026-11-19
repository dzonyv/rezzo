import pkg from '../../package.json' with { type: 'json' };

export interface ReleaseInfo {
  version: string;
  /** Installer size in bytes, or null when no published release has one. */
  size: number | null;
  /** The installer itself, or the releases page when there is no published release yet. */
  url: string;
  published: boolean;
}

const repo = 'dzonyv/rezzo';
export const repoUrl = `https://github.com/${repo}`;

let cached: Promise<ReleaseInfo> | undefined;

/**
 * The newest published release, read from GitHub once per build. A draft
 * doesn't count: GitHub doesn't show it to anyone else. Without one the site
 * shows the version in package.json and links to the releases page.
 */
export function latestRelease(): Promise<ReleaseInfo> {
  cached ??= load();
  return cached;
}

async function load(): Promise<ReleaseInfo> {
  const fallback: ReleaseInfo = { version: pkg.version, size: null, url: `${repoUrl}/releases`, published: false };
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'rezzo-site-build',
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers });
    if (!res.ok) {
      console.warn(`[release] no published release (${res.status}); using package.json ${pkg.version}`);
      return fallback;
    }
    const data = (await res.json()) as { tag_name: string; assets: { name: string; size: number; browser_download_url: string }[] };
    const installer = data.assets.find((a) => /^Rezzo-Setup-.+\.exe$/.test(a.name));
    if (!installer) {
      console.warn(`[release] ${data.tag_name} has no installer; using package.json ${pkg.version}`);
      return fallback;
    }
    return {
      version: data.tag_name.replace(/^v/, ''),
      size: installer.size,
      url: installer.browser_download_url,
      published: true,
    };
  } catch (error) {
    console.warn(`[release] couldn't reach GitHub (${String(error)}); using package.json ${pkg.version}`);
    return fallback;
  }
}
