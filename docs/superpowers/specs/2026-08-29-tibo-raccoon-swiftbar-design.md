# Tibo Raccoon SwiftBar Plugin — Design

Date: 2026-08-29

Status: Approved by the user on 2026-08-29; unread flame-eye amendment approved on 2026-08-29

## Summary

Tibo Raccoon is a small SwiftBar plugin that watches the public Dayclaw feed for Tibo's X account (`@thsottiaux`). It shows a chubby pixel raccoon in the macOS menu bar, keeps every newly observed post unread until the user explicitly marks posts as read, and displays the original post text and link in the dropdown.

The plugin does not attempt to decide which posts hint at a Codex reset. Tibo's hints are too nuanced for a reliable filter, and a false negative would defeat the purpose of the tool. Every newly returned post is therefore treated as relevant.

## Goals

- Check Tibo's public feed every two minutes without requiring an X account.
- Make new posts visible through a discreet but unmistakable raccoon state.
- Preserve the unread state until the user selects **Mark all as read**.
- Show exact post text, publication time, and a safe link to the original post.
- Handle text-only, mixed-media, and media-only posts without pretending media metadata is available when it is not.
- Continue showing useful cached information during network or feed failures.
- Install as a conventional SwiftBar plugin with Bun as its only runtime dependency.
- Keep network access and local state narrow, understandable, and private.

## Non-goals

- Classifying, summarizing, or filtering posts for Codex-reset relevance.
- Logging in to X, using X credentials, or scraping an authenticated X session.
- Downloading, rendering, or analyzing post media in the SwiftBar menu.
- Native macOS notifications, sounds, a dock app, a daemon, or a Codex automation.
- Tracking replies, likes, reposts, edits, or deletions beyond what the feed returns as items.
- A self-updater, analytics, telemetry, or automatic dependency installation.
- Guaranteed reconstruction of posts that never appear in a successful Dayclaw response.

## External source and reference boundary

The only remote data source in version 1 is:

`https://api.dayclaw.com/api/source/public/x/thsottiaux/items`

The existing `codex-reset-watchdog` project establishes that this public endpoint can expose Tibo's posts, but Tibo Raccoon will be an independent implementation. It is a behavioral reference only; no source code will be copied from it.

`claude-codex-battery` is a visual and packaging reference. Its MIT-licensed SwiftBar approach informed the choice of a Bun-powered, two-minute plugin with embedded imagery, but Tibo Raccoon's state, feed, menu, and raccoon artwork will be original.

SwiftBar's documented standard-plugin protocol is the integration contract: an executable named with a refresh suffix emits a header, separator, and dropdown lines to standard output. Version 1 will use a standard finite plugin, not a streamable background process.

## User experience

### Menu-bar states

The menu bar contains only the raccoon image: no text, count, envelope, or badge.

1. **Calm** — a chubby, round-cheeked pixel raccoon with relaxed, slightly half-open eyes. This means there are no unread posts and the feed is not in a sustained failure state.
2. **Unread** — the same raccoon with compact fire-lit eyes: a charcoal pixel outline, ember-red/orange body, and warm yellow core rise slightly above each eye mask. Four fine, muted oxide-red corner marks still frame the raccoon. The flames provide the playful urgency; the restrained frame keeps the state legible without becoming a conventional notification badge.
3. **Offline** — the calm raccoon with fully closed eyes. This appears after three consecutive failed feed attempts when there are no unread cached posts.

State precedence is `unread > offline > calm`. If cached unread posts exist during an outage, the unread raccoon remains visible so the more important state is never hidden.

The release artifact embeds light- and dark-appearance PNGs as Base64 and passes both through SwiftBar's `image=light_image,dark_image` parameter. The build reads canonical checked-in PNGs generated from the approved pixel grid; the installed plugin does not generate or download artwork at runtime.

#### Approved pixel-art source of truth

The temporary browser mockups are not repository assets. To preserve the approved design, the build-time artwork uses a 39×29 grid and these exact palette values:

| Role | Light | Dark |
| --- | --- | --- |
| Fur | `#8a9299` | `#aab1b7` |
| Mask/ears | `#34393e` | `#2b3035` |
| Face highlight | `#d8dbde` | `#d7dadc` |
| Eyes/nose | `#17191b` | `#151719` |
| Flame outer | `#d64b2a` | `#ff6b47` |
| Flame core | `#ffc247` | `#ffd166` |
| Unread frame | `#9a4d49` | `#cc7a74` |

The shared chubby silhouette, round cheeks, mask, and nose use this SVG-grid geometry; the asset builder rasterizes it without smoothing:

```text
ears:       M5 4h7v5H5z M27 4h7v5h-7z
silhouette: M9 5h21v2h4v3h2v10h-2v3h-4v3h-6v2h-9v-2H9v-3H5v-3H3V10h2V7h4z
mask:       M7 10h9v8H7z M23 10h9v8h-9z
nose:       M17 18h5v3h-5z
```

The state-specific eyes and frame are:

```text
calm face:    M10 13h3v2h-3z M26 13h3v2h-3z
calm eyes:    M11 14h2v1h-2z M26 14h2v1h-2z
offline face: M10 13h3v2h-3z M26 13h3v2h-3z
offline eyes: M10 14h3v1h-3z M26 14h3v1h-3z
oxide frame:  M1 5h5v1H2v4H1z M33 5h5v5h-1V6h-4z M1 22h1v4h4v1H1z M37 22h1v5h-5v-1h4z
```

The unread left flame is defined by these inclusive row spans; the right flame mirrors each span horizontally with `mirroredX = 38 - x`:

```text
outline: y7:12-12, y8:11-13, y9:10-13, y10:10-14, y11:9-14,
         y12:9-14, y13:9-13, y14:10-13, y15:10-12
outer:   y8:12-12, y9:11-12, y10:11-13, y11:10-13,
         y12:10-13, y13:10-12, y14:11-12
core:    y10:12-12, y11:11-12, y12:11-12, y13:11-11
```

The outline uses the eyes/nose color, followed by flame outer and flame core. Calm keeps the shorter, lower pupils approved in the visual review. Offline keeps the same face and cheeks but turns each eye into a horizontal closed line. No envelope, circular dot, numeric badge, filled red field, or animation is part of any state.

Each canonical image is exactly 39×29 physical pixels with a transparent background. Rectangles are filled on integer coordinates in this order: ears, silhouette, masks, state-specific face/eye or flame outline, flame outer, flame core, eyes/nose, then unread frame. No antialiasing, resampling, color profiles, or semitransparent pixels are allowed. The PNG encoding is deterministic: 8-bit RGBA, non-interlaced, filter type 0 on every row, one `IDAT` chunk using stored (uncompressed) DEFLATE blocks, and only `IHDR`, `IDAT`, and `IEND` chunks. The six canonical PNGs are checked in, and both the asset generator and bundled Base64 must reproduce their SHA-256 hashes byte for byte.

### Dropdown

The dropdown begins with:

`Tibo Raccoon · N unread`

Posts are ordered newest first. It renders every unread post, followed by enough recent read posts to show at least five posts total. If there are more than five unread posts, all unread posts remain visible.

Each post includes:

- a local-time timestamp and unread/read status;
- the source text without summarization, wrapped into safe, readable menu rows;
- **Open original post** when the source URL passes validation.

The plugin does not summarize or semantically rewrite Tibo's text. SwiftBar-reserved control characters are visibly substituted as described under output safety. For an empty-text post, it displays **New media post from Tibo** and the original link when valid; otherwise it displays **Original link unavailable**. If Dayclaw later exposes trustworthy media metadata, that can be considered separately; version 1 does not infer media type from missing text.

After the post list, the dropdown provides:

- **Mark all as read** — marks every unread ID currently persisted under the state lock, then refreshes the plugin;
- **Refresh now** — attempts a network refresh immediately, even during backoff;
- **Open Tibo's profile** — opens `https://x.com/thsottiaux`;
- a compact last-success or stale/offline status line.

Selecting or opening an individual post does not mark it as read. Only **Mark all as read** changes read state.

### First run

The first successful fetch establishes a baseline. All items in that response are recorded as known and read, so installation does not create a historical unread flood. The latest five baseline posts still appear in the dropdown as recent read posts.

Every previously unknown ID observed after initialization becomes unread, regardless of its text or media status.

## Architecture

The repository will contain small TypeScript modules with single responsibilities, Bun tests, canonical artwork assets, an asset generator, and a release bundler. The installed result is one executable `tibo-raccoon.2m.js` file with the required runtime path, metadata, and images embedded.

The logical components are:

1. **Feed client** — fetches the fixed Dayclaw URL with a short timeout and parses only recognized response shapes.
2. **Normalizer** — converts source items into a narrow internal post model and validates stable IDs, timestamps, text, and links.
3. **State store** — loads, locks, validates, merges, and atomically writes private JSON state.
4. **Poll coordinator** — applies baseline, deduplication, backoff, cache, and manual-refresh rules.
5. **Menu renderer** — chooses the raccoon state and emits escaped SwiftBar output.
6. **Action dispatcher** — handles `mark-read` and `refresh-now` invocations through the same installed artifact.
7. **Asset builder** — generates canonical PNGs from the approved pixel grids and verifies that the release artifact embeds those exact bytes.
8. **Installer** — checks prerequisites, builds the release artifact, and copies it only to a user-selected SwiftBar plugin directory.

No component depends on Codex, OpenAI credentials, an X session, or a resident helper process.

## Data contract

### Recognized response shapes

The feed client accepts an item array at exactly one of these paths:

- `items`
- `data.items`
- `result.items`
- the response root, when the root itself is an array

Unknown top-level properties are ignored. A response with no recognized item array, more than 500 items, or more than 2 MiB of response data is a failed attempt and must not replace cached data.

The current endpoint appears to return one current page and does not publish a pagination or completeness contract. The plugin processes every item in each successful response but does not fabricate pagination parameters.

### Normalized post

Each source item becomes:

```ts
type Post = {
  id: string;
  text: string;
  publishedAt: string | null;
  url: string | null;
};
```

Normalization rules are explicit:

- ID is the first non-empty string from `external_id`, `id`, then `source_id`.
- Text is the first non-empty string from `content`, `text`, then `title`. If the recognized text fields are present but empty, the normalized text is an empty string, which is valid for media-only or otherwise textless posts. Text longer than 32,768 Unicode code points makes the response malformed.
- Timestamp is the first strictly valid RFC 3339 string from `published_at`, `publishedAt`, `created_at`, then `createdAt`. It must contain a timezone (`Z` or numeric offset), is normalized to UTC for storage and ordering, and is converted to local time only for display. Impossible dates, ambiguous timezone-free strings, and absent timestamps become `null` and render as **Time unavailable**.
- URL is read only from the source item's `url` field. It is accepted only when it is HTTPS, contains no username or password, uses no non-default port, and its normalized hostname is `x.com`, `www.x.com`, `twitter.com`, or `www.twitter.com`. Otherwise it becomes `null`, and the post renders **Original link unavailable** rather than a clickable action.
- Source author fields are not trusted for routing; the fixed feed URL defines the watched account.

An item without a stable ID cannot be tracked safely. If any item in an otherwise recognized response lacks a stable ID or is not an object, the entire response is rejected as malformed. This avoids silently treating an incomplete payload as a successful poll. For duplicate IDs in one response, the first occurrence in the source array wins.

Posts with the same publication time are ordered by ID in descending lexical order as a stable tie-breaker. Posts without valid timestamps follow timestamped posts and use the same descending ID order.

## Local state

State lives at:

`~/Library/Application Support/Tibo Raccoon/state.json`

The directory is created with mode `0700` and the state file with mode `0600`. The versioned JSON state contains:

```ts
type RaccoonState = {
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
```

`recoveryPending` distinguishes a genuinely new installation from state-loss recovery. It is `false` for a missing-state first run, becomes `true` when corrupt or unsupported state is quarantined, and returns to `false` only after a successful unread-first recovery fetch.

`knownIds` is retained so a previously seen post does not become unread again. At Tibo's expected posting volume, retaining IDs is simpler and safer than pruning them. `cachedPosts` retains every unread post plus the 100 newest read posts. Unread posts are never pruned. When an unread post is marked read, normal read-history pruning may remove its cached content later, but its ID remains known.

State mutations use an exclusive lock file. A contender waits for up to two seconds before falling back to read-only cached rendering. A lock may be reclaimed only when it is older than 30 seconds and its recorded owner process no longer exists. The network request happens outside the lock. Each mutation then reloads the latest state, applies a short merge under the lock, writes a same-directory temporary file, sets private permissions, and atomically renames it over `state.json`.

**Mark all as read** clears the unread IDs present in the state while holding the lock. A fetch that merges genuinely new IDs after that action releases the lock leaves those later IDs unread.

If state is missing, initialization begins normally. If it is unreadable, invalid, or has an unsupported version, the plugin preserves the bad file by renaming it with a timestamped `.corrupt` suffix and enters recovery mode. On the next successful fetch, every returned item is marked unread rather than establishing an all-read baseline. This favors a possible duplicate alert over hiding a real post. The menu reports the recovery, and the plugin never deletes the only copy silently.

## Polling, caching, and failure behavior

SwiftBar schedules the plugin by the `.2m.js` filename. On each scheduled execution:

1. Load the latest state.
2. If the last network attempt was less than 30 seconds ago, skip a duplicate network request and render cached state.
3. If `nextRetryAt` is in the future, skip the network request and render cached state.
4. Otherwise fetch the fixed Dayclaw endpoint with an 8-second timeout, a 2 MiB response limit, and redirects disabled.
5. Validate and normalize the complete response.
6. Under the state lock, merge every returned post by ID and atomically save.
7. Render from the newly loaded committed state.

On success, the failure count and backoff are cleared. On failure, cached posts and unread IDs are preserved, the attempt is recorded, and the next scheduled network attempt follows this sequence:

`2 minutes → 4 minutes → 8 minutes → 16 minutes → 30 minutes maximum`

The first failed attempt waits two minutes, matching the normal SwiftBar cadence. The direct `refresh-now` action bypasses both `nextRetryAt` and the 30-second duplicate-attempt guard, but still records success or failure normally. It does not start a retry loop. SwiftBar's post-action render then observes the just-recorded attempt and does not perform a duplicate request.

A recognized empty item array is a successful response. On a clean first run, it establishes an empty baseline; during recovery, it clears `recoveryPending`. Any ID that appears in a later successful response is therefore unread. This may produce a noisy alert after a transient empty response, but it cannot silently classify a later post as historical.

After one or two failures, the current calm or unread image remains and the dropdown shows a stale status. After three failures, the closed-eye offline image appears unless unread has precedence. A later successful poll automatically restores the appropriate unread or calm state.

Errors are sanitized for display and state storage: they identify the broad category, such as timeout, HTTP status, malformed payload, or local state failure, without dumping response bodies, stack traces, local paths, or secrets into the menu.

## SwiftBar output safety

All content derived from the feed is data, never SwiftBar markup. The renderer:

- replaces control characters and normalizes newlines before wrapping text;
- visibly substitutes `|` and neutralizes lines equal to `---`, control characters, and other characters that could become SwiftBar parameters or separators;
- applies a fixed maximum width per visual row without truncating the overall post text;
- emits actions only from hard-coded absolute executable paths and validated HTTPS URLs;
- never interpolates post text into `bash`, `params`, `href`, or metadata fields.

The bundled plugin begins with a shebang containing the install-time absolute Bun path and includes `<swiftbar.runInBash>false</swiftbar.runInBash>`, so SwiftBar executes the JavaScript artifact directly. This avoids dependence on SwiftBar's limited GUI `PATH` and makes the same artifact usable as an action executable.

Action lines use SwiftBar's `bash` parameter with the escaped absolute installed artifact path, one fixed `param1`, `terminal=false`, and `refresh=true`. SwiftBar waits for the background action to complete and then performs the requested menu refresh. The command contract is:

| Invocation | Mutation/network behavior | Standard output | Exit behavior |
| --- | --- | --- | --- |
| no arguments | Apply scheduled poll/backoff rules, then render the complete menu | Complete SwiftBar menu | `0` when a non-empty menu was rendered |
| `mark-read` | Clear currently persisted unread IDs under the lock; do not fetch | Empty | `0` on success; nonzero with sanitized stderr if no mutation occurred |
| `refresh-now` | Perform one forced poll, merge or record failure, then stop | Empty | `0` after a handled success or feed failure so the cached menu can refresh |
| any other argument | Make no state or network change | Empty | `64` with a sanitized usage error on stderr |

The exact menu actions are:

```text
Mark all as read | bash=<absolute-artifact> param1=mark-read terminal=false refresh=true
Refresh now | bash=<absolute-artifact> param1=refresh-now terminal=false refresh=true
Open Tibo's profile | href=https://x.com/thsottiaux
```

Post links use `href=<validated-original-url>` and no refresh flag. Text and status rows have no action parameters. The argument parser accepts exactly zero or one argument and never interprets feed text as a command.

Only expected operational output is written to standard output. Diagnostic details go to standard error, where SwiftBar can capture them, and never replace a valid cached menu with an empty result.

## Network and privacy boundary

- Feed traffic is HTTPS GET only to `api.dayclaw.com` at the fixed path.
- User-triggered links may open only validated X/Twitter HTTPS URLs or the fixed Tibo profile URL.
- No X cookies, X login, OpenAI/Codex credentials, environment secrets, or browser data are read.
- No analytics, telemetry, tracking pixel, crash upload, or media download is performed.
- The plugin sends no local state to any server.

## Build and installation

The source project uses Bun for TypeScript execution, tests, image generation, and bundling. Runtime code uses platform and Bun APIs where practical; version 1 should avoid third-party runtime packages unless implementation proves one necessary and the plan is amended.

The release build produces one inspectable `dist/tibo-raccoon.2m.js` artifact containing:

- SwiftBar metadata;
- the absolute Bun invocation mechanism;
- polling, rendering, state, and action logic;
- Base64 light/dark calm, unread, and offline raccoon PNGs.

The installer:

1. verifies macOS, SwiftBar, and Bun are present;
2. asks for or accepts an explicit SwiftBar plugin-directory path;
3. builds and validates the release artifact;
4. copies it as executable without changing existing Tibo Raccoon state;
5. prints the exact installed path and a manual refresh instruction.

It does not install Homebrew, Bun, SwiftBar, login items, launch agents, or background services. Reinstallation preserves state. Uninstallation removes only the installed plugin by default; retained application-support state is reported so the user can remove it separately if desired.

Building and testing in the repository are within implementation scope. Copying the artifact into the user's live SwiftBar plugin directory is a separate, explicit approval boundary.

## Testing strategy

Deterministic Bun tests use local fixtures and temporary state directories. They cover:

- first-run baseline with no historical unread flood;
- empty-response initialization and empty-response recovery semantics;
- new-ID detection, duplicate suppression, stable newest-first ordering, and same-time tie-breaking;
- all-unread retention and recent-read history pruning;
- **Mark all as read**, including a simulated concurrent fetch merge;
- text, mixed-media-shaped, empty-text/media-only, strict RFC 3339, missing-time, and invalid-item payloads;
- all accepted response envelopes, size/item/text limits, redirect rejection, and malformed-envelope rejection;
- SwiftBar escaping, multiline wrapping, separator injection, exact URL-field handling, and URL allowlisting;
- backoff progression, 30-second duplicate suppression, manual bypass, recovery, and cached-state preservation;
- calm, unread, and offline state precedence;
- snapshot hashes or exact bytes for all six light/dark icon assets;
- absolute Bun shebang, `runInBash=false`, action arguments, action stdout, exit behavior, and post-action refresh output;
- lock contention, owner-aware stale-lock recovery, atomic-write interruption, corrupt-state preservation, and unread-first recovery;
- a built-artifact smoke test that verifies executable metadata and non-empty SwiftBar output.

An opt-in read-only live check may fetch the fixed Dayclaw endpoint and validate its current schema. It is not part of the default test suite because availability and third-party payload changes are outside the repository's control. It must not alter the real user state directory.

## Acceptance criteria

Version 1 is ready for a separate installation decision when all of the following are true:

- The fixture suite and built-artifact smoke test pass.
- A clean temporary first run shows the latest five posts as read and zero unread.
- Adding one fixture post changes the image to the approved attentive-eye raccoon with muted oxide-red corner marks and shows its exact text.
- Empty-text posts show **New media post from Tibo** with a validated original link.
- Unread state persists across normal refreshes, failures, process exits, and rebuilds until **Mark all as read** is invoked.
- Three simulated failures produce the closed-eye offline state only when no unread posts exist.
- Recovering from corrupt or unsupported state preserves the damaged file and treats current feed items as unread.
- All post text is inert under SwiftBar parsing tests.
- The release artifact is a single executable `.2m.js` file and requires no daemon or credentials.
- No live SwiftBar directory, X account, Codex configuration, or background service has been modified during repository-only verification.

## Known limitations and future decisions

- Dayclaw is a third-party, undocumented dependency. A schema or availability change can make the plugin stale until it is updated.
- The endpoint currently exposes a limited current item set and no documented pagination/completeness guarantee. If more posts arrive between successful polls than the endpoint retains, the plugin cannot detect the omitted posts. The two-minute cadence reduces but cannot eliminate this risk.
- Dayclaw currently provides text and an original post URL but not a dependable media payload. The plugin therefore links out for all media.
- A media-only fallback indicates that text is absent; it does not prove which media type exists.
- Rendering every unread post is an intentional product decision. If the user never selects **Mark all as read**, the dropdown and cached unread content can become long; version 1 does not hide or auto-clear unread posts.
- `knownIds` grows with the number of posts ever observed. This is a deliberate deduplication trade-off at the expected posting volume. Version 1 provides no automatic compaction or in-menu state reset because either could re-alert old posts; removing the application-support directory is the explicit full reset.
- X/Twitter link-host rules may need a deliberate update if canonical post URLs move to another domain.
- There is no reset classifier by design. If classification is ever reconsidered, it must remain an optional annotation and may not hide raw posts.

## References

- [SwiftBar plugin documentation](https://github.com/swiftbar/SwiftBar#plugin-api)
- [codex-reset-watchdog](https://github.com/thinkingjimmy/codex-reset-watchdog)
- [claude-codex-battery](https://github.com/dennykim123/claude-codex-battery)
