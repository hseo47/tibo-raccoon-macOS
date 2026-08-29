import type { Appearance, IconState } from '../domain';

export const WIDTH = 39;
export const HEIGHT = 29;

type Role = 'fur' | 'mask' | 'face' | 'eye' | 'snot' | 'flameOuter' | 'flameCore' | 'oxide';
type Span = readonly [y: number, x0: number, x1: number, role: Role];

export const PALETTES = {
  light: {
    fur: '#8a9299', mask: '#34393e', face: '#d8dbde', eye: '#17191b',
    snot: '#8fcbb7', flameOuter: '#d64b2a', flameCore: '#ffc247', oxide: '#9a4d49',
  },
  dark: {
    fur: '#aab1b7', mask: '#2b3035', face: '#d7dadc', eye: '#151719',
    snot: '#b5e2d1', flameOuter: '#ff6b47', flameCore: '#ffd166', oxide: '#cc7a74',
  },
} as const;

function rows(y0: number, y1: number, x0: number, x1: number, role: Role): Span[] {
  return Array.from({ length: y1 - y0 + 1 }, (_, index) => [y0 + index, x0, x1, role] as const);
}

function mirrorSpans(spans: readonly Span[]): Span[] {
  return spans.map(([y, x0, x1, role]) => [y, WIDTH - 1 - x1, WIDTH - 1 - x0, role] as const);
}

const SHARED: readonly Span[] = [
  ...rows(4, 8, 5, 11, 'mask'),
  ...rows(4, 8, 27, 33, 'mask'),
  [5, 9, 29, 'fur'], [6, 9, 29, 'fur'],
  [7, 5, 33, 'fur'], [8, 5, 33, 'fur'], [9, 5, 33, 'fur'],
  ...rows(10, 19, 3, 35, 'fur'),
  ...rows(20, 22, 5, 33, 'fur'),
  ...rows(23, 25, 9, 29, 'fur'),
  ...rows(26, 27, 15, 23, 'fur'),
  ...rows(10, 17, 7, 15, 'mask'),
  ...rows(10, 17, 23, 31, 'mask'),
];

const NOSE: readonly Span[] = [...rows(18, 20, 17, 21, 'eye')];
const CALM: readonly Span[] = [
  ...rows(13, 14, 10, 12, 'face'), ...rows(13, 14, 26, 28, 'face'),
  [14, 11, 12, 'eye'], [14, 26, 27, 'eye'],
];
const CALM_DRIP: readonly Span[] = [
  ...rows(21, 23, 21, 21, 'snot'), [24, 21, 22, 'snot'],
];
const LEFT_FLAME_OUTLINE: readonly Span[] = [
  [7, 12, 12, 'eye'], [8, 11, 13, 'eye'], [9, 10, 13, 'eye'],
  [10, 10, 14, 'eye'], [11, 9, 14, 'eye'], [12, 9, 14, 'eye'],
  [13, 9, 13, 'eye'], [14, 10, 13, 'eye'], [15, 10, 12, 'eye'],
];
const LEFT_FLAME_OUTER: readonly Span[] = [
  [8, 12, 12, 'flameOuter'], [9, 11, 12, 'flameOuter'],
  [10, 11, 13, 'flameOuter'], [11, 10, 13, 'flameOuter'],
  [12, 10, 13, 'flameOuter'], [13, 10, 12, 'flameOuter'],
  [14, 11, 12, 'flameOuter'],
];
const LEFT_FLAME_CORE: readonly Span[] = [
  [10, 12, 12, 'flameCore'], [11, 11, 12, 'flameCore'],
  [12, 11, 12, 'flameCore'], [13, 11, 11, 'flameCore'],
];
const UNREAD: readonly Span[] = [
  ...LEFT_FLAME_OUTLINE, ...mirrorSpans(LEFT_FLAME_OUTLINE),
  ...LEFT_FLAME_OUTER, ...mirrorSpans(LEFT_FLAME_OUTER),
  ...LEFT_FLAME_CORE, ...mirrorSpans(LEFT_FLAME_CORE),
];
const OXIDE: readonly Span[] = [
  [5, 1, 5, 'oxide'], ...rows(6, 9, 1, 1, 'oxide'),
  [5, 33, 37, 'oxide'], ...rows(6, 9, 37, 37, 'oxide'),
  ...rows(22, 25, 1, 1, 'oxide'), [26, 1, 5, 'oxide'],
  ...rows(22, 25, 37, 37, 'oxide'), [26, 33, 37, 'oxide'],
];
const OFFLINE: readonly Span[] = [
  ...rows(13, 14, 10, 12, 'face'), ...rows(13, 14, 26, 28, 'face'),
  [14, 10, 12, 'eye'], [14, 26, 28, 'eye'],
];

function color(hex: string): readonly [number, number, number, number] {
  return [Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16), 0xff];
}

function paint(rgba: Uint8Array, spans: readonly Span[], appearance: Appearance): void {
  const palette = PALETTES[appearance];
  for (const [y, x0, x1, role] of spans) {
    const [red, green, blue, alpha] = color(palette[role]);
    for (let x = x0; x <= x1; x++) {
      const offset = (y * WIDTH + x) * 4;
      rgba[offset] = red;
      rgba[offset + 1] = green;
      rgba[offset + 2] = blue;
      rgba[offset + 3] = alpha;
    }
  }
}

export function renderRaccoonRgba(state: IconState, appearance: Appearance): Uint8Array {
  const rgba = new Uint8Array(WIDTH * HEIGHT * 4);
  paint(rgba, SHARED, appearance);
  if (state === 'unread') {
    paint(rgba, UNREAD, appearance);
  } else if (state === 'calm') {
    paint(rgba, CALM, appearance);
  } else {
    paint(rgba, OFFLINE, appearance);
  }
  paint(rgba, NOSE, appearance);
  if (state === 'calm') paint(rgba, CALM_DRIP, appearance);
  if (state === 'unread') paint(rgba, OXIDE, appearance);
  return rgba;
}
