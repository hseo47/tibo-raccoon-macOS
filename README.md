# Tibo Raccoon (티보구리)

Tibo Raccoon is an unofficial [SwiftBar](https://swiftbar.app/) plugin that watches Tibo's public [@thsottiaux](https://x.com/thsottiaux) feed and marks posts first observed after its initial baseline as unread for macOS.

> **Current distribution:** install from source. There is no DMG or one-click installer yet, and the installed plugin uses Bun at runtime.

This is a menu-bar indicator, not a macOS Notification Center service. Flame eyes and `NEW` labels mean unread posts are waiting; there are no notification banners or sounds.

## Raccoon states

| Calm | Unread | Offline |
| :---: | :---: | :---: |
| <img src="assets/icons/calm-light.png" width="62" alt="Calm raccoon"> | <img src="assets/icons/unread-light.png" width="62" alt="Unread raccoon with fire eyes"> | <img src="assets/icons/offline-light.png" width="62" alt="Offline raccoon with closed eyes"> |
| No unread posts and fewer than three consecutive feed failures. The relaxed raccoon has a viewer-right mint-celadon nose drip. | One or more unread posts. Fire eyes and a muted oxide-red frame take priority over the offline appearance. | Three or more consecutive feed failures, provided there are no unread posts. Cached posts remain available. |

All three menu-bar images are crisp 31×23 pixel assets with separate light and dark variants.

## What it does

- Runs on SwiftBar's two-minute schedule and requests the public Tibo feed when a poll is due.
- Treats the first successful response as an all-read baseline, so installing the plugin does not mark the existing feed as new.
- During normal operation, marks IDs first observed on later successful refreshes as unread and never re-alerts an ID it already knows.
- Keeps unread posts unread until you choose **Mark all as read**. Opening a post does not mark it read.
- Shows every unread post, followed by enough recent read posts to reach five posts when that many are available. If more than five posts are unread, it shows all of them.
- Displays source text verbatim except for SwiftBar-safety substitutions, in thought-bubble groups of at most four rows of 54 Unicode code points, with an ellipsis when the preview is longer.
- Links to the complete original post on X when the feed supplies a valid link.
- Keeps cached content visible during feed failures and backs off repeated failed requests.

Tibo Raccoon does not summarize, classify, translate, or semantically rewrite posts. It does not infer whether a post concerns Codex, a reset, a launch, or anything else.

## Requirements

- macOS.
- [SwiftBar](https://swiftbar.app/), launched with an existing plugin folder selected.
- [Bun](https://bun.sh/), installed at an absolute executable path without whitespace.
- Internet access while the plugin is running so it can reach the public Dayclaw feed.
- Terminal for source installation, updating, and uninstalling.

The current version has been verified on Apple Silicon with macOS 26.5.1, Bun 1.4.0, and SwiftBar 2.1.1 build 597. The installer does not enforce those exact versions, and other configurations have not yet been release-tested.

Tibo Raccoon's own source installer does not need Homebrew, Xcode, administrator access, an X account, or an OpenAI account. Installing the prerequisite applications may have their own authorization requirements.

## Install from source

1. Download or clone this repository.
2. Open SwiftBar once and select or confirm the plugin folder it watches.
3. Open Terminal in the downloaded repository folder.
4. Install the source-build dependencies:

   ```sh
   bun install
   ```

5. Run the installer and paste the absolute SwiftBar plugin-folder path when prompted:

   ```sh
   bun --no-install run install:plugin
   ```

   Example response:

   ```text
   /Users/your-name/Documents/SwiftBar Plugins
   ```

6. In SwiftBar, choose **Refresh All**.

For a noninteractive installation, provide the directory directly. Replace this example if SwiftBar watches a different folder:

```sh
bun --no-install run install:plugin -- \
  --plugin-dir "$HOME/Documents/SwiftBar Plugins"
```

The plugin directory must already exist. At the interactive prompt, paste the complete `/Users/...` path. In a shell command, `$HOME/...` is supported; a literal `~/...` path is never accepted. Spaces in the SwiftBar plugin-folder path are supported, but the Bun executable's own path cannot contain whitespace in the current release.

Installation builds and verifies one executable file, then places it in the selected folder with mode `0755`:

```text
tibo-raccoon.2m.js
```

The file contains its exact Bun interpreter path, SwiftBar metadata, runtime code, and all six raccoon images. The installer itself does not install Bun, SwiftBar, Homebrew, services, login items, or administrator-level components; `bun install` is the separate dependency step above.

### First refresh

On a brand-new installation with no retained state, the first successful refresh establishes the baseline. Existing posts will initially appear as read and the raccoon will remain calm. Posts first observed on later successful refreshes become unread and light the raccoon's eyes on fire. A reinstall with retained state resumes the earlier known/unread history instead of creating a new baseline.

## Using the menu

The menu starts with `Tibo Raccoon · N unread`, followed by the selected post previews.

- **Mark all as read** clears the unread IDs currently saved when the action runs. A newer post arriving concurrently remains unread.
- **Refresh now** forces one feed attempt even if the normal schedule is inside its duplicate-suppression or backoff window.
- **Open Tibo's profile** opens the fixed [@thsottiaux](https://x.com/thsottiaux) profile.
- **Read full post on X →** opens a validated original-post link.
- The final row reports the last successful refresh or explains that cached data is being shown.

Unread posts are listed first, newest first within that group. Recent read posts follow. A missing or invalid source timestamp is shown as **Time unavailable**; this does not mean the Mac clock is wrong. A missing or rejected X link is shown as **Full post link unavailable**.

When the feed supplies no text, the preview says **New media post from Tibo**. This is a fallback for an empty text field, not proof of a particular media type. The plugin does not render, download, identify, or analyze images, video, audio, polls, or other attachments.

## Update

Pull or download the newest source, open Terminal in the repository folder, and run:

```sh
bun install
bun --no-install run install:plugin
```

Choose the same SwiftBar plugin folder, then select **Refresh All** in SwiftBar. Updating replaces `tibo-raccoon.2m.js` and preserves the private state at:

```text
~/Library/Application Support/Tibo Raccoon/
```

There is no automatic updater in the current release.

## Uninstall

Open Terminal in the repository folder and run the uninstall command with the exact absolute plugin path. For the example plugin folder used above:

```sh
bun run uninstall:plugin -- \
  --plugin-path "$HOME/Documents/SwiftBar Plugins/tibo-raccoon.2m.js" \
  --yes
```

Then choose **Refresh All** in SwiftBar. Uninstall removes only that exact regular plugin file and retains the state directory, so reinstalling resumes the known/unread history.

### Optional full reset

Only do this if you intentionally want to discard the retained history. First quit SwiftBar so the running plugin cannot recreate state during the reset. Then move the state directory into the current user's Trash rather than permanently deleting it:

```sh
mv "$HOME/Library/Application Support/Tibo Raccoon" \
  "$HOME/.Trash/Tibo Raccoon-$(date +%Y%m%d-%H%M%S)"
```

Reset is deliberately separate from uninstall. Reopen SwiftBar after the move.

## Privacy and security

The plugin's own network polling consists of HTTPS `GET` requests to one fixed public endpoint:

```text
https://api.dayclaw.com/api/source/public/x/thsottiaux/items
```

Requests reject redirects, time out after eight seconds, and accept at most two MiB of response data. Dayclaw is a third party and will receive ordinary network metadata such as the requester's IP address.

The plugin does not use:

- X credentials, cookies, browser data, or an X login;
- OpenAI or Codex account data;
- telemetry, analytics, tracking pixels, or advertising;
- media downloads;
- runtime third-party package imports.

Post links are accepted only when they use HTTPS on `x.com` or `twitter.com` without embedded credentials or a non-default port. Choosing a post or profile link intentionally hands that URL to SwiftBar and the user's browser, which creates separate browser network activity.

Remote post text is sanitized before being rendered as SwiftBar menu rows. Control characters, row separators, and parameter-looking pipe characters cannot become executable SwiftBar parameters.

Private state is stored at:

```text
~/Library/Application Support/Tibo Raccoon/state.json
```

The directory is mode `0700`; state and lock files are mode `0600`. State includes public post IDs, cached text, timestamps, links, unread history, and sanitized failure categories. Invalid state is preserved under a timestamped `.corrupt-*` filename before recovery begins; the next successful recovery response is then treated as unread so a damaged history cannot silently hide current posts.

## Feed limitations

Dayclaw is a third-party, undocumented feed. The plugin does not access X directly, and the feed provides no documented pagination, completeness, delivery-time, or historical-recovery guarantee. A post that appears and disappears between polls without being included in any fetched snapshot cannot be reconstructed, so this project must not be described as guaranteeing that it will never miss a post.

Scheduled executions suppress duplicate attempts inside 30 seconds. Consecutive failures retain cached posts and back off for 2, 4, 8, 16, then 30 minutes. **Refresh now** bypasses that schedule and makes one forced attempt.

The plugin intentionally monitors every observed post. It cannot determine whether Tibo is hinting at a Codex reset, and it should not be treated as an official OpenAI status source.

## Troubleshooting

### `Contributor dependencies are missing`

Run `bun install` in the repository folder. Despite the diagnostic's current wording, these dependencies are required for every source installation because the installer builds the plugin locally.

### `SwiftBar is not installed`

Ensure `SwiftBar.app` is in `/Applications` and visible to Spotlight, launch it once, and select a plugin folder. Then retry the installer.

### Plugin-directory error

The selected directory must already exist, must be a directory, and must be supplied as an absolute path. At the interactive prompt, paste `/Users/...`; `$HOME/...` works only when the shell expands it in a command. A literal `~/...` string is not accepted.

### The raccoon does not appear

Confirm that `tibo-raccoon.2m.js` was installed into the exact folder SwiftBar watches, then choose **Refresh All**.

### No unread posts immediately after installation

That is expected on a brand-new state directory. The first successful response becomes the all-read baseline; only posts first observed later become unread.

### The menu says `Time unavailable`

The feed did not supply a valid timestamp for that post. It is not a problem with the Mac clock.

### The raccoon says the feed is unavailable or offline

Cached posts remain visible. Choose **Refresh now** for one forced attempt, or wait for the backoff window to expire.

### Bun was moved, replaced, or removed

Run the source installer again. The generated plugin records Bun's absolute path in its first line, so it must be rebuilt if that path changes.

### Bun is installed under a path containing whitespace

The current installer rejects that configuration. Install or expose Bun at an absolute executable path without whitespace, then rerun installation.

## Development and verification

Install dependencies once, then run the complete offline check:

```sh
bun install
bun run check
```

`bun run check` performs strict TypeScript checking, runs the complete test suite, and builds the plugin with fixtures and temporary state. It does not call the live Dayclaw feed or read, write, or install into the user's real Tibo Raccoon state or SwiftBar folder.

Additional commands:

```sh
bun run build       # Build dist/tibo-raccoon.2m.js
bun run live-check  # Make one read-only request to validate the live feed schema
```

`dist/` is intentionally ignored by Git, so the current repository distribution is source-only. The live check does not read or write Tibo Raccoon state.

The current offline suite contains 177 passing tests on the verified development setup described above. There is not yet a public CI workflow or a broader compatibility matrix.

## Packaging status

A native Installer DMG has been designed but not implemented. The current source version uses package and plugin metadata `v0.1.0` and remains the source-installed Bun/SwiftBar plugin documented above. The packaging design is available in [`docs/superpowers/specs/2026-08-30-tibo-raccoon-native-dmg-design.md`](docs/superpowers/specs/2026-08-30-tibo-raccoon-native-dmg-design.md); it is a plan, not a downloadable release.

## License

Tibo Raccoon is available under the [MIT License](LICENSE).
