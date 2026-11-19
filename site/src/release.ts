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
 * The newest published release that has an installer, read from GitHub once
 * per build. Not GitHub's "latest": that can be a release holding only model
 * files. Drafts and pre-releases don't count; GitHub shows drafts to no one
 * else. Without one the site shows the version in package.json and links to
 * the releases page.
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
    const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=50`, { headers });
    if (!res.ok) {
      console.warn(`[release] couldn't list releases (${res.status}); using package.json ${pkg.version}`);
      return fallback;
    }
    type Release = {
      tag_name: string;
      draft: boolean;
      prerelease: boolean;
      published_at: string | null;
      assets: { name: string; size: number; browser_download_url: string }[];
    };
    const installerOf = (r: Release) => r.assets.find((a) => /^Rezzo-Setup-.+\.exe$/.test(a.name));
    const newest = ((await res.json()) as Release[])
      .filter((r) => !r.draft && !r.prerelease && r.published_at && installerOf(r))
      .sort((a, b) => Date.parse(b.published_at!) - Date.parse(a.published_at!))[0];
    const installer = newest && installerOf(newest);
    if (!newest || !installer) {
      console.warn(`[release] no published release with an installer; using package.json ${pkg.version}`);
      return fallback;
    }
    return {
      version: newest.tag_name.replace(/^v/, ''),
      size: installer.size,
      url: installer.browser_download_url,
      published: true,
    };
  } catch (error) {
    console.warn(`[release] couldn't reach GitHub (${String(error)}); using package.json ${pkg.version}`);
    return fallback;
  }
}
