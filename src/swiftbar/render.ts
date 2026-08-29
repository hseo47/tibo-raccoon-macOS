import { ICON_BASE64 } from '../generated/icons';
import { PROFILE_URL, type IconState, type Post, type RaccoonState, type RuntimeNotice } from '../domain';
import { quoteSwiftBarPluginPath } from './plugin-path';

const DEFAULT_WRAP_WIDTH = 72;
const DEFAULT_MINIMUM_POSTS = 5;

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
  const renderedPostRows = selectMenuPosts(state).flatMap((post) => renderPostRows(post, unreadIds.has(post.id), locale, resolvedTimeZone));
  const lines = [
    `| image=${ICON_BASE64[icon].light},${ICON_BASE64[icon].dark} dropdown=false`,
    '---',
    `Tibo Raccoon · ${state.unreadIds.length} unread`,
    ...renderedPostRows,
    '---',
    `Mark all as read | bash=${quotedPluginPath} param1=mark-read terminal=false refresh=true`,
    `Refresh now | bash=${quotedPluginPath} param1=refresh-now terminal=false refresh=true`,
    `Open Tibo's profile | href=${PROFILE_URL}`,
    renderStatus(state, notice ?? null),
  ];
  return lines.join('\n');
}

function renderPostRows(post: Post, unread: boolean, locale: string, timeZone: string): string[] {
  const timestamp = post.publishedAt === null
    ? 'Time unavailable'
    : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(post.publishedAt));
  const textRows = post.text === '' ? ['New media post from Tibo'] : wrapPostText(post.text);
  const rows = [`${unread ? 'Unread' : 'Read'} · ${timestamp}`, ...textRows.map((row) => `  ${row}`)];
  if (post.url === null) {
    rows.push('Original link unavailable');
  } else {
    rows.push(`Open original post | href=${post.url}`);
  }
  return rows;
}

function renderStatus(state: RaccoonState, notice: RuntimeNotice): string {
  if (notice === 'state') return 'Local state unavailable · cached status may be incomplete';
  if (state.consecutiveFailures >= 3) return 'Feed offline · showing cached posts';
  if (state.consecutiveFailures > 0) return 'Feed unavailable · showing cached posts';
  if (state.lastSuccessAt === null) return 'Waiting for first successful refresh';
  return `Last successful refresh · ${formatLocalTimestamp(state.lastSuccessAt)}`;
}

function formatLocalTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function comparePostsNewestFirst(left: Post, right: Post): number {
  if (left.publishedAt === null && right.publishedAt !== null) return 1;
  if (left.publishedAt !== null && right.publishedAt === null) return -1;
  if (left.publishedAt !== null && right.publishedAt !== null && left.publishedAt !== right.publishedAt) {
    return left.publishedAt > right.publishedAt ? -1 : 1;
  }
  return left.id === right.id ? 0 : left.id > right.id ? -1 : 1;
}
