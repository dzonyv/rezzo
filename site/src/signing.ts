/**
 * Whether the published installer is code-signed. Every "not signed yet"
 * sentence on the site (the SmartScreen question, the install step, the
 * download page's signing section and the policy page's status) follows this,
 * the way the release text follows `--signed`. Set it to true with the first
 * signed release.
 */
export const signed = false;

/** SignPath Foundation's statement, word for word, with its two links. */
export const signPathStatement: { text: string; href?: string }[] = [
  { text: 'Free code signing provided by ' },
  { text: 'SignPath.io', href: 'https://signpath.io' },
  { text: ', certificate by ' },
  { text: 'SignPath Foundation', href: 'https://signpath.org' },
];

/** The privacy sentence SignPath Foundation asks for, word for word. */
export const signPathPrivacy =
  'This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it.';
