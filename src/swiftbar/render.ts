import { ICON_BASE64 } from '../generated/icons';
import { compareOpaqueIds, PROFILE_URL, type IconState, type Post, type RaccoonState, type RuntimeNotice } from '../domain';
import { quoteSwiftBarPluginPath } from './plugin-path';

const DEFAULT_WRAP_WIDTH = 54;
const DEFAULT_MINIMUM_POSTS = 5;
const MAX_PREVIEW_ROWS = 3;
const BODY_PARAMETERS = 'color=#1F2328,#F4F4F5 size=13';
const READ_HEADER_PARAMETERS = 'color=#62636B,#CACBD1 size=12';
const UNREAD_HEADER_PARAMETERS = 'color=#9A4D49,#F1AAA3 size=12';

export function escapeSwiftBarTitle(value: string): string {
  const normalized = value.replace(/\r\n?|[\u2028\u2029]/g, '\n').replace(/\t/g, ' ');
  return normalized
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
    .replace(/\|/g, '｜')
    .split('\n')
    .map((row) => row === '---' ? '— — —' : row)
    .join('\n');
}

export function wrapPostText(value: string, width = DEFAULT_WRAP_WIDTH): string[] {
  if (!Number.isInteger(width) || width < 1) {
    throw new Error('Wrap width must be a positive integer');
  }

  const rows: string[] = [];
  for (const visualRow of escapeSwiftBarTitle(value).split('\n')) {
    const codePoints = Array.from(visualRow);
    if (codePoints.length === 0) {
      rows.push('');
      continue;
    }
    for (let start = 0; start < codePoints.length; start += width) {
      rows.push(codePoints.slice(start, start + width).join(''));
    }
  }
  return rows;
}

export function selectMenuPosts(state: RaccoonState, minimum = DEFAULT_MINIMUM_POSTS): Post[] {
  const safeMinimum = Math.max(0, minimum);
  const ordered = [...state.cachedPosts].sort(comparePostsNewestFirst);
  const unreadIds = new Set(state.unreadIds);
  const unread = ordered.filter(({ id }) => unreadIds.has(id));
  const read = ordered.filter(({ id }) => !unreadIds.has(id));
  return [...unread, ...read.slice(0, Math.max(0, safeMinimum - unread.length))];
}

export function chooseIconState(state: RaccoonState): IconState {
  if (state.unreadIds.length > 0) return 'unread';
  if (state.consecutiveFailures >= 3) return 'offline';
  return 'calm';
}

export function renderSwiftBarMenu(options: {
  state: RaccoonState;
  pluginPath: string;
  notice?: RuntimeNotice;
  locale?: string;
  timeZone?: string;
}): string {
  const { state, pluginPath, notice, locale = 'en-US', timeZone } = options;
  const icon = chooseIconState(state);
  const quotedPluginPath = quoteSwiftBarPluginPath(pluginPath);
  const resolvedTimeZone = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const unreadIds = new Set(state.unreadIds);
  const renderedPostRows = selectMenuPosts(state).flatMap((post, index) => [
    ...(index === 0 ? [] : ['---']),
    ...renderPostRows(post, unreadIds.has(post.id), locale, resolvedTimeZone),
  ]);
  const lines = [
    `| image=${ICON_BASE64[icon].light},${ICON_BASE64[icon].dark} dropdown=false`,
    '---',
    `Tibo Raccoon · ${state.unreadIds.length} unread`,
    ...renderedPostRows,
    '---',
    `Mark all as read | bash=${quotedPluginPath} param1=mark-read terminal=false refresh=true`,
    `Refresh now | bash=${quotedPluginPath} param1=refresh-now terminal=false refresh=true`,
    `Open Tibo's profile | href=${PROFILE_URL}`,
    renderStatus(state, notice ?? null, locale, resolvedTimeZone),
  ];
  return lines.join('\n');
}

function renderPostRows(post: Post, unread: boolean, locale: string, timeZone: string): string[] {
  const timestamp = post.publishedAt === null
    ? 'Time unavailable'
    : formatCompactTimestamp(post.publishedAt, locale, timeZone);
  const wrapped = wrapPostText(post.text).map((row) => row.trim()).filter((row) => row !== '');
  const textRows = previewRows(wrapped.length === 0 ? ['New media post from Tibo'] : wrapped);
  const header = `Tibo · ${unread ? 'NEW · ' : ''}${timestamp}${post.url === null ? '' : ' ↗'}`;
  const rows = [
    `${header} | ${post.url === null ? '' : `href=${post.url} `}${unread ? UNREAD_HEADER_PARAMETERS : READ_HEADER_PARAMETERS}`,
    ...textRows.map((row) => `${row} | ${BODY_PARAMETERS}`),
  ];
  if (post.url === null) rows.push('Full post link unavailable');
  return rows;
}

function previewRows(rows: string[]): string[] {
  const preview = rows.slice(0, MAX_PREVIEW_ROWS);
  if (rows.length <= MAX_PREVIEW_ROWS) return preview;

  const finalRow = Array.from(preview[MAX_PREVIEW_ROWS - 1] ?? '');
  preview[MAX_PREVIEW_ROWS - 1] = finalRow.length >= DEFAULT_WRAP_WIDTH
    ? `${finalRow.slice(0, DEFAULT_WRAP_WIDTH - 1).join('')}…`
    : `${finalRow.join('')}…`;
  return preview;
}

function renderStatus(state: RaccoonState, notice: RuntimeNotice, locale: string, timeZone: string): string {
  if (notice === 'state') return 'Local state unavailable · cached status may be incomplete';
  if (state.consecutiveFailures >= 3) return 'Feed offline · showing cached posts';
  if (state.consecutiveFailures > 0) return 'Feed unavailable · showing cached posts';
  if (state.lastSuccessAt === null) return 'Waiting for first successful refresh';
  return `Updated ${formatCompactTimestamp(state.lastSuccessAt, locale, timeZone)}`;
}

function formatCompactTimestamp(value: string, locale: string, timeZone: string): string {
  const date = new Date(value);
  const day = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone }).format(date);
  const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone }).format(date);
  return `${day}, ${time}`;
}

function comparePostsNewestFirst(left: Post, right: Post): number {
  if (left.publishedAt === null && right.publishedAt !== null) return 1;
  if (left.publishedAt !== null && right.publishedAt === null) return -1;
  if (left.publishedAt !== null && right.publishedAt !== null && left.publishedAt !== right.publishedAt) {
    return left.publishedAt > right.publishedAt ? -1 : 1;
  }
  return compareOpaqueIds(right.id, left.id);
}
