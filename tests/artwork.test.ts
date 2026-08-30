import { expect, test } from 'bun:test';
import { renderRaccoonRgba } from '../src/artwork/grid';
import { encodeDeterministicPng } from '../src/artwork/png';
import { ICON_BASE64, ICON_SHA256 } from '../src/generated/icons';

const WIDTH = 31;
const HEIGHT = 23;

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
  [3, 4, 9, 'mask'], [4, 4, 9, 'mask'], [5, 4, 9, 'mask'], [6, 4, 9, 'mask'],
  [3, 21, 26, 'mask'], [4, 21, 26, 'mask'], [5, 21, 26, 'mask'], [6, 21, 26, 'mask'],
  [4, 7, 23, 'fur'], [5, 7, 23, 'fur'],
  [6, 4, 26, 'fur'], [7, 4, 26, 'fur'],
  [8, 2, 28, 'fur'], [9, 2, 28, 'fur'], [10, 2, 28, 'fur'], [11, 2, 28, 'fur'],
  [12, 2, 28, 'fur'], [13, 2, 28, 'fur'], [14, 2, 28, 'fur'], [15, 2, 28, 'fur'],
  [16, 4, 26, 'fur'], [17, 4, 26, 'fur'],
  [18, 7, 23, 'fur'], [19, 7, 23, 'fur'], [20, 7, 23, 'fur'],
  [21, 12, 18, 'fur'], [22, 12, 18, 'fur'],
  [8, 5, 12, 'mask'], [9, 5, 12, 'mask'], [10, 5, 12, 'mask'],
  [11, 5, 12, 'mask'], [12, 5, 12, 'mask'], [13, 5, 12, 'mask'],
  [8, 18, 25, 'mask'], [9, 18, 25, 'mask'], [10, 18, 25, 'mask'],
  [11, 18, 25, 'mask'], [12, 18, 25, 'mask'], [13, 18, 25, 'mask'],
];
const EXPECTED_CALM: readonly ExpectedSpan[] = [
  [10, 8, 10, 'face'], [11, 8, 10, 'face'],
  [10, 20, 22, 'face'], [11, 20, 22, 'face'],
  [11, 9, 10, 'eye'], [11, 20, 21, 'eye'],
];
const EXPECTED_CALM_DRIP: readonly ExpectedSpan[] = [
  [17, 17, 17, 'snot'], [18, 17, 17, 'snot'], [19, 17, 17, 'snot'], [20, 17, 18, 'snot'],
];
const EXPECTED_OFFLINE: readonly ExpectedSpan[] = [
  [10, 8, 10, 'face'], [11, 8, 10, 'face'],
  [10, 20, 22, 'face'], [11, 20, 22, 'face'],
  [11, 8, 10, 'eye'], [11, 20, 22, 'eye'],
];
const EXPECTED_UNREAD: readonly ExpectedSpan[] = [
  [5, 10, 10, 'eye'], [6, 9, 10, 'eye'], [7, 8, 11, 'eye'], [8, 7, 11, 'eye'],
  [9, 7, 11, 'eye'], [10, 7, 11, 'eye'], [11, 8, 11, 'eye'], [12, 9, 10, 'eye'],
  [5, 20, 20, 'eye'], [6, 20, 21, 'eye'], [7, 19, 22, 'eye'], [8, 19, 23, 'eye'],
  [9, 19, 23, 'eye'], [10, 19, 23, 'eye'], [11, 19, 22, 'eye'], [12, 20, 21, 'eye'],
  [6, 10, 10, 'flameOuter'], [7, 9, 10, 'flameOuter'], [8, 8, 10, 'flameOuter'],
  [9, 8, 10, 'flameOuter'], [10, 8, 10, 'flameOuter'], [11, 9, 10, 'flameOuter'],
  [6, 20, 20, 'flameOuter'], [7, 20, 21, 'flameOuter'], [8, 20, 22, 'flameOuter'],
  [9, 20, 22, 'flameOuter'], [10, 20, 22, 'flameOuter'], [11, 20, 21, 'flameOuter'],
  [8, 10, 10, 'flameCore'], [9, 9, 10, 'flameCore'], [10, 9, 9, 'flameCore'],
  [8, 20, 20, 'flameCore'], [9, 20, 21, 'flameCore'], [10, 21, 21, 'flameCore'],
];
const EXPECTED_OXIDE: readonly ExpectedSpan[] = [
  [4, 1, 4, 'oxide'], [5, 1, 1, 'oxide'], [6, 1, 1, 'oxide'], [7, 1, 1, 'oxide'],
  [4, 26, 29, 'oxide'], [5, 29, 29, 'oxide'], [6, 29, 29, 'oxide'], [7, 29, 29, 'oxide'],
  [17, 1, 1, 'oxide'], [18, 1, 1, 'oxide'], [19, 1, 1, 'oxide'], [20, 1, 1, 'oxide'], [21, 1, 4, 'oxide'],
  [17, 29, 29, 'oxide'], [18, 29, 29, 'oxide'], [19, 29, 29, 'oxide'], [20, 29, 29, 'oxide'], [21, 26, 29, 'oxide'],
];
const EXPECTED_NOSE: readonly ExpectedSpan[] = [
  [14, 13, 17, 'eye'], [15, 13, 17, 'eye'], [16, 13, 17, 'eye'],
];

function expectedRgba(state: 'calm' | 'unread' | 'offline', appearance: 'light' | 'dark'): Uint8Array {
  const expected = new Uint8Array(WIDTH * HEIGHT * 4);
  const paint = (spans: readonly ExpectedSpan[]) => {
    for (const [y, x0, x1, role] of spans) {
      const [red, green, blue, alpha] = EXPECTED_PALETTES[appearance][role];
      for (let x = x0; x <= x1; x++) expected.set([red, green, blue, alpha], (y * WIDTH + x) * 4);
    }
  };
  paint(EXPECTED_SHARED);
  paint(state === 'calm' ? EXPECTED_CALM : state === 'offline' ? EXPECTED_OFFLINE : EXPECTED_UNREAD);
  paint(EXPECTED_NOSE);
  if (state === 'calm') paint(EXPECTED_CALM_DRIP);
  if (state === 'unread') paint(EXPECTED_OXIDE);
  return expected;
}

type ParsedChunk = { readonly name: string; readonly data: Uint8Array; readonly crc: number };

const CRC32_NIBBLE_TABLE = Uint32Array.of(
  0x00000000, 0x1db71064, 0x3b6e20c8, 0x26d930ac,
  0x76dc4190, 0x6b6b51f4, 0x4db26158, 0x5005713c,
  0xedb88320, 0xf00f9344, 0xd6d6a3e8, 0xcb61b38c,
  0x9b64c2b0, 0x86d3d2d4, 0xa00ae278, 0xbdbdf21c,
);

function testCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC32_NIBBLE_TABLE[(crc ^ byte) & 0x0f]! ^ (crc >>> 4);
    crc = CRC32_NIBBLE_TABLE[(crc ^ (byte >>> 4)) & 0x0f]! ^ (crc >>> 4);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function testAdler32(bytes: Uint8Array): number {
  const modulus = 65521;
  let a = 1;
  let b = 0;
  for (let offset = 0; offset < bytes.length; offset += 5552) {
    const block = bytes.subarray(offset, Math.min(offset + 5552, bytes.length));
    let sum = 0;
    let weightedSum = 0;
    for (let index = 0; index < block.length; index++) {
      const byte = block[index]!;
      sum += byte;
      weightedSum += (block.length - index) * byte;
    }
    b = (b + block.length * a + weightedSum) % modulus;
    a = (a + sum) % modulus;
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

test('independent checksum oracles match fixed standard vectors', () => {
  const encoder = new TextEncoder();
  expect(testCrc32(new Uint8Array())).toBe(0x00000000);
  expect(testCrc32(encoder.encode('123456789'))).toBe(0xcbf43926);
  expect(testAdler32(new Uint8Array())).toBe(0x00000001);
  expect(testAdler32(encoder.encode('123456789'))).toBe(0x091e01de);
});

test('renders the approved 31 by 23 round-cheek silhouette on transparency', () => {
  const rgba = renderRaccoonRgba('calm', 'light');
  expect(rgba).toHaveLength(WIDTH * HEIGHT * 4);
  expect(pixel(rgba, WIDTH, 0, 0)).toEqual([0, 0, 0, 0]);
  expect(pixel(rgba, WIDTH, 2, 8)).toEqual([0x8a, 0x92, 0x99, 0xff]);
  expect(pixel(rgba, WIDTH, 28, 15)).toEqual([0x8a, 0x92, 0x99, 0xff]);
  expect(pixel(rgba, WIDTH, 7, 20)).toEqual([0x8a, 0x92, 0x99, 0xff]);
  expect(pixel(rgba, WIDTH, 12, 22)).toEqual([0x8a, 0x92, 0x99, 0xff]);
  expect(pixel(rgba, WIDTH, 11, 22)).toEqual([0, 0, 0, 0]);
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
    expect(pixel(rgba, WIDTH, 13, 14)).toEqual([0x17, 0x19, 0x1b, 0xff]);
    expect(pixel(rgba, WIDTH, 17, 16)).toEqual([0x17, 0x19, 0x1b, 0xff]);
  }
  const unread = renderRaccoonRgba('unread', 'light');
  expect(pixel(unread, WIDTH, 4, 4)).toEqual([0x9a, 0x4d, 0x49, 0xff]);
  expect(pixel(unread, WIDTH, 26, 4)).toEqual([0x9a, 0x4d, 0x49, 0xff]);
});

test('uses every approved palette color in its applicable light and dark state', () => {
  const cases = [
    ['light', [0x8a, 0x92, 0x99, 0xff], [0x34, 0x39, 0x3e, 0xff], [0xd8, 0xdb, 0xde, 0xff], [0x17, 0x19, 0x1b, 0xff], [0x8f, 0xcb, 0xb7, 0xff], [0xd6, 0x4b, 0x2a, 0xff], [0xff, 0xc2, 0x47, 0xff], [0x9a, 0x4d, 0x49, 0xff]],
    ['dark', [0xaa, 0xb1, 0xb7, 0xff], [0x2b, 0x30, 0x35, 0xff], [0xd7, 0xda, 0xdc, 0xff], [0x15, 0x17, 0x19, 0xff], [0xb5, 0xe2, 0xd1, 0xff], [0xff, 0x6b, 0x47, 0xff], [0xff, 0xd1, 0x66, 0xff], [0xcc, 0x7a, 0x74, 0xff]],
  ] as const;
  for (const [appearance, fur, mask, face, eye, snot, outer, core, oxide] of cases) {
    const calm = renderRaccoonRgba('calm', appearance);
    const unread = renderRaccoonRgba('unread', appearance);
    expect(pixel(calm, WIDTH, 2, 8)).toEqual(fur);
    expect(pixel(calm, WIDTH, 5, 8)).toEqual(mask);
    expect(pixel(calm, WIDTH, 8, 10)).toEqual(face);
    expect(pixel(calm, WIDTH, 9, 11)).toEqual(eye);
    expect(pixel(calm, WIDTH, 17, 17)).toEqual(snot);
    expect(pixel(unread, WIDTH, 10, 7)).toEqual(outer);
    expect(pixel(unread, WIDTH, 10, 9)).toEqual(core);
    expect(pixel(unread, WIDTH, 1, 4)).toEqual(oxide);
  }
});

test('calm and offline retain their approved distinct eye coordinates', () => {
  const calm = renderRaccoonRgba('calm', 'light');
  const offline = renderRaccoonRgba('offline', 'light');
  expect(pixel(calm, WIDTH, 8, 11)).toEqual([0xd8, 0xdb, 0xde, 0xff]);
  expect(pixel(calm, WIDTH, 9, 11)).toEqual([0x17, 0x19, 0x1b, 0xff]);
  expect(pixel(calm, WIDTH, 10, 11)).toEqual([0x17, 0x19, 0x1b, 0xff]);
  expect(pixel(offline, WIDTH, 8, 11)).toEqual([0x17, 0x19, 0x1b, 0xff]);
  expect(pixel(offline, WIDTH, 10, 11)).toEqual([0x17, 0x19, 0x1b, 0xff]);
  expect(pixel(offline, WIDTH, 11, 11)).toEqual([0x34, 0x39, 0x3e, 0xff]);
});

test('calm alone has the approved viewer-right nose drip', () => {
  const calm = renderRaccoonRgba('calm', 'light');
  const unread = renderRaccoonRgba('unread', 'light');
  const offline = renderRaccoonRgba('offline', 'light');
  expect(pixel(calm, WIDTH, 17, 17)).toEqual([0x8f, 0xcb, 0xb7, 0xff]);
  expect(pixel(calm, WIDTH, 17, 19)).toEqual([0x8f, 0xcb, 0xb7, 0xff]);
  expect(pixel(calm, WIDTH, 18, 20)).toEqual([0x8f, 0xcb, 0xb7, 0xff]);
  expect(pixel(unread, WIDTH, 17, 17)).not.toEqual([0x8f, 0xcb, 0xb7, 0xff]);
  expect(pixel(offline, WIDTH, 17, 17)).not.toEqual([0x8f, 0xcb, 0xb7, 0xff]);
});

test('unread uses the approved outlined fire eyes and oxide frame', () => {
  const rgba = renderRaccoonRgba('unread', 'light');
  expect(pixel(rgba, WIDTH, 10, 5)).toEqual([0x17, 0x19, 0x1b, 0xff]);
  expect(pixel(rgba, WIDTH, 10, 7)).toEqual([0xd6, 0x4b, 0x2a, 0xff]);
  expect(pixel(rgba, WIDTH, 10, 9)).toEqual([0xff, 0xc2, 0x47, 0xff]);
  expect(pixel(rgba, WIDTH, 20, 5)).toEqual(pixel(rgba, WIDTH, 10, 5));
  expect(pixel(rgba, WIDTH, 1, 4)).toEqual([0x9a, 0x4d, 0x49, 0xff]);
  expect(pixel(rgba, WIDTH, 0, 0)).toEqual([0, 0, 0, 0]);
});

test('unread flames mirror horizontally and exclusive state accents do not leak', () => {
  const unread = renderRaccoonRgba('unread', 'light');
  const calm = renderRaccoonRgba('calm', 'light');
  const offline = renderRaccoonRgba('offline', 'light');
  for (let y = 5; y <= 12; y++) {
    for (let x = 7; x <= 11; x++) {
      expect(pixel(unread, WIDTH, 30 - x, y)).toEqual(pixel(unread, WIDTH, x, y));
    }
  }
  expect(pixel(calm, WIDTH, 1, 4)).not.toEqual([0x9a, 0x4d, 0x49, 0xff]);
  expect(pixel(offline, WIDTH, 10, 7)).not.toEqual([0xd6, 0x4b, 0x2a, 0xff]);
  expect(pixel(calm, WIDTH, 10, 9)).not.toEqual([0xff, 0xc2, 0x47, 0xff]);
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
  expect([...ihdr]).toEqual([0, 0, 0, 31, 0, 0, 0, 23, 8, 6, 0, 0, 0]);
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
  expect(Object.keys(manifest).sort()).toEqual([
    'calm-dark.png', 'calm-light.png', 'offline-dark.png',
    'offline-light.png', 'unread-dark.png', 'unread-light.png',
  ]);
  for (const state of ['calm', 'unread', 'offline'] as const) {
    for (const appearance of ['light', 'dark'] as const) {
      const filename = `${state}-${appearance}.png`;
      const canonical = new Uint8Array(await Bun.file(`assets/icons/${filename}`).arrayBuffer());
      const embedded = new Uint8Array(Buffer.from(ICON_BASE64[state][appearance], 'base64'));
      const regenerated = encodeDeterministicPng(renderRaccoonRgba(state, appearance), WIDTH, HEIGHT);
      const hash = new Bun.CryptoHasher('sha256').update(canonical).digest('hex');
      expect(manifest[filename]).toBe(hash);
      expect(hash).toBe(ICON_SHA256[state][appearance]);
      expect(embedded).toEqual(canonical);
      expect(canonical).toEqual(new Uint8Array(regenerated));
    }
  }
});
