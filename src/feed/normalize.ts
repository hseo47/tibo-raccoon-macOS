import type { Post } from '../domain';

const MAX_ITEMS = 500;
const MAX_TEXT_CODE_POINTS = 32_768;
const ALLOWED_POST_HOSTS = new Set(['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com']);
const RFC_3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export class PayloadError extends Error {
  readonly publicMessage = 'Malformed feed payload';
}

export function normalizeDayclawPayload(value: unknown): Post[] {
  const items = extractItems(value);
  if (items.length > MAX_ITEMS) {
    throw new PayloadError();
  }

  const seenIds = new Set<string>();
  const posts: Post[] = [];
  for (const item of items) {
    if (!isRecord(item)) {
      throw new PayloadError();
    }

    const id = firstNonEmptyString(item, ['external_id', 'id', 'source_id']);
    if (id === null) {
      throw new PayloadError();
    }

    const text = firstNonEmptyString(item, ['content', 'text', 'title']) ?? '';
    if ([...text].length > MAX_TEXT_CODE_POINTS) {
      throw new PayloadError();
    }

    const publishedAt = firstValidTimestamp(item);
    const url = sanitizePostUrl(item.url);
    if (!seenIds.has(id)) {
      seenIds.add(id);
      posts.push({ id, text, publishedAt, url });
    }
  }

  return posts.sort(comparePosts);
}

export function parseRfc3339(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const match = RFC_3339.exec(value);
  if (match === null) {
    return null;
  }

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , zone] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (!isValidCalendarDate(year, month, day) || hour > 23 || minute > 59 || second > 59 || !isValidTimezone(zone)) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

export function sanitizePostUrl(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username !== '' ||
      url.password !== '' ||
      url.port !== '' ||
      !ALLOWED_POST_HOSTS.has(url.hostname)
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function extractItems(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (!isRecord(value)) {
    throw new PayloadError();
  }
  if (Array.isArray(value.items)) {
    return value.items;
  }
  if (isRecord(value.data) && Array.isArray(value.data.items)) {
    return value.data.items;
  }
  if (isRecord(value.result) && Array.isArray(value.result.items)) {
    return value.result.items;
  }
  throw new PayloadError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstNonEmptyString(item: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return null;
}

function firstValidTimestamp(item: Record<string, unknown>): string | null {
  for (const key of ['published_at', 'publishedAt', 'created_at', 'createdAt']) {
    const timestamp = parseRfc3339(item[key]);
    if (timestamp !== null) {
      return timestamp;
    }
  }
  return null;
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isValidTimezone(zone: string | undefined): boolean {
  if (zone === 'Z') {
    return true;
  }
  if (zone === undefined) {
    return false;
  }
  const [, hours, minutes] = /^([+-]\d{2}):(\d{2})$/.exec(zone) ?? [];
  return hours !== undefined && minutes !== undefined && Number(hours) <= 23 && Number(minutes) <= 59;
}

function comparePosts(left: Post, right: Post): number {
  if (left.publishedAt === null && right.publishedAt !== null) {
    return 1;
  }
  if (left.publishedAt !== null && right.publishedAt === null) {
    return -1;
  }
  if (left.publishedAt !== right.publishedAt) {
    return left.publishedAt === null || right.publishedAt === null ? 0 : right.publishedAt.localeCompare(left.publishedAt);
  }
  return right.id.localeCompare(left.id);
}
