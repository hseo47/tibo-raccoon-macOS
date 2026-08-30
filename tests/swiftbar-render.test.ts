import { expect, test } from 'bun:test';
import { ICON_BASE64 } from '../src/generated/icons';
import {
  chooseIconState,
  escapeSwiftBarTitle,
  renderSwiftBarMenu,
  selectMenuPosts,
  wrapPostText,
} from '../src/swiftbar/render';
import { post, stateWith } from './helpers/factories';

const pluginPath = '/tmp/Tibo Raccoon/tibo-raccoon.2m.js';

function splitSwiftBarLines(menu: string): string[] {
  return menu.split(/[\n\r\u000B\u000C\u0085\u2028\u2029]/u);
}

function parseSwiftBarParameters(line: string): Record<string, string> {
  const separator = line.indexOf('|');
  if (separator === -1) throw new Error('Missing parameter separator');
  const parameters: Record<string, string> = {};
  let index = separator + 1;

  while (index < line.length) {
    while (line[index] === ' ') index += 1;
    if (index >= line.length) break;
    const keyStart = index;
    while (index < line.length && line[index] !== '=') index += 1;
    if (index === line.length) throw new Error('Missing parameter value');
    const key = line.slice(keyStart, index);
    index += 1;

    let value = '';
    const delimiter = line[index];
    if (delimiter === "'" || delimiter === '"') {
      index += 1;
      let escaped = false;
      let closed = false;
      while (index < line.length) {
        const character = line[index];
        if (character === undefined) break;
        index += 1;
        if (escaped) {
          value += character;
          escaped = false;
        } else if (character === '\\') {
          value += character;
          escaped = true;
        } else if (character === delimiter) {
          closed = true;
          break;
        } else {
          value += character;
        }
      }
      if (!closed) throw new Error('Unclosed quoted parameter');
    } else {
      const valueStart = index;
      while (index < line.length && line[index] !== ' ') index += 1;
      value = line.slice(valueStart, index);
    }
    parameters[key] = value;
  }
  return parameters;
}

test('renders an image-only paired Base64 header and unread dropdown count', () => {
  const menu = renderSwiftBarMenu({
    state: stateWith({ unreadIds: ['2'], cachedPosts: [post('2')] }),
    pluginPath,
    locale: 'en-US',
    timeZone: 'UTC',
  });
  const [header, separator, count] = menu.split('\n');
  expect(header).toBe(`| image=${ICON_BASE64.unread.light},${ICON_BASE64.unread.dark} dropdown=false`);
  expect(separator).toBe('---');
  expect(count).toBe('Tibo Raccoon · 1 unread');
});

test('selects newest posts, all unread posts, and enough reads to reach five without mutation', () => {
  const source = [
    post('old-read', { publishedAt: '2026-08-20T00:00:00.000Z' }),
    post('new-read', { publishedAt: '2026-08-29T00:00:00.000Z' }),
    post('unread-old', { publishedAt: '2026-08-21T00:00:00.000Z' }),
    post('mid-read', { publishedAt: '2026-08-25T00:00:00.000Z' }),
    post('unread-new', { publishedAt: '2026-08-28T00:00:00.000Z' }),
    post('another-read', { publishedAt: '2026-08-24T00:00:00.000Z' }),
  ];
  const state = stateWith({ cachedPosts: source, unreadIds: ['unread-old', 'unread-new'] });
  const original = structuredClone(state);
  expect(selectMenuPosts(state).map(({ id }) => id)).toEqual([
    'unread-new', 'unread-old', 'new-read', 'mid-read', 'another-read',
  ]);
  expect(state).toEqual(original);
});

test('retains every unread post when unread alone exceeds the minimum', () => {
  const items = Array.from({ length: 6 }, (_, index) => post(`${index}`, {
    publishedAt: `2026-08-${20 + index}T00:00:00.000Z`,
  }));
  expect(selectMenuPosts(stateWith({ cachedPosts: items, unreadIds: items.map(({ id }) => id) }))).toHaveLength(6);
});

test('uses descending UTF-16 opaque IDs for equal and unavailable timestamp ties', () => {
  const items = [
    post('z', { publishedAt: null }),
    post('\u00e4', { publishedAt: null }),
    post('\u{10000}', { publishedAt: '2026-08-29T00:00:00.000Z' }),
    post('\uE000', { publishedAt: '2026-08-29T00:00:00.000Z' }),
  ];
  const state = stateWith({ cachedPosts: items, unreadIds: items.map(({ id }) => id) });

  expect(selectMenuPosts(state).map(({ id }) => id)).toEqual(['\uE000', '\u{10000}', '\u00e4', 'z']);
});

test('uses exact media and unavailable-link thought-bubble fallbacks', () => {
  const menu = renderSwiftBarMenu({
    state: stateWith({ cachedPosts: [post('media', { text: '', publishedAt: null, url: null })] }),
    pluginPath,
  });
  expect(menu).toContain('│  New media post from Tibo | color=#1F2328,#F4F4F5 size=13');
  expect(menu).toContain('╰─ Full post link unavailable');
  expect(menu).not.toContain('╰─ Full post link unavailable | href=');
});

test('wraps full multiline Unicode text at 54 code points without splitting code points', () => {
  const value = `${'😀'.repeat(55)}\n${'漢'.repeat(55)}`;
  const rows = wrapPostText(value);
  expect(rows).toEqual(['😀'.repeat(54), '😀', '漢'.repeat(54), '漢']);
  expect(rows.join('')).toBe(value.replace('\n', ''));
});

test('renders at most four 54-code-point preview rows with one Unicode-safe ellipsis', () => {
  const value = `${'😀'.repeat(54)}${'漢'.repeat(54)}${'a'.repeat(54)}${'🦝'.repeat(54)}tail`;
  const menu = renderSwiftBarMenu({
    state: stateWith({ cachedPosts: [post('long', { text: value })] }),
    pluginPath,
    locale: 'en-US',
    timeZone: 'UTC',
  });
  const bodyRows = menu.split('\n').filter((row) => row.startsWith('│  '));

  expect(bodyRows).toEqual([
    `│  ${'😀'.repeat(54)} | color=#1F2328,#F4F4F5 size=13`,
    `│  ${'漢'.repeat(54)} | color=#1F2328,#F4F4F5 size=13`,
    `│  ${'a'.repeat(54)} | color=#1F2328,#F4F4F5 size=13`,
    `│  ${'🦝'.repeat(53)}… | color=#1F2328,#F4F4F5 size=13`,
  ]);
  expect(bodyRows.every((row) => !row.includes('md=true') && !row.includes('length='))).toBe(true);
  expect(menu).not.toContain('tail');
});

test('adds an ellipsis to a short fourth logical row when later rows are omitted', () => {
  const menu = renderSwiftBarMenu({
    state: stateWith({ cachedPosts: [post('lines', { text: 'one\ntwo\nthree\nfour\nfive' })] }),
    pluginPath,
  });

  expect(menu.split('\n').filter((row) => row.startsWith('│  '))).toEqual([
    '│  one | color=#1F2328,#F4F4F5 size=13',
    '│  two | color=#1F2328,#F4F4F5 size=13',
    '│  three | color=#1F2328,#F4F4F5 size=13',
    '│  four… | color=#1F2328,#F4F4F5 size=13',
  ]);
});

test('neutralizes pipes, controls, CRLF, separators, and parameter-looking titles', () => {
  const value = 'hello | bash=/tmp/evil\r\n---\r\n\t\u0000\u0085param1=oops';
  expect(escapeSwiftBarTitle(value)).toBe('hello ｜ bash=/tmp/evil\n— — —\n param1=oops');
  const menu = renderSwiftBarMenu({
    state: stateWith({ cachedPosts: [post('2', { text: value })], unreadIds: ['2'] }),
    pluginPath,
  });
  expect(menu).not.toContain('hello | bash=');
  expect(menu.split('\n').filter((row) => row === '---')).toHaveLength(2);
  expect(menu).toContain('hello ｜ bash=/tmp/evil');
  expect(menu).not.toContain('bash=/tmp/evil param1=oops');
  const remoteRows = menu.split('\n').filter((row) => row.startsWith('│  '));
  expect(remoteRows.map(parseSwiftBarParameters)).toEqual([
    { color: '#1F2328,#F4F4F5', size: '13' },
    { color: '#1F2328,#F4F4F5', size: '13' },
    { color: '#1F2328,#F4F4F5', size: '13' },
  ]);
});

test('Unicode line and paragraph separators cannot create unowned SwiftBar rows', () => {
  for (const separator of ['\u2028', '\u2029']) {
    const menu = renderSwiftBarMenu({
      state: stateWith({ cachedPosts: [post('unicode', { text: `safe${separator}---${separator}tail` })] }),
      pluginPath,
    });
    const lines = splitSwiftBarLines(menu);
    expect(lines.filter((line) => line === '---')).toHaveLength(2);
    expect(lines).toContain('│  safe | color=#1F2328,#F4F4F5 size=13');
    expect(lines).toContain('│  — — — | color=#1F2328,#F4F4F5 size=13');
    expect(lines).toContain('│  tail | color=#1F2328,#F4F4F5 size=13');
    expect(lines.filter((line) => line.includes('safe') || line.includes('tail') || line.includes('— — —'))).toEqual([
      '│  safe | color=#1F2328,#F4F4F5 size=13',
      '│  — — — | color=#1F2328,#F4F4F5 size=13',
      '│  tail | color=#1F2328,#F4F4F5 size=13',
    ]);
  }
});

test('places one trusted separator between post thought-bubble groups', () => {
  const menu = renderSwiftBarMenu({
    state: stateWith({
      cachedPosts: [
        post('newer', { text: '---', publishedAt: '2026-08-29T00:00:00.000Z' }),
        post('older', { text: '---', publishedAt: '2026-08-28T00:00:00.000Z' }),
      ],
    }),
    pluginPath,
  });
  const lines = menu.split('\n');

  expect(lines.filter((row) => row === '---')).toHaveLength(3);
  expect(lines.filter((row) => row.includes('— — —'))).toEqual([
    '│  — — — | color=#1F2328,#F4F4F5 size=13',
    '│  — — — | color=#1F2328,#F4F4F5 size=13',
  ]);
  expect(lines.indexOf('╰─ Read full post on X → | href=https://x.com/thsottiaux/status/newer') + 1)
    .toBe(lines.indexOf('---', 2));
});

test('quotes only a safe absolute plugin path for actions', () => {
  for (const path of [
    '/tmp/Tibo Raccoon/tibo-raccoon.2m.js',
    "/tmp/Tibo Raccoon's/plugin.2m.js",
    '/tmp/back\\slash/plugin.2m.js',
    '/tmp/double"quote/plugin.2m.js',
  ]) {
    const actionLines = renderSwiftBarMenu({ state: stateWith(), pluginPath: path })
      .split('\n')
      .filter((line) => line.includes(' | bash='));
    expect(actionLines).toHaveLength(2);
    expect(actionLines.map(parseSwiftBarParameters)).toEqual([
      { bash: path, param1: 'mark-read', terminal: 'false', refresh: 'true' },
      { bash: path, param1: 'refresh-now', terminal: 'false', refresh: 'true' },
    ]);
  }
  expect(() => renderSwiftBarMenu({ state: stateWith(), pluginPath: '/tmp/evil | bash=/tmp/evil' })).toThrow();
  expect(() => renderSwiftBarMenu({ state: stateWith(), pluginPath: '/tmp/evil\nplugin' })).toThrow();
  expect(() => renderSwiftBarMenu({ state: stateWith(), pluginPath: '/tmp/evil\u0000plugin' })).toThrow();
  expect(() => renderSwiftBarMenu({ state: stateWith(), pluginPath: '/tmp/evil\u2028plugin' })).toThrow();
  expect(() => renderSwiftBarMenu({ state: stateWith(), pluginPath: '/tmp/evil\u2029plugin' })).toThrow();
  expect(() => renderSwiftBarMenu({ state: stateWith(), pluginPath: '/tmp/both\'"quotes/plugin' })).toThrow();
  expect(() => renderSwiftBarMenu({ state: stateWith(), pluginPath: '/tmp/plugin\\' })).toThrow();
  expect(() => renderSwiftBarMenu({ state: stateWith(), pluginPath: '/tmp/plugin\\\\' })).toThrow();
});

test('formats post times with the injected locale and time zone', () => {
  const menu = renderSwiftBarMenu({
    state: stateWith({ cachedPosts: [post('time', { publishedAt: '2026-08-29T00:00:00.000Z' })] }),
    pluginPath,
    locale: 'en-US',
    timeZone: 'America/Los_Angeles',
  });
  expect(menu).toContain(
    '╭─ Tibo · Aug 28, 2026 at 5:00 PM | sfimage=quote.bubble.fill '
      + 'sfcolor=#6F625C,#CFC5BF color=#3B3330,#F2EAE5 size=12',
  );
});

test('uses the trusted oxide accent and NEW label only for unread post headers', () => {
  const menu = renderSwiftBarMenu({
    state: stateWith({
      cachedPosts: [
        post('unread', { publishedAt: '2026-08-29T00:00:00.000Z' }),
        post('read', { publishedAt: '2026-08-28T00:00:00.000Z' }),
      ],
      unreadIds: ['unread'],
    }),
    pluginPath,
    locale: 'en-US',
    timeZone: 'UTC',
  });
  const postHeaders = menu.split('\n').filter((row) => row.startsWith('╭─ Tibo'));

  expect(postHeaders).toEqual([
    '╭─ Tibo · NEW · Aug 29, 2026 at 12:00 AM | sfimage=quote.bubble.fill '
      + 'sfcolor=#9A4D49,#CC7A74 color=#7B3735,#F1AAA3 size=12',
    '╭─ Tibo · Aug 28, 2026 at 12:00 AM | sfimage=quote.bubble.fill '
      + 'sfcolor=#6F625C,#CFC5BF color=#3B3330,#F2EAE5 size=12',
  ]);
});

test('renders state, stale, and offline status rows and prioritizes icons', () => {
  expect(chooseIconState(stateWith({ unreadIds: ['2'], consecutiveFailures: 7 }))).toBe('unread');
  expect(chooseIconState(stateWith({ unreadIds: [], consecutiveFailures: 3 }))).toBe('offline');
  expect(chooseIconState(stateWith())).toBe('calm');
  expect(renderSwiftBarMenu({ state: stateWith({ consecutiveFailures: 1 }), pluginPath })).toContain('Feed unavailable · showing cached posts');
  expect(renderSwiftBarMenu({ state: stateWith({ consecutiveFailures: 3 }), pluginPath })).toContain('Feed offline · showing cached posts');
  expect(renderSwiftBarMenu({ state: stateWith(), pluginPath, notice: 'state' })).toEndWith('Local state unavailable · cached status may be incomplete');
});

test('renders the complete ordered menu with trusted actions and successful-refresh ledger', () => {
  const state = stateWith({
    knownIds: ['post-1'],
    cachedPosts: [post('post-1', { text: 'first post', publishedAt: '2026-08-29T00:00:00.000Z' })],
    lastSuccessAt: '2026-08-29T12:34:00.000Z',
  });
  const menu = renderSwiftBarMenu({ state, pluginPath, locale: 'en-US', timeZone: 'UTC' });
  const localSuccessTimestamp = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date('2026-08-29T12:34:00.000Z'));
  expect(menu.split('\n')).toEqual([
    `| image=${ICON_BASE64.calm.light},${ICON_BASE64.calm.dark} dropdown=false`,
    '---',
    'Tibo Raccoon · 0 unread',
    '╭─ Tibo · Aug 29, 2026 at 12:00 AM | sfimage=quote.bubble.fill sfcolor=#6F625C,#CFC5BF color=#3B3330,#F2EAE5 size=12',
    '│  first post | color=#1F2328,#F4F4F5 size=13',
    '╰─ Read full post on X → | href=https://x.com/thsottiaux/status/post-1',
    '---',
    "Mark all as read | bash='/tmp/Tibo Raccoon/tibo-raccoon.2m.js' param1=mark-read terminal=false refresh=true",
    "Refresh now | bash='/tmp/Tibo Raccoon/tibo-raccoon.2m.js' param1=refresh-now terminal=false refresh=true",
    "Open Tibo's profile | href=https://x.com/thsottiaux",
    `Last successful refresh · ${localSuccessTimestamp}`,
  ]);
  const lines = menu.split('\n');
  expect(lines.filter((line) => line.includes('bash='))).toEqual([
    "Mark all as read | bash='/tmp/Tibo Raccoon/tibo-raccoon.2m.js' param1=mark-read terminal=false refresh=true",
    "Refresh now | bash='/tmp/Tibo Raccoon/tibo-raccoon.2m.js' param1=refresh-now terminal=false refresh=true",
  ]);
  expect(lines.filter((line) => !line.includes('bash=')).every((line) => !/\b(?:param\d|terminal|refresh)=/.test(line))).toBe(true);
});
