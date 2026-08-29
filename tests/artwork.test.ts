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

type ExpectedRole = 'fur' | 'mask' | 'face' | 'eye' | 'snot' | 'flameOuter' | 'flameCore' | 'oxide';
type ExpectedSpan = readonly [y: number, x0: number, x1: number, role: ExpectedRole];

const EXPECTED_PALETTES = {
  light: { fur: [0x8a, 0x92, 0x99, 0xff], mask: [0x34, 0x39, 0x3e, 0xff], face: [0xd8, 0xdb, 0xde, 0xff], eye: [0x17, 0x19, 0x1b, 0xff], snot: [0x8f, 0xcb, 0xb7, 0xff], flameOuter: [0xd6, 0x4b, 0x2a, 0xff], flameCore: [0xff, 0xc2, 0x47, 0xff], oxide: [0x9a, 0x4d, 0x49, 0xff] },
  dark: { fur: [0xaa, 0xb1, 0xb7, 0xff], mask: [0x2b, 0x30, 0x35, 0xff], face: [0xd7, 0xda, 0xdc, 0xff], eye: [0x15, 0x17, 0x19, 0xff], snot: [0xb5, 0xe2, 0xd1, 0xff], flameOuter: [0xff, 0x6b, 0x47, 0xff], flameCore: [0xff, 0xd1, 0x66, 0xff], oxide: [0xcc, 0x7a, 0x74, 0xff] },
} as const satisfies Record<'light' | 'dark', Record<ExpectedRole, readonly [number, number, number, number]>>;

// This is deliberately test-local source-of-truth data, expressed independently
// from the production span arrays.
const EXPECTED_SHARED: readonly ExpectedSpan[] = [
  [4, 5, 11, 'mask'], [5, 5, 11, 'mask'], [6, 5, 11, 'mask'], [7, 5, 11, 'mask'], [8, 5, 11, 'mask'],
  [4, 27, 33, 'mask'], [5, 27, 33, 'mask'], [6, 27, 33, 'mask'], [7, 27, 33, 'mask'], [8, 27, 33, 'mask'],
  [5, 9, 29, 'fur'], [6, 9, 29, 'fur'], [7, 5, 33, 'fur'], [8, 5, 33, 'fur'], [9, 5, 33, 'fur'],
  [10, 3, 35, 'fur'], [11, 3, 35, 'fur'], [12, 3, 35, 'fur'], [13, 3, 35, 'fur'], [14, 3, 35, 'fur'], [15, 3, 35, 'fur'], [16, 3, 35, 'fur'], [17, 3, 35, 'fur'], [18, 3, 35, 'fur'], [19, 3, 35, 'fur'],
  [20, 5, 33, 'fur'], [21, 5, 33, 'fur'], [22, 5, 33, 'fur'], [23, 9, 29, 'fur'], [24, 9, 29, 'fur'], [25, 9, 29, 'fur'], [26, 15, 23, 'fur'], [27, 15, 23, 'fur'],
  [10, 7, 15, 'mask'], [11, 7, 15, 'mask'], [12, 7, 15, 'mask'], [13, 7, 15, 'mask'], [14, 7, 15, 'mask'], [15, 7, 15, 'mask'], [16, 7, 15, 'mask'], [17, 7, 15, 'mask'],
  [10, 23, 31, 'mask'], [11, 23, 31, 'mask'], [12, 23, 31, 'mask'], [13, 23, 31, 'mask'], [14, 23, 31, 'mask'], [15, 23, 31, 'mask'], [16, 23, 31, 'mask'], [17, 23, 31, 'mask'],
];
const EXPECTED_CALM: readonly ExpectedSpan[] = [[13, 10, 12, 'face'], [14, 10, 12, 'face'], [13, 26, 28, 'face'], [14, 26, 28, 'face'], [14, 11, 12, 'eye'], [14, 26, 27, 'eye'], [21, 21, 21, 'snot'], [22, 21, 21, 'snot'], [23, 21, 21, 'snot'], [24, 21, 22, 'snot']];
const EXPECTED_OFFLINE: readonly ExpectedSpan[] = [[13, 10, 12, 'face'], [14, 10, 12, 'face'], [13, 26, 28, 'face'], [14, 26, 28, 'face'], [14, 10, 12, 'eye'], [14, 26, 28, 'eye']];
const EXPECTED_UNREAD: readonly ExpectedSpan[] = [
  [7, 12, 12, 'eye'], [8, 11, 13, 'eye'], [9, 10, 13, 'eye'], [10, 10, 14, 'eye'], [11, 9, 14, 'eye'], [12, 9, 14, 'eye'], [13, 9, 13, 'eye'], [14, 10, 13, 'eye'], [15, 10, 12, 'eye'],
  [7, 26, 26, 'eye'], [8, 25, 27, 'eye'], [9, 25, 28, 'eye'], [10, 24, 28, 'eye'], [11, 24, 29, 'eye'], [12, 24, 29, 'eye'], [13, 25, 29, 'eye'], [14, 25, 28, 'eye'], [15, 26, 28, 'eye'],
  [8, 12, 12, 'flameOuter'], [9, 11, 12, 'flameOuter'], [10, 11, 13, 'flameOuter'], [11, 10, 13, 'flameOuter'], [12, 10, 13, 'flameOuter'], [13, 10, 12, 'flameOuter'], [14, 11, 12, 'flameOuter'],
  [8, 26, 26, 'flameOuter'], [9, 26, 27, 'flameOuter'], [10, 25, 27, 'flameOuter'], [11, 25, 28, 'flameOuter'], [12, 25, 28, 'flameOuter'], [13, 26, 28, 'flameOuter'], [14, 26, 27, 'flameOuter'],
  [10, 12, 12, 'flameCore'], [11, 11, 12, 'flameCore'], [12, 11, 12, 'flameCore'], [13, 11, 11, 'flameCore'],
  [10, 26, 26, 'flameCore'], [11, 26, 27, 'flameCore'], [12, 26, 27, 'flameCore'], [13, 27, 27, 'flameCore'],
  [5, 1, 5, 'oxide'], [6, 1, 1, 'oxide'], [7, 1, 1, 'oxide'], [8, 1, 1, 'oxide'], [9, 1, 1, 'oxide'], [5, 33, 37, 'oxide'], [6, 37, 37, 'oxide'], [7, 37, 37, 'oxide'], [8, 37, 37, 'oxide'], [9, 37, 37, 'oxide'],
  [22, 1, 1, 'oxide'], [23, 1, 1, 'oxide'], [24, 1, 1, 'oxide'], [25, 1, 1, 'oxide'], [26, 1, 5, 'oxide'], [22, 37, 37, 'oxide'], [23, 37, 37, 'oxide'], [24, 37, 37, 'oxide'], [25, 37, 37, 'oxide'], [26, 33, 37, 'oxide'],
];
const EXPECTED_NOSE: readonly ExpectedSpan[] = [[18, 17, 21, 'eye'], [19, 17, 21, 'eye'], [20, 17, 21, 'eye']];

function expectedRgba(state: 'calm' | 'unread' | 'offline', appearance: 'light' | 'dark'): Uint8Array {
  const expected = new Uint8Array(WIDTH * HEIGHT * 4);
  const paint = (spans: readonly ExpectedSpan[]) => {
    for (const [y, x0, x1, role] of spans) {
      const [red, green, blue, alpha] = EXPECTED_PALETTES[appearance][role];
      for (let x = x0; x <= x1; x++) expected.set([red, green, blue, alpha], (y * WIDTH + x) * 4);
    }
  };
  paint(EXPECTED_SHARED);
  paint(state === 'calm' ? EXPECTED_CALM.slice(0, 6) : state === 'offline' ? EXPECTED_OFFLINE : EXPECTED_UNREAD.slice(0, 40));
  paint(EXPECTED_NOSE);
  if (state === 'calm') paint(EXPECTED_CALM.slice(6));
  if (state === 'unread') paint(EXPECTED_UNREAD.slice(40));
  return expected;
}

type ParsedChunk = { readonly name: string; readonly data: Uint8Array; readonly crc: number };

function testCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (-(crc & 1) & 0xedb88320);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function testAdler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function parsePng(png: Uint8Array): ParsedChunk[] {
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunks: ParsedChunk[] = [];
  let offset = 8;
  while (offset < png.length) {
    expect(offset + 12).toBeLessThanOrEqual(png.length);
    const length = new DataView(png.buffer, png.byteOffset + offset, 4).getUint32(0);
    expect(offset + 12 + length).toBeLessThanOrEqual(png.length);
    const nameBytes = png.subarray(offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    const crc = new DataView(png.buffer, png.byteOffset + offset + 8 + length, 4).getUint32(0);
    const crcInput = new Uint8Array(nameBytes.length + data.length);
    crcInput.set(nameBytes);
    crcInput.set(data, nameBytes.length);
    expect(crc).toBe(testCrc32(crcInput));
    chunks.push({ name: new TextDecoder().decode(nameBytes), data, crc });
    offset += 12 + length;
  }
  expect(offset).toBe(png.length);
  return chunks;
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

test('matches the independent approved grid at every pixel for every state and appearance', () => {
  for (const state of ['calm', 'unread', 'offline'] as const) {
    for (const appearance of ['light', 'dark'] as const) {
      const actual = renderRaccoonRgba(state, appearance);
      const expected = expectedRgba(state, appearance);
      for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
          expect(pixel(actual, WIDTH, x, y)).toEqual(pixel(expected, WIDTH, x, y));
        }
      }
    }
  }
});

test('preserves explicit nose and oxide layer precedence at overlap coordinates', () => {
  for (const state of ['calm', 'unread', 'offline'] as const) {
    const rgba = renderRaccoonRgba(state, 'light');
    expect(pixel(rgba, WIDTH, 17, 18)).toEqual([0x17, 0x19, 0x1b, 0xff]);
    expect(pixel(rgba, WIDTH, 21, 20)).toEqual([0x17, 0x19, 0x1b, 0xff]);
  }
  const unread = renderRaccoonRgba('unread', 'light');
  expect(pixel(unread, WIDTH, 5, 5)).toEqual([0x9a, 0x4d, 0x49, 0xff]);
  expect(pixel(unread, WIDTH, 33, 5)).toEqual([0x9a, 0x4d, 0x49, 0xff]);
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

test('PNG encoding is byte-stable and has validated stored-DEFLATE bytes', () => {
  const rgba = renderRaccoonRgba('calm', 'light');
  const first = encodeDeterministicPng(rgba, WIDTH, HEIGHT);
  const second = encodeDeterministicPng(rgba, WIDTH, HEIGHT);
  expect(first).toEqual(second);
  const chunks = parsePng(first);
  expect(chunks.map(({ name }) => name)).toEqual(['IHDR', 'IDAT', 'IEND']);
  expect(chunks).toHaveLength(3);
  const ihdr = chunks[0]!.data;
  expect([...ihdr]).toEqual([0, 0, 0, 39, 0, 0, 0, 29, 8, 6, 0, 0, 0]);
  expect(chunks[2]!.data).toHaveLength(0);

  const idat = chunks[1]!.data;
  expect([idat[0], idat[1]]).toEqual([0x78, 0x01]);
  const header = idat[2]!;
  expect(header & 1).toBe(1);
  expect((header >>> 1) & 0b11).toBe(0);
  const length = idat[3]! | (idat[4]! << 8);
  const inverseLength = idat[5]! | (idat[6]! << 8);
  expect(inverseLength).toBe((~length) & 0xffff);
  expect(length).toBe(HEIGHT * (1 + WIDTH * 4));
  expect(idat).toHaveLength(2 + 1 + 4 + length + 4);
  const payload = idat.subarray(7, 7 + length);
  const expectedScanlines = new Uint8Array(length);
  for (let y = 0; y < HEIGHT; y++) {
    const row = y * (1 + WIDTH * 4);
    expect(payload[row]).toBe(0);
    expectedScanlines[row] = 0;
    expectedScanlines.set(rgba.subarray(y * WIDTH * 4, (y + 1) * WIDTH * 4), row + 1);
  }
  expect(payload).toEqual(expectedScanlines);
  const adler = new DataView(idat.buffer, idat.byteOffset + 7 + length, 4).getUint32(0);
  expect(adler).toBe(testAdler32(payload));
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
