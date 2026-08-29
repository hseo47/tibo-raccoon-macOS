import { expect, test } from 'bun:test';
import { renderRaccoonRgba } from '../src/artwork/grid';
import { encodeDeterministicPng } from '../src/artwork/png';
import { ICON_BASE64, ICON_SHA256 } from '../src/generated/icons';

const WIDTH = 39;
const HEIGHT = 29;

function pixel(rgba: Uint8Array, width: number, x: number, y: number): readonly [number, number, number, number] {
  const offset = (y * width + x) * 4;
  return [rgba[offset]!, rgba[offset + 1]!, rgba[offset + 2]!, rgba[offset + 3]!];
}

function readChunkNames(png: Uint8Array): string[] {
  const names: string[] = [];
  let offset = 8;
  while (offset < png.length) {
    const length = new DataView(png.buffer, png.byteOffset + offset, 4).getUint32(0);
    const type = new TextDecoder().decode(png.subarray(offset + 4, offset + 8));
    names.push(type);
    offset += 12 + length;
  }
  return names;
}

test('renders the approved 39 by 29 round-cheek silhouette on transparency', () => {
  const rgba = renderRaccoonRgba('calm', 'light');
  expect(rgba).toHaveLength(WIDTH * HEIGHT * 4);
  expect(pixel(rgba, WIDTH, 0, 0)).toEqual([0, 0, 0, 0]);
  expect(pixel(rgba, WIDTH, 3, 10)).toEqual([0x8a, 0x92, 0x99, 0xff]);
  expect(pixel(rgba, WIDTH, 35, 19)).toEqual([0x8a, 0x92, 0x99, 0xff]);
  expect(pixel(rgba, WIDTH, 9, 25)).toEqual([0x8a, 0x92, 0x99, 0xff]);
  expect(pixel(rgba, WIDTH, 15, 27)).toEqual([0x8a, 0x92, 0x99, 0xff]);
  expect(pixel(rgba, WIDTH, 14, 27)).toEqual([0, 0, 0, 0]);
});

test('uses every approved palette color in its applicable light and dark state', () => {
  const cases = [
    ['light', [0x8a, 0x92, 0x99, 0xff], [0x34, 0x39, 0x3e, 0xff], [0xd8, 0xdb, 0xde, 0xff], [0x17, 0x19, 0x1b, 0xff], [0x8f, 0xcb, 0xb7, 0xff], [0xd6, 0x4b, 0x2a, 0xff], [0xff, 0xc2, 0x47, 0xff], [0x9a, 0x4d, 0x49, 0xff]],
    ['dark', [0xaa, 0xb1, 0xb7, 0xff], [0x2b, 0x30, 0x35, 0xff], [0xd7, 0xda, 0xdc, 0xff], [0x15, 0x17, 0x19, 0xff], [0xb5, 0xe2, 0xd1, 0xff], [0xff, 0x6b, 0x47, 0xff], [0xff, 0xd1, 0x66, 0xff], [0xcc, 0x7a, 0x74, 0xff]],
  ] as const;
  for (const [appearance, fur, mask, face, eye, snot, outer, core, oxide] of cases) {
    const calm = renderRaccoonRgba('calm', appearance);
    const unread = renderRaccoonRgba('unread', appearance);
    expect(pixel(calm, WIDTH, 3, 10)).toEqual(fur);
    expect(pixel(calm, WIDTH, 7, 10)).toEqual(mask);
    expect(pixel(calm, WIDTH, 10, 13)).toEqual(face);
    expect(pixel(calm, WIDTH, 11, 14)).toEqual(eye);
    expect(pixel(calm, WIDTH, 21, 21)).toEqual(snot);
    expect(pixel(unread, WIDTH, 12, 9)).toEqual(outer);
    expect(pixel(unread, WIDTH, 12, 11)).toEqual(core);
    expect(pixel(unread, WIDTH, 1, 5)).toEqual(oxide);
  }
});

test('calm and offline retain their approved distinct eye coordinates', () => {
  const calm = renderRaccoonRgba('calm', 'light');
  const offline = renderRaccoonRgba('offline', 'light');
  expect(pixel(calm, WIDTH, 10, 14)).toEqual([0xd8, 0xdb, 0xde, 0xff]);
  expect(pixel(calm, WIDTH, 11, 14)).toEqual([0x17, 0x19, 0x1b, 0xff]);
  expect(pixel(calm, WIDTH, 12, 14)).toEqual([0x17, 0x19, 0x1b, 0xff]);
  expect(pixel(offline, WIDTH, 10, 14)).toEqual([0x17, 0x19, 0x1b, 0xff]);
  expect(pixel(offline, WIDTH, 12, 14)).toEqual([0x17, 0x19, 0x1b, 0xff]);
  expect(pixel(offline, WIDTH, 13, 14)).toEqual([0x34, 0x39, 0x3e, 0xff]);
});

test('calm alone has the approved viewer-right nose drip', () => {
  const calm = renderRaccoonRgba('calm', 'light');
  const unread = renderRaccoonRgba('unread', 'light');
  const offline = renderRaccoonRgba('offline', 'light');
  expect(pixel(calm, WIDTH, 21, 21)).toEqual([0x8f, 0xcb, 0xb7, 0xff]);
  expect(pixel(calm, WIDTH, 21, 23)).toEqual([0x8f, 0xcb, 0xb7, 0xff]);
  expect(pixel(calm, WIDTH, 22, 24)).toEqual([0x8f, 0xcb, 0xb7, 0xff]);
  expect(pixel(unread, WIDTH, 21, 21)).not.toEqual([0x8f, 0xcb, 0xb7, 0xff]);
  expect(pixel(offline, WIDTH, 21, 21)).not.toEqual([0x8f, 0xcb, 0xb7, 0xff]);
});

test('unread uses the approved outlined fire eyes and oxide frame', () => {
  const rgba = renderRaccoonRgba('unread', 'light');
  expect(pixel(rgba, WIDTH, 12, 7)).toEqual([0x17, 0x19, 0x1b, 0xff]);
  expect(pixel(rgba, WIDTH, 12, 9)).toEqual([0xd6, 0x4b, 0x2a, 0xff]);
  expect(pixel(rgba, WIDTH, 12, 11)).toEqual([0xff, 0xc2, 0x47, 0xff]);
  expect(pixel(rgba, WIDTH, 26, 7)).toEqual(pixel(rgba, WIDTH, 12, 7));
  expect(pixel(rgba, WIDTH, 1, 5)).toEqual([0x9a, 0x4d, 0x49, 0xff]);
  expect(pixel(rgba, WIDTH, 0, 0)).toEqual([0, 0, 0, 0]);
});

test('unread flames mirror horizontally and exclusive state accents do not leak', () => {
  const unread = renderRaccoonRgba('unread', 'light');
  const calm = renderRaccoonRgba('calm', 'light');
  const offline = renderRaccoonRgba('offline', 'light');
  for (let y = 7; y <= 15; y++) {
    for (let x = 9; x <= 14; x++) {
      expect(pixel(unread, WIDTH, 38 - x, y)).toEqual(pixel(unread, WIDTH, x, y));
    }
  }
  expect(pixel(calm, WIDTH, 1, 5)).not.toEqual([0x9a, 0x4d, 0x49, 0xff]);
  expect(pixel(offline, WIDTH, 12, 9)).not.toEqual([0xd6, 0x4b, 0x2a, 0xff]);
  expect(pixel(calm, WIDTH, 12, 11)).not.toEqual([0xff, 0xc2, 0x47, 0xff]);
});

test('PNG encoding is byte-stable and contains only required chunks', () => {
  const rgba = renderRaccoonRgba('calm', 'light');
  const first = encodeDeterministicPng(rgba, WIDTH, HEIGHT);
  const second = encodeDeterministicPng(rgba, WIDTH, HEIGHT);
  expect(first).toEqual(second);
  expect([...first.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(readChunkNames(first)).toEqual(['IHDR', 'IDAT', 'IEND']);
  expect(first[24]).toBe(8);
  expect(first[25]).toBe(6);
  expect(first[28]).toBe(0);
});

test('checked-in PNGs, manifest hashes, and embedded Base64 agree byte for byte', async () => {
  const manifest = await Bun.file('assets/icons/sha256.json').json() as Record<string, string>;
  for (const state of ['calm', 'unread', 'offline'] as const) {
    for (const appearance of ['light', 'dark'] as const) {
      const filename = `${state}-${appearance}.png`;
      const canonical = new Uint8Array(await Bun.file(`assets/icons/${filename}`).arrayBuffer());
      const embedded = new Uint8Array(Buffer.from(ICON_BASE64[state][appearance], 'base64'));
      const hash = new Bun.CryptoHasher('sha256').update(canonical).digest('hex');
      expect(manifest[filename]).toBe(hash);
      expect(hash).toBe(ICON_SHA256[state][appearance]);
      expect(embedded).toEqual(canonical);
    }
  }
});
