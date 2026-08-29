import { mkdir } from 'node:fs/promises';
import type { Appearance, IconState } from '../src/domain';
import { HEIGHT, renderRaccoonRgba, WIDTH } from '../src/artwork/grid';
import { encodeDeterministicPng } from '../src/artwork/png';

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
  for (const appearance of appearances) {
    const png = encodeDeterministicPng(renderRaccoonRgba(state, appearance), WIDTH, HEIGHT);
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
