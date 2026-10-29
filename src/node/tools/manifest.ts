/** tools.json: the third-party binaries and models, with pinned sizes and checksums. */
import { z } from 'zod';
import manifest from '../../../tools.json' with { type: 'json' };

export const toolSchema = z.object({
  id: z.string(),
  /** "bundled" ships in the installer; "download" is fetched by the app when first needed. */
  kind: z.enum(['bundled', 'download']),
  name: z.string(),
  url: z.url(),
  size: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  extract: z.boolean().optional(),
  license: z.string(),
  source: z.url(),
});
export type Tool = z.infer<typeof toolSchema>;

export const TOOLS: readonly Tool[] = z.array(toolSchema).parse(manifest.items);

export function tool(id: string): Tool {
  const found = TOOLS.find((t) => t.id === id);
  if (!found) throw new Error(`No tool "${id}" in tools.json`);
  return found;
}
