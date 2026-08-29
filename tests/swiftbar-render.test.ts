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

test('uses exact media and unavailable-link fallbacks', () => {
  const menu = renderSwiftBarMenu({
    state: stateWith({ cachedPosts: [post('media', { text: '', publishedAt: null, url: null })] }),
    pluginPath,
  });
  expect(menu).toContain('New media post from Tibo');
  expect(menu).toContain('Original link unavailable');
  expect(menu).not.toContain('Original link unavailable | href=');
});

test('wraps full multiline Unicode text at 72 code points without truncation', () => {
  const value = `${'😀'.repeat(73)}\n${'漢'.repeat(73)}`;
  const rows = wrapPostText(value);
  expect(rows).toEqual(['😀'.repeat(72), '😀', '漢'.repeat(72), '漢']);
  expect(rows.join('')).toBe(value.replace('\n', ''));
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
});

test('quotes only a safe absolute plugin path for actions', () => {
  const menu = renderSwiftBarMenu({
    state: stateWith(),
    pluginPath: "/tmp/Tibo Raccoon's\\plugin.2m.js",
  });
  expect(menu).toContain("bash='/tmp/Tibo Raccoon\\'s\\\\plugin.2m.js' param1=mark-read");
  expect(() => renderSwiftBarMenu({ state: stateWith(), pluginPath: '/tmp/evil | bash=/tmp/evil' })).toThrow();
  expect(() => renderSwiftBarMenu({ state: stateWith(), pluginPath: '/tmp/evil\nplugin' })).toThrow();
  expect(() => renderSwiftBarMenu({ state: stateWith(), pluginPath: '/tmp/evil\u0000plugin' })).toThrow();
});

test('formats post times with the injected locale and time zone', () => {
  const menu = renderSwiftBarMenu({
    state: stateWith({ cachedPosts: [post('time', { publishedAt: '2026-08-29T00:00:00.000Z' })] }),
    pluginPath,
    locale: 'en-US',
    timeZone: 'America/Los_Angeles',
  });
  expect(menu).toContain('Read · Aug 28, 2026 at 5:00 PM');
});

test('renders state, stale, and offline status rows and prioritizes icons', () => {
  expect(chooseIconState(stateWith({ unreadIds: ['2'], consecutiveFailures: 7 }))).toBe('unread');
  expect(chooseIconState(stateWith({ unreadIds: [], consecutiveFailures: 3 }))).toBe('offline');
  expect(chooseIconState(stateWith())).toBe('calm');
  expect(renderSwiftBarMenu({ state: stateWith({ consecutiveFailures: 1 }), pluginPath })).toContain('Feed unavailable · showing cached posts');
  expect(renderSwiftBarMenu({ state: stateWith({ consecutiveFailures: 3 }), pluginPath })).toContain('Feed offline · showing cached posts');
  expect(renderSwiftBarMenu({ state: stateWith(), pluginPath, notice: 'state' })).toEndWith('Local state unavailable · cached status may be incomplete');
});
