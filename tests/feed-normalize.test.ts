import { describe, expect, test } from 'bun:test';
import {
  normalizeDayclawPayload,
  parseRfc3339,
  PayloadError,
  sanitizePostUrl,
} from '../src/feed/normalize';

describe('normalizeDayclawPayload', () => {
  test('accepts each supported response envelope', () => {
    const item = { id: '1', content: 'hello' };

    expect(normalizeDayclawPayload([item])).toHaveLength(1);
    expect(normalizeDayclawPayload({ items: [item] })).toHaveLength(1);
    expect(normalizeDayclawPayload({ data: { items: [item] } })).toHaveLength(1);
    expect(normalizeDayclawPayload({ result: { items: [item] } })).toHaveLength(1);
  });

  test('keeps the first duplicate and prefers external IDs', () => {
    const posts = normalizeDayclawPayload({
      items: [
        { external_id: 'preferred', id: 'ignored', content: 'first' },
        { id: 'preferred', content: 'second' },
      ],
    });

    expect(posts).toEqual([{ id: 'preferred', text: 'first', publishedAt: null, url: null }]);
  });

  test('uses the first non-empty text field and retains empty media-only posts', () => {
    const posts = normalizeDayclawPayload({
      items: [
        { id: 'fallback', content: '', text: 'fallback text', title: 'title' },
        { external_id: '42', content: '', url: 'https://x.com/thsottiaux/status/42' },
      ],
    });

    expect(posts).toEqual([
      { id: 'fallback', text: 'fallback text', publishedAt: null, url: null },
      { id: '42', text: '', publishedAt: null, url: 'https://x.com/thsottiaux/status/42' },
    ]);
  });

  test('normalizes an item with absent text fields to empty text', () => {
    expect(normalizeDayclawPayload({ items: [{ id: 'absent-text' }] })).toEqual([
      { id: 'absent-text', text: '', publishedAt: null, url: null },
    ]);
  });

  test('rejects non-objects, missing IDs, oversized item lists, and oversized text', () => {
    expect(() => normalizeDayclawPayload({ items: [null] })).toThrow(PayloadError);
    expect(() => normalizeDayclawPayload({ items: [{ content: 'missing ID' }] })).toThrow(PayloadError);
    expect(() => normalizeDayclawPayload({ items: Array.from({ length: 501 }, (_, id) => ({ id: String(id) })) })).toThrow(PayloadError);
    expect(() => normalizeDayclawPayload({ items: [{ id: 'long', content: 'a'.repeat(32_769) }] })).toThrow(PayloadError);
  });

  test('sorts valid timestamps descending and untimestamped posts by descending ID', () => {
    const posts = normalizeDayclawPayload({
      items: [
        { id: 'a', content: 'same time', published_at: '2026-08-29T00:00:00Z' },
        { id: 'z', content: 'same time', published_at: '2026-08-29T00:00:00Z' },
        { id: 'older', content: 'old', publishedAt: '2026-08-28T00:00:00Z' },
        { id: 'no-time-a', content: 'none' },
        { id: 'no-time-z', content: 'none', created_at: 'not-a-date' },
      ],
    });

    expect(posts.map(({ id }) => id)).toEqual(['z', 'a', 'older', 'no-time-z', 'no-time-a']);
  });
});

test('accepts only strict timezone-bearing RFC 3339', () => {
  expect(parseRfc3339('2026-08-29T12:34:56+08:00')).toBe('2026-08-29T04:34:56.000Z');
  expect(parseRfc3339('0000-02-29T12:34:56Z')).toBe('0000-02-29T12:34:56.000Z');
  expect(parseRfc3339('2026-02-30T12:34:56Z')).toBeNull();
  expect(parseRfc3339('2026-08-29 12:34:56')).toBeNull();
});

test('rejects unsafe post URLs', () => {
  expect(sanitizePostUrl('https://x.com/thsottiaux/status/42')).toBe('https://x.com/thsottiaux/status/42');
  expect(sanitizePostUrl('https://twitter.com/thsottiaux/status/42')).toBe('https://twitter.com/thsottiaux/status/42');
  expect(sanitizePostUrl('http://x.com/thsottiaux/status/42')).toBeNull();
  expect(sanitizePostUrl('https://x.com.evil.example/42')).toBeNull();
  expect(sanitizePostUrl('https://user@x.com/42')).toBeNull();
  expect(sanitizePostUrl('https://x.com:8443/42')).toBeNull();
  expect(sanitizePostUrl('https://example.com/42')).toBeNull();
});
