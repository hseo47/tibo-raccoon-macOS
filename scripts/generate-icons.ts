import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';
import type { Appearance, IconState } from '../src/domain';

const states = ['calm', 'unread', 'offline'] as const satisfies readonly IconState[];
const appearances = ['light', 'dark'] as const satisfies readonly Appearance[];

const base64ByState = {} as Record<IconState, Record<Appearance, string>>;
const hashByState = {} as Record<IconState, Record<Appearance, string>>;
const manifest: Record<string, string> = {};

await mkdir('assets/icons', { recursive: true });
await mkdir('src/generated', { recursive: true });

for (const state of states) {
  base64ByState[state] = {} as Record<Appearance, string>;
  hashByState[state] = {} as Record<Appearance, string>;
  const source = await Bun.file(`previews/v2-raccoon/${state}.svg`).text();
  for (const appearance of appearances) {
    const svg = appearance === 'dark' ? source : source
      .replaceAll('#34383b', '#33383c')
      .replaceAll('#c9eee4', '#bde4d8')
      .replaceAll('#fa936d', '#dc7056')
      .replaceAll('#ffe4aa', '#ffdc93');
    const png = await sharp(Buffer.from(svg), { density: 384 })
      .resize(31, 23, { fit: 'fill', kernel: 'lanczos3' })
      .withMetadata({ density: 96 })
      .png({ compressionLevel: 9 })
      .toBuffer();
    const filename = `${state}-${appearance}.png`;
    const hash = new Bun.CryptoHasher('sha256').update(png).digest('hex');
    base64ByState[state][appearance] = Buffer.from(png).toString('base64');
    hashByState[state][appearance] = hash;
    manifest[filename] = hash;
    await Bun.write(`assets/icons/${filename}`, png);
  }
}

const sortedManifest = Object.fromEntries(Object.entries(manifest).sort(([left], [right]) => left.localeCompare(right)));
const moduleSource = [
  "import type { Appearance, IconState } from '../domain';",
  `export const ICON_BASE64 = ${JSON.stringify(base64ByState, null, 2)} as const satisfies Record<IconState, Record<Appearance, string>>;`,
  `export const ICON_SHA256 = ${JSON.stringify(hashByState, null, 2)} as const satisfies Record<IconState, Record<Appearance, string>>;`,
  '',
].join('\n');

await Bun.write('assets/icons/sha256.json', `${JSON.stringify(sortedManifest, null, 2)}\n`);
await Bun.write('src/generated/icons.ts', moduleSource);
