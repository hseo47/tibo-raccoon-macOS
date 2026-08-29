# Tibo Raccoon SwiftBar Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-file SwiftBar plugin that checks Tibo's public Dayclaw feed every two minutes, preserves all newly observed posts as unread, and communicates calm, unread, and offline states with the approved chubby pixel raccoon.

**Architecture:** Small Bun/TypeScript modules isolate feed validation, pure state transitions, private filesystem persistence, polling policy, pixel-art generation, SwiftBar rendering, and CLI actions. A deterministic build embeds six canonical PNGs and all runtime logic into one executable `tibo-raccoon.2m.js`; install and uninstall tooling remain explicit, user-invoked operations.

**Tech Stack:** Bun, TypeScript, `bun:test`, Bun's built-in web/filesystem/process APIs, SwiftBar's standard-plugin protocol, and a dev-only TypeScript compiler. There are no third-party runtime packages.

**Spec:** `docs/superpowers/specs/2026-08-29-tibo-raccoon-swiftbar-design.md`

## Global Constraints

- Watch every item returned by `https://api.dayclaw.com/api/source/public/x/thsottiaux/items`; never classify, summarize, or filter for reset relevance.
- The installed filename is `tibo-raccoon.2m.js`; scheduled polling is every two minutes with `2, 4, 8, 16, 30` minute failure backoff.
- The first successful response is an all-read baseline. Every later unknown ID is unread until **Mark all as read**; individual post opens never mark read.
- A recognized empty response initializes normally. Corrupt or unsupported state is preserved, and recovery treats current items as unread.
- Persist private state under `~/Library/Application Support/Tibo Raccoon/` with directory mode `0700`, file mode `0600`, locking, and atomic replacement.
- Network access is fixed HTTPS GET traffic to `api.dayclaw.com`; redirects, oversized payloads, credentials, analytics, media downloads, and X/OpenAI authentication are forbidden.
- Only validated HTTPS URLs on `x.com`, `www.x.com`, `twitter.com`, or `www.twitter.com` become clickable post links.
- The menu-bar header contains only the raccoon image. Dropdown count and post content remain in the menu.
- Icon precedence is `unread > offline > calm`; unread uses outlined ember-and-yellow flame eyes plus the oxide-red corner frame, calm uses relaxed eyes, and offline uses closed eyes.
- Render every unread post, then enough recent read posts to show at least five posts. Never auto-clear or hide unread posts.
- The installed artifact is one executable Bun script with an absolute Bun shebang, `runInBash=false`, and embedded light/dark images.
- The installer checks prerequisites but never installs Bun, SwiftBar, Homebrew, login items, launch agents, or dependencies.
- Repository build and test work is allowed. Copying into the user's live SwiftBar directory remains a separate explicit approval.
- Tests may override the state root only when `TIBO_RACCOON_TEST_MODE=1`; production feed and state defaults remain fixed.

## File Structure

| Path | Responsibility |
| --- | --- |
| `package.json`, `bun.lock`, `tsconfig.json` | Reproducible Bun scripts and strict TypeScript settings; dev dependencies only. |
| `src/domain.ts` | Shared immutable types, constants, error categories, and clock interface. |
| `src/feed/normalize.ts` | Strict Dayclaw envelope/item normalization, RFC 3339 validation, URL allowlisting, and deterministic ordering. |
| `src/feed/client.ts` | Fixed-origin HTTPS fetch, redirect/timeout/body-size policy, JSON parsing, and sanitized feed errors. |
| `src/artwork/grid.ts` | Approved 39×29 palettes and ordered integer spans for calm, unread, and offline raccoons. |
| `src/artwork/png.ts` | Pure RGBA rasterization and deterministic PNG encoding with stored DEFLATE blocks. |
| `src/generated/icons.ts` | Generated Base64 constants and SHA-256 hashes for all six icons. |
| `assets/icons/*.png`, `assets/icons/sha256.json` | Canonical checked-in PNG bytes and hash manifest. |
| `src/state/model.ts` | Pure initialization, merge, unread/read, pruning, success, failure, and state-validation transitions. |
| `src/state/store.ts` | Default paths, private permissions, owner-aware lock, corrupt-state quarantine, and atomic writes. |
| `src/poll.ts` | Scheduled/forced polling, 30-second duplicate guard, backoff checks, and fetch-outside-lock coordination. |
| `src/swiftbar/render.ts` | Icon selection, safe wrapping/escaping, post selection, timestamp/status formatting, and menu actions. |
| `src/cli.ts` | Exact no-argument, `mark-read`, and `refresh-now` command contract with injected dependencies. |
| `src/main.ts` | Production dependency wiring, test-only path override, stdout/stderr, and exit codes. |
| `scripts/generate-icons.ts` | Regenerate canonical PNGs, manifest, and generated Base64 module. |
| `scripts/build.ts` | Bundle one executable plugin, prepend metadata/shebang, verify contents, and set mode `0755`. |
| `scripts/install.ts`, `scripts/uninstall.ts` | Explicit prerequisite checks and exact-target copy/removal without touching state by default. |
| `scripts/live-check.ts` | Opt-in read-only validation of the current Dayclaw payload; no state access. |
| `tests/fixtures/*.json` | Small local Dayclaw response fixtures, including media-only and malformed cases. |
| `tests/helpers/*.ts` | Typed post/state factories, fake clock, temporary state paths, and deterministic test dependencies. |
| `tests/*.test.ts` | Focused unit, concurrency, build, installer, and acceptance coverage. |
| `README.md` | Requirements, build/test commands, explicit install/uninstall steps, privacy boundary, and limitations. |

---

### Task 1: Project Foundation and Feed Normalization

**Files:**
- Create: `package.json`
- Create: `bun.lock`
- Create: `tsconfig.json`
- Create: `src/domain.ts`
- Create: `src/feed/normalize.ts`
- Create: `tests/fixtures/dayclaw-current.json`
- Create: `tests/fixtures/dayclaw-media-only.json`
- Create: `tests/fixtures/dayclaw-malformed.json`
- Create: `tests/helpers/factories.ts`
- Create: `tests/feed-normalize.test.ts`

**Interfaces:**
- Consumes: the source-field and validation rules in the approved spec.
- Produces: `Post`, `RaccoonState`, `FeedErrorKind`, `RuntimeNotice`, `Clock`, `FEED_URL`, `PROFILE_URL`, `normalizeDayclawPayload(value)`, `parseRfc3339(value)`, `sanitizePostUrl(value)`, and test-only `post(id, overrides)`/`stateWith(overrides)` factories for every later task.

- [ ] **Step 1: Add the Bun project metadata and strict compiler configuration**

Create `package.json` with no runtime dependencies:

```json
{
  "name": "tibo-raccoon-swiftbar",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "bun test",
    "typecheck": "tsc --noEmit",
    "generate:icons": "bun run scripts/generate-icons.ts",
    "build": "bun run scripts/build.ts",
    "live-check": "bun run scripts/live-check.ts",
    "check": "bun run typecheck && bun test && bun run build"
  },
  "devDependencies": {
    "@types/bun": "^1.2.0",
    "typescript": "^5.9.0"
  }
}
```

Create `tsconfig.json` with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noEmit`, `moduleResolution: "Bundler"`, and Bun types. Run `bun install` once to create `bun.lock`; this is contributor setup, never an installer action.

- [ ] **Step 2: Write failing normalization tests and realistic local fixtures**

The tests must cover all four accepted envelopes, first-occurrence duplicate handling, external-ID precedence, absent/empty text, media-only fallback input, strict RFC 3339 including impossible dates, deterministic ordering, a 501-item rejection, text over 32,768 code points, and URL rejection for credentials, ports, HTTP, suffix attacks, and unrelated hosts.

```ts
import { describe, expect, test } from 'bun:test';
import {
  normalizeDayclawPayload,
  parseRfc3339,
  sanitizePostUrl,
} from '../src/feed/normalize';

test('normalizes a media-only post without dropping it', () => {
  const posts = normalizeDayclawPayload({
    items: [{ external_id: '42', content: '', url: 'https://x.com/thsottiaux/status/42' }],
  });
  expect(posts).toEqual([{ id: '42', text: '', publishedAt: null, url: 'https://x.com/thsottiaux/status/42' }]);
});

test('accepts only strict timezone-bearing RFC 3339', () => {
  expect(parseRfc3339('2026-08-29T12:34:56+08:00')).toBe('2026-08-29T04:34:56.000Z');
  expect(parseRfc3339('2026-02-30T12:34:56Z')).toBeNull();
  expect(parseRfc3339('2026-08-29 12:34:56')).toBeNull();
});

test('rejects unsafe post URLs', () => {
  expect(sanitizePostUrl('https://x.com/thsottiaux/status/42')).toBe('https://x.com/thsottiaux/status/42');
  expect(sanitizePostUrl('https://x.com.evil.example/42')).toBeNull();
  expect(sanitizePostUrl('https://user@x.com/42')).toBeNull();
  expect(sanitizePostUrl('https://x.com:8443/42')).toBeNull();
});
```

- [ ] **Step 3: Run the focused test to verify it fails**

Run: `bun test tests/feed-normalize.test.ts`

Expected: FAIL because `src/feed/normalize.ts` and its exports do not exist.

- [ ] **Step 4: Implement the shared contracts and strict normalizer**

Use these exact public contracts in `src/domain.ts`:

```ts
export const FEED_URL = 'https://api.dayclaw.com/api/source/public/x/thsottiaux/items' as const;
export const PROFILE_URL = 'https://x.com/thsottiaux' as const;

export type Post = {
  id: string;
  text: string;
  publishedAt: string | null;
  url: string | null;
};

export type FeedErrorKind = 'timeout' | 'http' | 'oversize' | 'malformed' | 'network';
export type RuntimeNotice = 'state' | null;
export type IconState = 'calm' | 'unread' | 'offline';
export type Appearance = 'light' | 'dark';

export type RaccoonState = {
  version: 1;
  initializedAt: string | null;
  recoveryPending: boolean;
  knownIds: string[];
  unreadIds: string[];
  cachedPosts: Post[];
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  consecutiveFailures: number;
  nextRetryAt: string | null;
  lastError: string | null;
};

export interface Clock {
  now(): Date;
}
```

Expose these exact normalizer signatures:

```ts
export class PayloadError extends Error {
  readonly publicMessage = 'Malformed feed payload';
}

export function normalizeDayclawPayload(value: unknown): Post[];
export function parseRfc3339(value: unknown): string | null;
export function sanitizePostUrl(value: unknown): string | null;
```

In `normalize.ts`, accept only root arrays or `items`, `data.items`, and `result.items`; reject non-object items and missing IDs; choose `external_id`, then `id`, then `source_id`; choose the first non-empty string among `content`, `text`, and `title`, otherwise `''`; read URLs only from `url`; validate calendar components before `Date.parse`; keep the first duplicate; sort by timestamp descending and then ID descending.

Create the shared test factories without production imports beyond types:

```ts
export function post(id: string, overrides: Partial<Post> = {}): Post;
export function stateWith(overrides: Partial<RaccoonState> = {}): RaccoonState;
```

`post` defaults to text `post ${id}`, timestamp `2026-08-29T00:00:00.000Z`, and `https://x.com/thsottiaux/status/${id}`. `stateWith` supplies every version-1 property with empty/zero/null defaults, then applies overrides.

- [ ] **Step 5: Run normalization tests and type checking**

Run: `bun test tests/feed-normalize.test.ts && bun run typecheck`

Expected: all normalization tests PASS and TypeScript exits `0`.

- [ ] **Step 6: Commit the normalized feed contract**

```bash
git add package.json bun.lock tsconfig.json src/domain.ts src/feed/normalize.ts tests/fixtures tests/helpers/factories.ts tests/feed-normalize.test.ts
git commit -m "feat: normalize Tibo feed payloads"
```

### Task 2: Bounded Dayclaw Feed Client

**Files:**
- Create: `src/feed/client.ts`
- Create: `tests/feed-client.test.ts`

**Interfaces:**
- Consumes: `FEED_URL`, `FeedErrorKind`, `Post`, and `normalizeDayclawPayload` from Task 1.
- Produces: `FeedError`, `FetchLike`, `fetchDayclawPosts(options)` for the poll coordinator and live checker.

- [ ] **Step 1: Write failing HTTP-policy tests with an injected fetch**

```ts
import { expect, test } from 'bun:test';
import { fetchDayclawPosts } from '../src/feed/client';

test('uses the fixed URL, rejects redirects, and returns normalized posts', async () => {
  let seen: { input: string; init: RequestInit | undefined } | undefined;
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    seen = { input: String(input), init };
    return new Response(JSON.stringify({ items: [{ id: '1', content: 'hello' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const posts = await fetchDayclawPosts({ fetchImpl });
  expect(posts[0]?.id).toBe('1');
  expect(seen?.input).toBe('https://api.dayclaw.com/api/source/public/x/thsottiaux/items');
  expect(seen?.init?.redirect).toBe('error');
});
```

Add cases for an 8-second abort signal, non-2xx HTTP, declared and streamed bodies over 2 MiB, malformed JSON, malformed normalized payloads, and network exceptions. Assert that `FeedError.publicMessage` contains only a broad category and optional HTTP status—never response text, stack traces, URLs with query data, or the original exception message.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `bun test tests/feed-client.test.ts`

Expected: FAIL because `src/feed/client.ts` does not exist.

- [ ] **Step 3: Implement the fixed-origin, size-bounded client**

Use these interfaces:

```ts
export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export class FeedError extends Error {
  constructor(
    readonly kind: FeedErrorKind,
    readonly publicMessage: string,
    readonly status?: number,
  ) {
    super(publicMessage);
    this.name = 'FeedError';
  }
}

export async function fetchDayclawPosts(options: {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  maxBytes?: number;
} = {}): Promise<Post[]>;
```

Call only `FEED_URL` with `{ method: 'GET', redirect: 'error', signal }`. Reject `Content-Length` over `2 * 1024 * 1024` before reading. Otherwise consume `response.body.getReader()` while counting bytes and cancel immediately when the limit is crossed. Decode UTF-8 once, parse JSON once, normalize once, and map every thrown condition to the fixed error categories.

- [ ] **Step 4: Run the client and normalization tests**

Run: `bun test tests/feed-client.test.ts tests/feed-normalize.test.ts && bun run typecheck`

Expected: all tests PASS and TypeScript exits `0`.

- [ ] **Step 5: Commit the bounded feed client**

```bash
git add src/feed/client.ts tests/feed-client.test.ts
git commit -m "feat: add bounded Dayclaw feed client"
```

### Task 3: Deterministic Raccoon Artwork

**Files:**
- Create: `src/artwork/grid.ts`
- Create: `src/artwork/png.ts`
- Create: `scripts/generate-icons.ts`
- Create: `src/generated/icons.ts`
- Create: `assets/icons/calm-light.png`
- Create: `assets/icons/calm-dark.png`
- Create: `assets/icons/unread-light.png`
- Create: `assets/icons/unread-dark.png`
- Create: `assets/icons/offline-light.png`
- Create: `assets/icons/offline-dark.png`
- Create: `assets/icons/sha256.json`
- Create: `tests/artwork.test.ts`

**Interfaces:**
- Consumes: `Appearance` and `IconState` from Task 1 plus exact grid/palette values from the spec.
- Produces: `renderRaccoonRgba(state, appearance)`, `encodeDeterministicPng(rgba, width, height)`, and generated `ICON_BASE64`/`ICON_SHA256` constants for the renderer and build.

- [ ] **Step 1: Write failing pixel and PNG-structure tests**

Test exact dimensions, transparent corners, round-cheek silhouette spans, calm/offline eye coordinates, unread flame outline/outer/core coordinates, flame and oxide pixels only in unread, all palette values in both appearances, layer precedence, horizontal flame mirroring, and deterministic PNG chunks.

```ts
import { expect, test } from 'bun:test';
import { renderRaccoonRgba } from '../src/artwork/grid';
import { encodeDeterministicPng } from '../src/artwork/png';

test('unread uses the approved outlined fire eyes and oxide frame', () => {
  const rgba = renderRaccoonRgba('unread', 'light');
  expect(pixel(rgba, 39, 12, 7)).toEqual([0x17, 0x19, 0x1b, 0xff]);
  expect(pixel(rgba, 39, 12, 9)).toEqual([0xd6, 0x4b, 0x2a, 0xff]);
  expect(pixel(rgba, 39, 12, 11)).toEqual([0xff, 0xc2, 0x47, 0xff]);
  expect(pixel(rgba, 39, 26, 7)).toEqual(pixel(rgba, 39, 12, 7));
  expect(pixel(rgba, 39, 1, 5)).toEqual([0x9a, 0x4d, 0x49, 0xff]);
  expect(pixel(rgba, 39, 0, 0)).toEqual([0, 0, 0, 0]);
});

test('PNG encoding is byte-stable and contains only required chunks', () => {
  const rgba = renderRaccoonRgba('calm', 'light');
  const first = encodeDeterministicPng(rgba, 39, 29);
  const second = encodeDeterministicPng(rgba, 39, 29);
  expect(first).toEqual(second);
  expect(readChunkNames(first)).toEqual(['IHDR', 'IDAT', 'IEND']);
});
```

Define `pixel(rgba, width, x, y): [number, number, number, number]` and `readChunkNames(png): string[]` as local test helpers in `tests/artwork.test.ts`; `readChunkNames` walks the PNG length/type/data/CRC structure without using production parsing code.

- [ ] **Step 2: Run the artwork test to verify it fails**

Run: `bun test tests/artwork.test.ts`

Expected: FAIL because the artwork modules do not exist.

- [ ] **Step 3: Implement the approved integer grid and deterministic encoder**

Represent filled rows as inclusive spans so there is no SVG parser or antialiasing:

```ts
type Role = 'fur' | 'mask' | 'face' | 'eye' | 'flameOuter' | 'flameCore' | 'oxide';
type Span = readonly [y: number, x0: number, x1: number, role: Role];

export const WIDTH = 39;
export const HEIGHT = 29;

export const PALETTES = {
  light: {
    fur: '#8a9299', mask: '#34393e', face: '#d8dbde', eye: '#17191b',
    flameOuter: '#d64b2a', flameCore: '#ffc247', oxide: '#9a4d49',
  },
  dark: {
    fur: '#aab1b7', mask: '#2b3035', face: '#d7dadc', eye: '#151719',
    flameOuter: '#ff6b47', flameCore: '#ffd166', oxide: '#cc7a74',
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
  [5, 1, 5, 'oxide'], ...rows(6, 9, 1, 1, 'oxide'),
  [5, 33, 37, 'oxide'], ...rows(6, 9, 37, 37, 'oxide'),
  ...rows(22, 25, 1, 1, 'oxide'), [26, 1, 5, 'oxide'],
  ...rows(22, 25, 37, 37, 'oxide'), [26, 33, 37, 'oxide'],
];
const OFFLINE: readonly Span[] = [
  ...rows(13, 14, 10, 12, 'face'), ...rows(13, 14, 26, 28, 'face'),
  [14, 10, 12, 'eye'], [14, 26, 28, 'eye'],
];
```

Paint transparent RGBA first, then `SHARED`, the state-specific face/eyes or ordered flame outline/outer/core spans, `NOSE`, and finally the unread oxide spans so the layer order matches the approved geometry. Implement PNG signature, `IHDR`, one `IDAT`, and `IEND`; each scanline starts with filter byte `0`, the zlib stream uses stored DEFLATE blocks, and CRC-32/Adler-32 are calculated in code.

- [ ] **Step 4: Generate and pin canonical icon bytes**

Implement `scripts/generate-icons.ts` to write all six PNGs, calculate SHA-256 with `Bun.CryptoHasher`, write a sorted `sha256.json`, and generate `src/generated/icons.ts` from the in-memory maps:

```ts
const base64ByState = {} as Record<IconState, Record<Appearance, string>>;
const hashByState = {} as Record<IconState, Record<Appearance, string>>;
for (const state of ['calm', 'unread', 'offline'] as const) {
  base64ByState[state] = {} as Record<Appearance, string>;
  hashByState[state] = {} as Record<Appearance, string>;
  for (const appearance of ['light', 'dark'] as const) {
    const png = encodeDeterministicPng(renderRaccoonRgba(state, appearance), WIDTH, HEIGHT);
    base64ByState[state][appearance] = Buffer.from(png).toString('base64');
    hashByState[state][appearance] = new Bun.CryptoHasher('sha256').update(png).digest('hex');
  }
}

const moduleSource = [
  "import type { Appearance, IconState } from '../domain';",
  `export const ICON_BASE64 = ${JSON.stringify(base64ByState, null, 2)} as const satisfies Record<IconState, Record<Appearance, string>>;`,
  `export const ICON_SHA256 = ${JSON.stringify(hashByState, null, 2)} as const satisfies Record<IconState, Record<Appearance, string>>;`,
  '',
].join('\n');
await Bun.write('src/generated/icons.ts', moduleSource);
```

Run: `bun run generate:icons`. The generated module contains the actual Base64 and hash strings and is committed for review.

- [ ] **Step 5: Extend tests to verify generated files and embedded constants byte for byte**

For every state/appearance pair, read the canonical PNG, compare its SHA-256 to the manifest and `ICON_SHA256`, decode `ICON_BASE64`, and compare exact bytes. Run the generator a second time and assert `git diff --exit-code -- assets/icons src/generated/icons.ts`.

- [ ] **Step 6: Run artwork tests and type checking**

Run: `bun test tests/artwork.test.ts && bun run typecheck`

Expected: all artwork tests PASS and TypeScript exits `0`.

- [ ] **Step 7: Commit the canonical raccoon assets**

```bash
git add src/artwork scripts/generate-icons.ts src/generated/icons.ts assets/icons tests/artwork.test.ts
git commit -m "feat: add deterministic raccoon artwork"
```

### Task 4: Pure Unread and Backoff State Model

**Files:**
- Create: `src/state/model.ts`
- Create: `tests/state-model.test.ts`

**Interfaces:**
- Consumes: `Post`, `RaccoonState`, and `FeedErrorKind` from Task 1.
- Produces: `createInitialState`, `parseState`, `applySuccessfulPoll`, `applyFailedPoll`, `markAllRead`, `nextBackoffMinutes`, and `selectCachedPosts` for persistence and polling.

- [ ] **Step 1: Write failing pure-transition tests**

Cover a non-empty first-run baseline, empty first-run baseline, recovery-mode unread-first behavior, later new IDs, first-occurrence deduplication, all-unread retention, 100-read-post pruning, permanent known IDs, mark-all-read, and exact backoff saturation.

```ts
import { expect, test } from 'bun:test';
import {
  applyFailedPoll,
  applySuccessfulPoll,
  createInitialState,
  markAllRead,
} from '../src/state/model';
import { post } from './helpers/factories';

test('first success is read but a later unknown ID is unread', () => {
  const initial = createInitialState();
  const baseline = applySuccessfulPoll(initial, [post('1')], '2026-08-29T00:00:00.000Z');
  expect(baseline.unreadIds).toEqual([]);
  const updated = applySuccessfulPoll(baseline, [post('2'), post('1')], '2026-08-29T00:02:00.000Z');
  expect(updated.unreadIds).toEqual(['2']);
});

test('recovery favors duplicate alerts over hidden posts', () => {
  const recovering = createInitialState({ recoveryPending: true });
  const state = applySuccessfulPoll(recovering, [post('1')], '2026-08-29T00:00:00.000Z');
  expect(state.unreadIds).toEqual(['1']);
  expect(state.recoveryPending).toBe(false);
});

test('failure backoff saturates at thirty minutes', () => {
  let state = createInitialState();
  for (let count = 1; count <= 7; count += 1) {
    state = applyFailedPoll(state, 'timeout', new Date(`2026-08-29T00:0${count}:00Z`).toISOString());
  }
  expect(state.consecutiveFailures).toBe(7);
  expect(Date.parse(state.nextRetryAt!) - Date.parse(state.lastAttemptAt!)).toBe(30 * 60_000);
});
```

- [ ] **Step 2: Run the model test to verify it fails**

Run: `bun test tests/state-model.test.ts`

Expected: FAIL because `src/state/model.ts` does not exist.

- [ ] **Step 3: Implement immutable state transitions and strict persisted-state validation**

Use these signatures:

```ts
export function createInitialState(options?: { recoveryPending?: boolean }): RaccoonState;
export function parseState(value: unknown): RaccoonState;
export function applySuccessfulPoll(state: RaccoonState, posts: readonly Post[], nowIso: string): RaccoonState;
export function applyFailedPoll(state: RaccoonState, kind: FeedErrorKind, nowIso: string): RaccoonState;
export function markAllRead(state: RaccoonState): RaccoonState;
export function nextBackoffMinutes(consecutiveFailures: number): 2 | 4 | 8 | 16 | 30;
export function selectCachedPosts(posts: readonly Post[], unreadIds: readonly string[]): Post[];
```

Never mutate input arrays. Store `knownIds` as unique ascending lexical IDs. Store `cachedPosts` and `unreadIds` in the same timestamp-descending/ID-descending order used by the normalizer. Keep every cached unread post plus the newest 100 read posts. `applySuccessfulPoll` updates attempt/success timestamps and clears errors/backoff. `applyFailedPoll` preserves cached and unread data, increments the count, stores only the category string, and calculates `nextRetryAt` from the provided clock value.

- [ ] **Step 4: Run model, normalizer, and type checks**

Run: `bun test tests/state-model.test.ts tests/feed-normalize.test.ts && bun run typecheck`

Expected: all tests PASS and TypeScript exits `0`.

- [ ] **Step 5: Commit the pure state model**

```bash
git add src/state/model.ts tests/state-model.test.ts
git commit -m "feat: model unread and backoff state"
```

### Task 5: Private Atomic State Store

**Files:**
- Create: `src/state/store.ts`
- Create: `tests/helpers/temp-state.ts`
- Create: `tests/state-store.test.ts`

**Interfaces:**
- Consumes: `RaccoonState`, `createInitialState`, and `parseState` from Tasks 1 and 4.
- Produces: `StatePaths`, `StateLoad`, `defaultStatePaths`, `loadState`, `mutateState`, and `StateStoreError` for the poller and CLI.

- [ ] **Step 1: Write failing filesystem, corruption, and lock tests**

Use a unique `mkdtemp` root per test. Cover default path construction, `0700` directory, `0600` state/temp/lock files, missing-state behavior, atomic write, invalid JSON quarantine, unsupported-version quarantine, recovery marker persistence, two writers serializing without lost updates, a live-owner lock not being stolen, a dead-owner lock older than 30 seconds being reclaimed, and a two-second lock timeout leaving state unchanged.

`tests/helpers/temp-state.ts` exports `tempStatePaths(): Promise<StatePaths>` and `cleanupTempState(paths: StatePaths): Promise<void>`; it creates only beneath the test runner's temporary directory and never resolves the production application-support path.

```ts
test('quarantines corrupt state and persists unread-first recovery', async () => {
  const paths = await tempStatePaths();
  await Bun.write(paths.stateFile, '{not-json');
  const loaded = await loadState(paths);
  expect(loaded.source).toBe('recovered');
  expect(loaded.state.recoveryPending).toBe(true);
  expect((await Array.fromAsync(new Bun.Glob('state.json.corrupt-*').scan(paths.directory))).length).toBe(1);
});
```

- [ ] **Step 2: Run the store test to verify it fails**

Run: `bun test tests/state-store.test.ts`

Expected: FAIL because `src/state/store.ts` does not exist.

- [ ] **Step 3: Implement paths, private writes, owner-aware locking, and quarantine**

Use these contracts:

```ts
export type StatePaths = {
  directory: string;
  stateFile: string;
  lockFile: string;
};

export type StateLoad = {
  state: RaccoonState;
  source: 'existing' | 'missing' | 'recovered';
};

export class StateStoreError extends Error {
  constructor(readonly publicMessage: string) {
    super(publicMessage);
    this.name = 'StateStoreError';
  }
}

export function defaultStatePaths(options?: { testDirectory?: string }): StatePaths;
export async function loadState(paths: StatePaths): Promise<StateLoad>;
export async function mutateState(
  paths: StatePaths,
  mutation: (current: RaccoonState) => RaccoonState,
): Promise<RaccoonState>;
```

Acquire with exclusive create (`wx`), store `{ pid, createdAt, token }`, wait in short intervals for at most two seconds, and reclaim only when age exceeds 30 seconds and `process.kill(pid, 0)` fails specifically with `ESRCH`; `EPERM` still means the owner exists. Under lock, reload before mutation. Write a same-directory unique temp file, `chmod 0600`, `fsync`, rename, and `chmod 0600`; release only when the on-disk token still matches the current owner.

On parse/version failure, recheck under lock, rename the original with the exact pattern `state.json.corrupt-YYYYMMDDTHHMMSSmmmZ` (for example, `state.json.corrupt-20260829T001530000Z`), write `createInitialState({ recoveryPending: true })`, and return `source: 'recovered'`. Never print the corrupt body or delete it.

- [ ] **Step 4: Run store/model tests repeatedly to exercise races**

Run: `bun test tests/state-store.test.ts tests/state-model.test.ts --rerun-each 10 && bun run typecheck`

Expected: all repeated tests PASS with no leaked lock or temp files.

- [ ] **Step 5: Commit private state persistence**

```bash
git add src/state/store.ts tests/helpers/temp-state.ts tests/state-store.test.ts
git commit -m "feat: persist private raccoon state atomically"
```

### Task 6: Poll Coordinator and Failure Recovery

**Files:**
- Create: `src/poll.ts`
- Create: `tests/helpers/fake-clock.ts`
- Create: `tests/poll.test.ts`

**Interfaces:**
- Consumes: feed client, pure state transitions, state load/mutation, `Clock`, `Post`, and `RaccoonState`.
- Produces: `PollMode`, `PollDependencies`, `PollResult`, and `poll(mode, dependencies)` for the CLI, including a transient sanitized notice when local state cannot be updated.

`tests/helpers/fake-clock.ts` exports a `FakeClock implements Clock` with `constructor(nowIso: string)`, `now(): Date`, `set(nowIso: string): void`, and `advance(milliseconds: number): void`.

- [ ] **Step 1: Write failing scheduled/forced polling tests**

Cover due scheduled success, fetch outside the mutation lock, first-run baseline, empty success, failure preservation, exact backoff progression, 30-second duplicate suppression, future-`nextRetryAt` suppression, forced bypass of both guards, recovery after success, and a state-store error rendered from the last loadable cache.

```ts
import { expect, test } from 'bun:test';
import { poll } from '../src/poll';
import { stateWith } from './helpers/factories';

test('scheduled poll honors backoff while forced poll bypasses it', async () => {
  const harness = pollHarness({
    state: stateWith({ nextRetryAt: '2026-08-29T00:30:00.000Z' }),
    now: '2026-08-29T00:10:00.000Z',
  });
  expect((await poll('scheduled', harness.deps)).networkAttempted).toBe(false);
  expect((await poll('force', harness.deps)).networkAttempted).toBe(true);
  expect(harness.fetchCalls).toBe(1);
});

test('network work completes before the state mutation lock begins', async () => {
  const events: string[] = [];
  const harness = pollHarness({ events });
  await poll('scheduled', harness.deps);
  expect(events).toEqual(['load', 'fetch:start', 'fetch:end', 'mutate:start', 'mutate:end']);
});
```

Define `pollHarness(options)` locally with this exact test-facing shape:

```ts
type PollHarness = {
  deps: PollDependencies;
  readonly fetchCalls: number;
  events: string[];
};

function pollHarness(options?: {
  state?: RaccoonState;
  now?: string;
  events?: string[];
  fetchResult?: Post[] | FeedError;
}): PollHarness;
```

Its `mutateState` applies the callback to an in-memory current state, and its read-only counters are getters so assertions observe later calls.

- [ ] **Step 2: Run the poll test to verify it fails**

Run: `bun test tests/poll.test.ts`

Expected: FAIL because `src/poll.ts` does not exist.

- [ ] **Step 3: Implement one-attempt polling with injected dependencies**

```ts
export type PollMode = 'scheduled' | 'force';

export type PollDependencies = {
  clock: Clock;
  loadState(): Promise<StateLoad>;
  mutateState(mutation: (state: RaccoonState) => RaccoonState): Promise<RaccoonState>;
  fetchPosts(): Promise<Post[]>;
};

export type PollResult = {
  state: RaccoonState;
  networkAttempted: boolean;
  notice: RuntimeNotice;
};

export async function poll(mode: PollMode, dependencies: PollDependencies): Promise<PollResult>;
```

For scheduled mode, compare the injected clock first with `lastAttemptAt + 30 seconds`, then with `nextRetryAt`. Return cached state without mutation when either guard applies. Otherwise await `fetchPosts()` before calling `mutateState`. On success apply `applySuccessfulPoll`; on `FeedError` apply `applyFailedPoll`. Convert unknown network errors to the `network` category.

If the initial `loadState` fails, return `createInitialState({ recoveryPending: true })`, `networkAttempted: false`, and `notice: 'state'` without fetching. If mutation fails after a successful load/fetch, return the previously loaded cached state plus `notice: 'state'`; do not claim the attempt was persisted. Successful and backoff-skipped results use `notice: null`. Raw state-store messages never reach state or menu output.

- [ ] **Step 4: Run poll, feed, state, and type checks**

Run: `bun test tests/poll.test.ts tests/feed-client.test.ts tests/state-model.test.ts tests/state-store.test.ts && bun run typecheck`

Expected: all tests PASS and TypeScript exits `0`.

- [ ] **Step 5: Commit polling policy**

```bash
git add src/poll.ts tests/helpers/fake-clock.ts tests/poll.test.ts
git commit -m "feat: coordinate cached feed polling"
```

### Task 7: Safe SwiftBar Menu Renderer

**Files:**
- Create: `src/swiftbar/render.ts`
- Create: `tests/swiftbar-render.test.ts`

**Interfaces:**
- Consumes: `RaccoonState`, `IconState`, `Post`, `PROFILE_URL`, and `ICON_BASE64`.
- Produces: `escapeSwiftBarTitle`, `wrapPostText`, `selectMenuPosts`, `chooseIconState`, and `renderSwiftBarMenu(options)` for the CLI.

- [ ] **Step 1: Write failing renderer snapshots and injection tests**

Cover an image-only header with paired light/dark Base64, dropdown unread count, newest-first selection, every unread plus enough read for five, all-unread overflow, exact media fallback, unavailable-link fallback, multiline/full-text wrapping, pipe/control/separator neutralization, a malicious title that resembles SwiftBar parameters, action quoting for plugin paths with spaces/apostrophes, local timestamp formatting, stale/offline status, and `unread > offline > calm` precedence.

```ts
import { expect, test } from 'bun:test';
import { chooseIconState, renderSwiftBarMenu } from '../src/swiftbar/render';
import { post, stateWith } from './helpers/factories';

test('unread wins over sustained offline state', () => {
  expect(chooseIconState(stateWith({ unreadIds: ['2'], consecutiveFailures: 7 }))).toBe('unread');
  expect(chooseIconState(stateWith({ unreadIds: [], consecutiveFailures: 3 }))).toBe('offline');
});

test('feed text cannot inject SwiftBar parameters or separators', () => {
  const menu = renderSwiftBarMenu({
    state: stateWith({
      knownIds: ['2'],
      unreadIds: ['2'],
      cachedPosts: [post('2', { text: 'hello | bash=/tmp/evil\n---' })],
    }),
    pluginPath: '/tmp/Tibo Raccoon/tibo-raccoon.2m.js',
    locale: 'en-US',
    timeZone: 'UTC',
  });
  expect(menu).not.toContain('hello | bash=');
  expect(menu).not.toContain('\n---\n');
  expect(menu).toContain('hello ｜ bash=/tmp/evil');
});
```

- [ ] **Step 2: Run the renderer test to verify it fails**

Run: `bun test tests/swiftbar-render.test.ts`

Expected: FAIL because `src/swiftbar/render.ts` does not exist.

- [ ] **Step 3: Implement inert text rendering and exact actions**

Use these signatures:

```ts
export function escapeSwiftBarTitle(value: string): string;
export function wrapPostText(value: string, width?: number): string[];
export function selectMenuPosts(state: RaccoonState, minimum?: number): Post[];
export function chooseIconState(state: RaccoonState): IconState;
export function renderSwiftBarMenu(options: {
  state: RaccoonState;
  pluginPath: string;
  notice?: RuntimeNotice;
  locale?: string;
  timeZone?: string;
}): string;
```

Use private helpers with these signatures so every computed value in the output assembly is explicit:

```ts
function quoteSwiftBarParam(value: string): string;
function renderPostRows(post: Post, unread: boolean, locale: string, timeZone: string): string[];
function renderStatus(state: RaccoonState, notice: RuntimeNotice): string;
```

Inside `renderSwiftBarMenu`, set `icon = chooseIconState(state)`, `quotedPluginPath = quoteSwiftBarParam(pluginPath)`, and `renderedPostRows = selectMenuPosts(state).flatMap(...)` before constructing `lines`.

Normalize CRLF, replace tabs with spaces, remove other C0/C1 controls, visibly replace `|` with `｜`, replace a visual row equal to `---` with `— — —`, and split at 72 Unicode code points without dropping any remaining text. Render text/status rows without action parameters. Quote the hard-coded absolute plugin path for SwiftBar and escape backslash and apostrophe; never pass feed text to parameter formatting.

Build the output from computed values in this exact order:

```ts
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
```

If text is empty, emit **New media post from Tibo**. If URL is null, emit **Original link unavailable** without `href`. If `notice === 'state'`, the final status row is **Local state unavailable · cached status may be incomplete**. Do not mark posts read in this module.

- [ ] **Step 4: Run renderer/artwork/model tests and type checking**

Run: `bun test tests/swiftbar-render.test.ts tests/artwork.test.ts tests/state-model.test.ts && bun run typecheck`

Expected: all tests PASS and TypeScript exits `0`.

- [ ] **Step 5: Commit the SwiftBar renderer**

```bash
git add src/swiftbar/render.ts tests/swiftbar-render.test.ts
git commit -m "feat: render safe Tibo SwiftBar menu"
```

### Task 8: CLI Actions and Production Wiring

**Files:**
- Create: `src/cli.ts`
- Create: `src/main.ts`
- Create: `tests/cli.test.ts`

**Interfaces:**
- Consumes: poll coordinator, state store, renderer, feed client, and exact action names from earlier tasks.
- Produces: `CliDependencies`, `CliResult`, `runCli(argv, dependencies)`, and the executable production entry point.

- [ ] **Step 1: Write failing command-contract tests**

Cover no-argument scheduled poll plus complete menu output, `mark-read` mutation with no fetch/stdout, concurrent later merge remaining unread, `refresh-now` forced poll with no stdout, handled feed failure exiting `0`, lock/mutation failure exiting nonzero, unknown/multiple arguments exiting `64`, sanitized stderr, and test-only state-root gating.

```ts
import { expect, test } from 'bun:test';
import { runCli } from '../src/cli';

test('mark-read mutates state without rendering or fetching', async () => {
  const harness = cliHarness({ unreadIds: ['2'] });
  const result = await runCli(['mark-read'], harness.deps);
  expect(result).toEqual({ stdout: '', stderr: '', exitCode: 0 });
  expect(harness.fetchCalls).toBe(0);
  expect(harness.savedState.unreadIds).toEqual([]);
});

test('unknown action is inert and returns usage exit code', async () => {
  const harness = cliHarness({ unreadIds: ['2'] });
  const result = await runCli(['delete-state'], harness.deps);
  expect(result.exitCode).toBe(64);
  expect(harness.mutationCalls).toBe(0);
  expect(harness.fetchCalls).toBe(0);
});
```

Define `cliHarness(options)` in `tests/cli.test.ts` with this exact shape:

```ts
type CliHarness = {
  deps: CliDependencies;
  readonly fetchCalls: number;
  readonly mutationCalls: number;
  readonly savedState: RaccoonState;
};

function cliHarness(options?: Partial<RaccoonState>): CliHarness;
```

Initialize its state with `stateWith(options)` from `tests/helpers/factories.ts`; implement counters and `savedState` as getters over the mutable test closure.

- [ ] **Step 2: Run the CLI test to verify it fails**

Run: `bun test tests/cli.test.ts`

Expected: FAIL because `src/cli.ts` and `src/main.ts` do not exist.

- [ ] **Step 3: Implement the pure dispatcher and exact exit/output rules**

```ts
export type CliDependencies = {
  poll(mode: PollMode): Promise<PollResult>;
  mutateState(mutation: (state: RaccoonState) => RaccoonState): Promise<RaccoonState>;
  render(state: RaccoonState, notice: RuntimeNotice): string;
};

export type CliResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export async function runCli(argv: readonly string[], dependencies: CliDependencies): Promise<CliResult>;
```

No arguments call `poll('scheduled')`, pass its state/notice to `render`, and always return a non-empty cached/error menu with exit `0`. `mark-read` uses `mutateState(markAllRead)` and returns empty stdout. `refresh-now` calls `poll('force')` and returns empty stdout; a handled feed failure still exits `0`, while `notice: 'state'` exits `1` because the result could not be persisted. Unexpected state/action errors use fixed stderr phrases with no paths or stack and return `1`; invalid arity/action returns `64` without side effects.

- [ ] **Step 4: Wire production dependencies and guarded test paths in `main.ts`**

Resolve the plugin path from `SWIFTBAR_PLUGIN_PATH` only when it is absolute; otherwise use the absolute executable path. Use `defaultStatePaths()` in production. Honor `TIBO_RACCOON_TEST_STATE_DIR` only when `TIBO_RACCOON_TEST_MODE === '1'`, the override is absolute, and the directory already exists. Instantiate the real clock, feed client, state store, poller, and renderer; write exactly one result to stdout/stderr and set `process.exitCode`. Guard the entry call with `if (import.meta.main)` so tests can import wiring helpers without executing the plugin.

- [ ] **Step 5: Run CLI, poll, renderer, and type checks**

Run: `bun test tests/cli.test.ts tests/poll.test.ts tests/swiftbar-render.test.ts && bun run typecheck`

Expected: all tests PASS and TypeScript exits `0`.

- [ ] **Step 6: Commit the executable command flow**

```bash
git add src/cli.ts src/main.ts tests/cli.test.ts
git commit -m "feat: add SwiftBar command actions"
```

### Task 9: Single-File Release Build and Artifact Smoke Test

**Files:**
- Create: `scripts/build.ts`
- Create: `tests/build-artifact.test.ts`
- Modify: `.gitignore`
- Create during build: `dist/tibo-raccoon.2m.js`

**Interfaces:**
- Consumes: `src/main.ts`, generated icon constants, the resolved absolute Bun executable, and SwiftBar metadata rules.
- Produces: one executable `dist/tibo-raccoon.2m.js` and `buildPlugin(options)` for installer tests.

- [ ] **Step 1: Write a failing build-artifact test**

The test builds into a temporary directory, then asserts filename, mode `0755`, absolute Bun shebang, metadata, `runInBash=false`, all six embedded hashes/Base64 payloads, no source map, no runtime `assets/icons` path, and no runtime package import. It then prepares a recent valid state under a test-only state directory so execution skips the network and returns non-empty SwiftBar output.

```ts
import { expect, test } from 'bun:test';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPlugin } from '../scripts/build';

test('builds one directly executable SwiftBar artifact', async () => {
  const tempDirectory = await mkdtemp(join(tmpdir(), 'tibo-raccoon-build-'));
  const output = join(tempDirectory, 'tibo-raccoon.2m.js');
  await buildPlugin({ output, bunPath: process.execPath });
  const source = await Bun.file(output).text();
  expect(source.startsWith(`#!${process.execPath}\n`)).toBe(true);
  expect(source).toContain('<swiftbar.runInBash>false</swiftbar.runInBash>');
  expect((await stat(output)).mode & 0o777).toBe(0o755);
});
```

For the smoke execution, set `TIBO_RACCOON_TEST_MODE=1`, point `TIBO_RACCOON_TEST_STATE_DIR` to the temporary state directory, execute the artifact directly, and assert exit `0`, an image-only first line, a `---` separator, and `Tibo Raccoon · 0 unread`. Do not contact Dayclaw and do not use the real application-support directory.

- [ ] **Step 2: Run the build test to verify it fails**

Run: `bun test tests/build-artifact.test.ts`

Expected: FAIL because `scripts/build.ts` does not exist.

- [ ] **Step 3: Implement a deterministic, inspectable build**

```ts
export type BuildOptions = {
  output: string;
  bunPath: string;
};

export async function buildPlugin(options: BuildOptions): Promise<void>;
```

Require an absolute, executable `bunPath` with no whitespace or newline because a shebang cannot safely encode such an interpreter path. Run `Bun.build` with `entrypoints: ['src/main.ts']`, `target: 'bun'`, `format: 'esm'`, `minify: true`, and no sourcemap. Fail on any build log error. Construct and prepend this exact metadata block, substituting only the validated absolute `bunPath` in the shebang:

```ts
const metadata = [
  `#!${bunPath}`,
  '// <xbar.title>Tibo Raccoon</xbar.title>',
  '// <xbar.version>v0.1.0</xbar.version>',
  '// <xbar.author>Hojin</xbar.author>',
  "// <xbar.desc>Watch Tibo's public posts from the macOS menu bar.</xbar.desc>",
  '// <xbar.dependencies>bun,swiftbar</xbar.dependencies>',
  '// <swiftbar.runInBash>false</swiftbar.runInBash>',
  '',
].join('\n');
```

Write through a same-directory temp artifact, set `0755`, and rename. Re-open the result and fail if metadata, shebang, generated icon hashes, or `tibo-raccoon.2m.js` filename are wrong. Add `dist/` to `.gitignore` if it is not already present.

Export `buildPlugin` without side effects. Under `if (import.meta.main)`, default to `process.execPath` and `dist/tibo-raccoon.2m.js`, then surface a sanitized nonzero build failure.

- [ ] **Step 4: Run the artifact smoke test twice**

Run: `bun test tests/build-artifact.test.ts --rerun-each 2 && bun run typecheck`

Expected: both builds and direct executions PASS; TypeScript exits `0`; no file appears under the real state directory.

- [ ] **Step 5: Commit the build pipeline**

```bash
git add .gitignore scripts/build.ts tests/build-artifact.test.ts
git commit -m "build: bundle single SwiftBar plugin"
```

### Task 10: Explicit Install, Uninstall, Live Check, and User Documentation

**Files:**
- Create: `scripts/install.ts`
- Create: `scripts/uninstall.ts`
- Create: `scripts/live-check.ts`
- Create: `tests/install-tools.test.ts`
- Create: `tests/live-check.test.ts`
- Create: `README.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: `buildPlugin`, `fetchDayclawPosts`, and the fixed artifact/state names.
- Produces: testable `installPlugin`, `uninstallPlugin`, and `runLiveCheck` functions plus explicit human-facing commands. No function runs merely by being imported.

- [ ] **Step 1: Write failing installer and live-check tests using temporary targets**

Cover missing SwiftBar/Bun diagnostics, non-macOS rejection, relative/non-directory plugin-path rejection, paths with spaces, atomic replacement, mode `0755`, preservation of a preexisting application-support state fixture, reinstall replacement without state mutation, uninstall removing only the exact artifact, uninstall retaining state, and live check validating posts without reading/writing state.

```ts
test('install copies only the built artifact and preserves state', async () => {
  const harness = await installHarness();
  const before = await Bun.file(harness.stateFile).text();
  const result = await installPlugin({
    pluginDirectory: harness.pluginDirectory,
    bunPath: harness.bunPath,
    dependencies: harness.dependencies,
  });
  expect(result.installedPath).toBe(join(harness.pluginDirectory, 'tibo-raccoon.2m.js'));
  expect(await Bun.file(harness.stateFile).text()).toBe(before);
});
```

Define `installHarness()` locally as:

```ts
type InstallHarness = {
  pluginDirectory: string;
  stateFile: string;
  bunPath: string;
  dependencies: InstallDependencies;
};

function installHarness(): Promise<InstallHarness>;
```

The harness creates its plugin/state trees under one temporary root, supplies a fake positive SwiftBar lookup, and records every filesystem/process request so tests can assert no path outside that root changed. Await it in the example and all installer tests.

- [ ] **Step 2: Run tool tests to verify they fail**

Run: `bun test tests/install-tools.test.ts tests/live-check.test.ts`

Expected: FAIL because the tool modules do not exist.

- [ ] **Step 3: Implement prerequisite checks and exact-target install/uninstall**

Use dependency injection for filesystem/process/app-location checks in tests. In production, require `process.platform === 'darwin'`, require an executable absolute Bun path, locate SwiftBar through Spotlight bundle identifier `com.ameba.SwiftBar`, and require an explicit absolute plugin-directory argument or an interactive TTY response.

```ts
export type InstallDependencies = {
  platform: string;
  locateSwiftBar(): Promise<boolean>;
  isExecutable(path: string): Promise<boolean>;
  build: typeof buildPlugin;
  stat(path: string): Promise<{ isDirectory(): boolean }>;
  makeTempDirectory(): Promise<string>;
  copyFile(source: string, destination: string): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
  rename(source: string, destination: string): Promise<void>;
  removeTempDirectory(path: string): Promise<void>;
};

export type UninstallDependencies = {
  lstat(path: string): Promise<{ isFile(): boolean; isSymbolicLink(): boolean }>;
  unlink(path: string): Promise<void>;
};

export async function installPlugin(options: {
  pluginDirectory: string;
  bunPath: string;
  dependencies?: InstallDependencies;
}): Promise<{ installedPath: string }>;

export async function uninstallPlugin(options: {
  pluginPath: string;
  confirmed: boolean;
  dependencies?: UninstallDependencies;
}): Promise<{ removedPath: string; retainedStatePath: string }>;
```

Install calls `buildPlugin` into a temporary directory, computes `join(pluginDirectory, 'tibo-raccoon.2m.js')`, copies to a same-directory temporary target, applies `0755`, and renames only to that computed path. It prints the exact path and SwiftBar refresh instruction. It never invokes a package manager or launches SwiftBar.

Uninstall rejects any basename other than `tibo-raccoon.2m.js`, requires confirmation, removes only that exact file, and reports that `~/Library/Application Support/Tibo Raccoon/` remains. It never deletes state. Both tool modules export functions without side effects and put argument parsing/execution behind `if (import.meta.main)`.

- [ ] **Step 4: Implement the opt-in read-only live checker**

```ts
export async function runLiveCheck(options: {
  fetchPosts?: typeof fetchDayclawPosts;
} = {}): Promise<{ count: number; newestId: string | null }>;
```

Call the real fixed feed client once, print only count/newest ID/schema success, and never instantiate `StatePaths` or write a file. Put the real call behind `if (import.meta.main)` so unit tests inject a fake. Add `live-check` to package scripts, but do not call it from `check`, build, install, or tests.

- [ ] **Step 5: Write concise setup, privacy, behavior, and cleanup documentation**

`README.md` must include:

- prerequisites: macOS, SwiftBar, Bun, and contributor-only `bun install`;
- `bun run check`, `bun run build`, and the opt-in `bun run live-check` command;
- exact installer command with `--plugin-dir` and a statement that it installs no dependencies;
- calm/unread/offline visual meanings and **Mark all as read** semantics;
- text/media-only behavior and Dayclaw pagination/media limitations;
- fixed network hosts and private state location/modes;
- exact uninstall command and a separate optional full reset that moves the state directory to Trash rather than permanently deleting it;
- explicit warning that no live SwiftBar copy occurs during normal repository tests.

- [ ] **Step 6: Run tool tests, all focused checks, and documentation command examples in dry-run/temp mode**

Run: `bun test tests/install-tools.test.ts tests/live-check.test.ts tests/build-artifact.test.ts && bun run typecheck`

Expected: all tests PASS, no network request occurs, no live SwiftBar directory changes, and TypeScript exits `0`.

- [ ] **Step 7: Commit install tooling and documentation**

```bash
git add package.json scripts/install.ts scripts/uninstall.ts scripts/live-check.ts tests/install-tools.test.ts tests/live-check.test.ts README.md
git commit -m "docs: add explicit SwiftBar install workflow"
```

### Task 11: End-to-End Acceptance and Repository-Only Verification

**Files:**
- Create: `tests/acceptance.test.ts`

**Interfaces:**
- Consumes: every public interface and fixture established in Tasks 1–10.
- Produces: executable evidence for the complete approved acceptance criteria; no new production API.

- [ ] **Step 1: Write an end-to-end acceptance test around temporary state and an injected feed**

Drive the real state model/store, poller, renderer, and CLI together while injecting only the clock and feed. Assert this sequence:

1. first response with five historical posts yields calm and `0 unread`;
2. a sixth text post yields the flame-eyed unread image, exact unread icon hash, exact safe text, and `1 unread`;
3. normal refresh preserves unread;
4. `mark-read` returns empty stdout and the next render is calm;
5. an empty-text seventh post yields **New media post from Tibo** and its validated link;
6. three failures preserve cached content and choose offline only when unread is empty;
7. an unread cached post during the same failures keeps unread visual precedence;
8. recovery success restores the correct state;
9. concurrent mark/fetch ordering leaves genuinely later IDs unread;
10. no action touches a path outside the temporary state root.

```ts
test('baseline to unread to read to offline preserves the approved contract', async () => {
  const app = await acceptanceHarness({ baseline: ['1', '2', '3', '4', '5'].map((id) => post(id)) });
  expect(await app.render()).toContain('Tibo Raccoon · 0 unread');
  app.feed.push(post('6', { text: 'a nuanced message' }));
  expect(await app.render()).toContain('Tibo Raccoon · 1 unread');
  expect((await app.action('mark-read')).stdout).toBe('');
  expect(await app.render()).toContain('Tibo Raccoon · 0 unread');
});
```

Import `post` from `tests/helpers/factories.ts`. Define the integration harness in `tests/acceptance.test.ts` with real production modules and this test-facing contract:

```ts
type AcceptanceHarness = {
  feed: Post[];
  render(): Promise<string>;
  action(name: 'mark-read' | 'refresh-now'): Promise<CliResult>;
  failNext(kind: FeedErrorKind): void;
  advance(milliseconds: number): void;
  statePaths: StatePaths;
};

function acceptanceHarness(options: { baseline: Post[] }): Promise<AcceptanceHarness>;
```

Only `fetchPosts` and `Clock` are fake. `render` invokes the real CLI no-argument path; `action` invokes the real CLI action path; state model/store, poll, renderer, icons, and locking are production implementations.

- [ ] **Step 2: Run the acceptance test against the real integration**

Run: `bun test tests/acceptance.test.ts`

Expected: PASS if Tasks 1–10 are integrated correctly. If it fails, preserve the failing output and use systematic debugging before changing production code; do not replace the test with mocks of the behavior under test.

- [ ] **Step 3: Gate further work on the acceptance result**

If Step 2 passes, make no production change and continue. If it fails, stop this plan, preserve the exact failure, invoke `superpowers:systematic-debugging`, and amend this task with the exact responsible source/test paths before editing. Keep all feed calls injected, all state paths temporary, and all production contracts unchanged; do not add classification, notifications, media downloads, a daemon, or a live install shortcut.

- [ ] **Step 4: Run the full repository verification command**

Run: `bun run check`

Expected: TypeScript exits `0`, every Bun test passes with zero failures, icon regeneration/build checks pass, and `dist/tibo-raccoon.2m.js` is produced as one executable file.

- [ ] **Step 5: Verify generated assets are reproducible and the worktree contains no unexpected files**

Run: `bun run generate:icons && git diff --exit-code -- assets/icons src/generated/icons.ts && git status --short`

Expected: icon diff exits `0`; status contains only the intended acceptance-test/source changes before commit; `.superpowers/`, `node_modules/`, `coverage/`, and `dist/` remain ignored.

- [ ] **Step 6: Commit acceptance coverage**

If no production defect was exposed, commit the acceptance test alone:

```bash
git add tests/acceptance.test.ts
git commit -m "test: verify Tibo Raccoon acceptance flow"
```

If Step 3 required a plan amendment, commit the demonstrated source correction and its focused regression test separately before returning to the acceptance-only commit above.

- [ ] **Step 7: Record the repository-only boundary in the handoff**

Report the passing test/build counts, artifact path and hash, commit range, Bun/SwiftBar prerequisite status, and that the real Dayclaw live check and live SwiftBar installation were not run. Offer each of those as a separate approval-gated next action.

## Execution Notes

- Read the approved spec before Task 1 and re-read the relevant task's interfaces before editing.
- Use a dedicated Git worktree at execution time if the current workspace is not already isolated.
- Follow red-green-refactor for every production behavior: observe the focused failure, implement only enough to pass, rerun focused tests, then commit.
- Do not run `scripts/live-check.ts`, copy to a real SwiftBar directory, or remove a real plugin/state path without a separate explicit approval.
- Bun is a prerequisite for every executable step. If `bun` is unavailable, stop before Task 1 and request that prerequisite rather than installing it automatically.
