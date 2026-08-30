import type { Appearance, IconState } from '../domain';

export const WIDTH = 31;
export const HEIGHT = 23;

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
  ...rows(3, 6, 4, 9, 'mask'),
  ...rows(3, 6, 21, 26, 'mask'),
  ...rows(4, 5, 7, 23, 'fur'),
  ...rows(6, 7, 4, 26, 'fur'),
  ...rows(8, 15, 2, 28, 'fur'),
  ...rows(16, 17, 4, 26, 'fur'),
  ...rows(18, 20, 7, 23, 'fur'),
  ...rows(21, 22, 12, 18, 'fur'),
  ...rows(8, 13, 5, 12, 'mask'),
  ...rows(8, 13, 18, 25, 'mask'),
];

const NOSE: readonly Span[] = [...rows(14, 16, 13, 17, 'eye')];
const CALM: readonly Span[] = [
  ...rows(10, 11, 8, 10, 'face'), ...rows(10, 11, 20, 22, 'face'),
  [11, 9, 10, 'eye'], [11, 20, 21, 'eye'],
];
const CALM_DRIP: readonly Span[] = [
  ...rows(17, 19, 17, 17, 'snot'), [20, 17, 18, 'snot'],
];
const LEFT_FLAME_OUTLINE: readonly Span[] = [
  [5, 10, 10, 'eye'], [6, 9, 10, 'eye'], [7, 8, 11, 'eye'],
  [8, 7, 11, 'eye'], [9, 7, 11, 'eye'], [10, 7, 11, 'eye'],
  [11, 8, 11, 'eye'], [12, 9, 10, 'eye'],
];
const LEFT_FLAME_OUTER: readonly Span[] = [
  [6, 10, 10, 'flameOuter'], [7, 9, 10, 'flameOuter'],
  [8, 8, 10, 'flameOuter'], [9, 8, 10, 'flameOuter'],
  [10, 8, 10, 'flameOuter'], [11, 9, 10, 'flameOuter'],
];
const LEFT_FLAME_CORE: readonly Span[] = [
  [8, 10, 10, 'flameCore'], [9, 9, 10, 'flameCore'],
  [10, 9, 9, 'flameCore'],
];
const UNREAD: readonly Span[] = [
  ...LEFT_FLAME_OUTLINE, ...mirrorSpans(LEFT_FLAME_OUTLINE),
  ...LEFT_FLAME_OUTER, ...mirrorSpans(LEFT_FLAME_OUTER),
  ...LEFT_FLAME_CORE, ...mirrorSpans(LEFT_FLAME_CORE),
];
const OXIDE: readonly Span[] = [
  [4, 1, 4, 'oxide'], ...rows(5, 7, 1, 1, 'oxide'),
  [4, 26, 29, 'oxide'], ...rows(5, 7, 29, 29, 'oxide'),
  ...rows(17, 20, 1, 1, 'oxide'), [21, 1, 4, 'oxide'],
  ...rows(17, 20, 29, 29, 'oxide'), [21, 26, 29, 'oxide'],
];
const OFFLINE: readonly Span[] = [
  ...rows(10, 11, 8, 10, 'face'), ...rows(10, 11, 20, 22, 'face'),
  [11, 8, 10, 'eye'], [11, 20, 22, 'eye'],
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
