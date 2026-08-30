# Tibo Raccoon SwiftBar Plugin

Tibo Raccoon is a small, single-file [SwiftBar](https://swiftbar.app/) plugin that watches Tibo's public posts and keeps newly observed posts unread until you explicitly clear them.

## Prerequisites

- macOS and SwiftBar.
- Bun at an absolute, current-user-executable path.
- Contributors only: run `bun install` in this repository to install the development dependencies. The installer never runs it and never installs Bun, SwiftBar, Homebrew, packages, services, login items, or dependencies.

## Repository commands

```sh
bun run check
bun run build
```

Normal repository checks and builds use fixtures and temporary state only: they make no live Dayclaw request and do not copy a plugin into any live SwiftBar directory.

The following is deliberately opt-in and makes one read-only request to the fixed Dayclaw feed to validate its current schema. It does not read or write Tibo Raccoon state:

```sh
bun run live-check
```

## Install and refresh

First choose the SwiftBar plugin directory yourself. Then run this exact command, replacing the quoted absolute directory with your chosen SwiftBar plugin directory:

```sh
bun --no-install run install:plugin -- --plugin-dir "/absolute/path/to/SwiftBar Plugins"
```

The command explicitly disables Bun auto-install, builds one `tibo-raccoon.2m.js` artifact, installs only that file with mode `0755`, prints its exact installed path, and never installs dependencies. If contributor dependencies are missing, it exits with a fixed instruction to run `bun install`; that contributor-only command remains a separate action. In SwiftBar, choose **Refresh All** after installation completes.

## What the raccoon means

- Calm: relaxed, slightly half-open eyes and a viewer-right mint-celadon nose drip. There are no unread posts and the feed is not in a sustained failure state.
- Unread: flame eyes with a muted oxide-red corner frame. Unread has priority over offline.
- Offline: closed eyes after three consecutive failed feed attempts when there are no unread cached posts.

All three menu-bar images are crisp 31×23 pixel assets, about 80% of the original raccoon size.

The menu shows `Tibo Raccoon · N unread`. **Mark all as read** clears only the unread IDs currently persisted at the moment you choose it; opening a post never clears it, and later newly observed posts stay unread.

Posts are shown newest first in high-contrast thought-bubble groups. Each group shows up to four 54-code-point rows copied verbatim from Tibo's text; longer posts end with an ellipsis and link to the complete original on X. The plugin never summarizes or semantically rewrites the preview. An empty-text item is shown as **New media post from Tibo** and may include its validated original link. The plugin never renders, downloads, infers, or analyzes media.

## Privacy and limits

The only feed request is HTTPS GET to `https://api.dayclaw.com/api/source/public/x/thsottiaux/items`. User-facing links are limited to validated HTTPS X/Twitter links, including Tibo's fixed profile at `https://x.com/thsottiaux`. It does not use credentials, cookies, browser data, X login, OpenAI/Codex data, telemetry, analytics, tracking pixels, or media downloads.

Private state is retained at `~/Library/Application Support/Tibo Raccoon/`: the directory is mode `0700` and its state files are mode `0600`.

Dayclaw is a third-party, undocumented feed. It currently exposes a limited current item set and no documented pagination or completeness guarantee, so posts omitted between successful polls cannot be reconstructed. Its media metadata is not dependable; the empty-text fallback signals missing text, not a known media type.

## Uninstall or fully reset

Uninstall removes only the explicitly named regular plugin artifact and retains your private state:

```sh
bun run uninstall:plugin -- --plugin-path "/absolute/path/to/tibo-raccoon.2m.js" --yes
```

An optional full reset is separate from uninstall. If you intentionally want to discard the retained history, move the state directory into macOS Trash rather than permanently deleting it:

```sh
mv "$HOME/Library/Application Support/Tibo Raccoon" "$HOME/.Trash/Tibo Raccoon-$(date +%Y%m%d-%H%M%S)"
```
