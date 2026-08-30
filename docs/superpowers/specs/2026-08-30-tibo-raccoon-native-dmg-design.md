# Tibo Raccoon Native Installer DMG — Design

**Date:** 2026-08-30

**Status:** Approved in chat; awaiting document review

**Release target:** `Tibo-Raccoon-0.1.0-arm64.dmg`

## Summary

Tibo Raccoon will gain an unsigned, shareable Apple Silicon release distributed as a compressed, read-only DMG. The DMG contains a native macOS installer and a short Read Me. The installer places a self-contained SwiftBar plugin in the user-confirmed SwiftBar plugin folder, upgrades the current Bun-script installation without duplicating the raccoon, preserves all private state, and can uninstall only the plugin.

Recipients need Apple Silicon, one of the macOS release majors validated for 0.1.0 (13, 14, 15, or 26), and SwiftBar 2.1.1 or newer. They do not need Bun, Homebrew, Xcode, administrator access, or repository dependencies.

Because this release is not signed with a Developer ID certificate and is not notarized, it is not a frictionless public release. In the 0.1.0 test matrix, macOS 13 and 14 may offer **Open** from the Control-click context menu; the observed recovery path on macOS 15 and 26 is an initial blocked launch followed by **System Settings → Privacy & Security → Open Anyway**. The installed plugin may require its own approval when SwiftBar first executes it. The installer must explain these boundaries accurately and must never remove quarantine attributes.

## Goals

- Produce a shareable Apple Silicon DMG with a native, single-window installer.
- Remove the recipient's Bun-path and contributor-dependency requirements.
- Preserve the existing raccoon artwork, polling, cache, unread behavior, thought-bubble menu, actions, and hidden SwiftBar footer.
- Install and upgrade atomically without leaving duplicate SwiftBar plugins.
- Preserve `~/Library/Application Support/Tibo Raccoon/` during install, update, and uninstall.
- Provide an unprivileged uninstall action that removes only the verified plugin.
- Verify the compiled plugin, native app, and final mounted DMG in automated release checks.
- Publish a SHA-256 checksum alongside the DMG.

## Non-goals

- Developer ID signing, notarization, stapling, or a claim that Gatekeeper will open the release normally.
- Intel support or a universal binary in version 0.1.0.
- Installing SwiftBar, Bun, Homebrew, packages, services, login items, or developer tools.
- A privileged `.pkg`, system-wide installation, launch daemon, or background installer.
- Resetting, deleting, reading, or migrating the user's Tibo Raccoon state.
- Rewriting the tested TypeScript plugin in Swift.
- Automatic update checks, telemetry, analytics, or network activity by the installer.
- A custom DMG background or elaborate Finder choreography in version 0.1.0.

## Supported environment

| Requirement | Version or behavior |
| --- | --- |
| CPU | Apple Silicon (`arm64`) |
| macOS | Release majors 13, 14, 15, and 26 |
| SwiftBar | 2.1.1 or newer |
| Bun on recipient Mac | Not required |
| Administrator access | Not required |
| Network during install | Not required |
| Distribution trust | Unsigned and unnotarized |

The installer rejects an unsupported CPU or OS before writing anything. Version 0.1.0 accepts only macOS major versions 13, 14, 15, and 26; an unknown future major is blocked as unvalidated until a release update adds it and refreshes the Gatekeeper/runtime matrix. It locates SwiftBar by bundle identifier `com.ameba.SwiftBar`, reads `CFBundleShortVersionString`, and accepts only a release string matching exactly three decimal components (`major.minor.patch`). It compares those components numerically against `2.1.1`; a missing value, malformed value, prerelease suffix, or older version blocks installation. It reads SwiftBar's `PluginDirectory` preference only as a suggested destination. If SwiftBar is missing, the app shows the prerequisite and offers to open the official SwiftBar page; it does not install SwiftBar.

## Release contents

The final release directory contains:

```text
release/
├── Tibo-Raccoon-0.1.0-arm64.dmg
└── Tibo-Raccoon-0.1.0-arm64.dmg.sha256
```

The mounted DMG volume is named `Tibo Raccoon 0.1.0` and contains:

```text
Tibo Raccoon 0.1.0/
├── Install Tibo Raccoon.app
└── Read Me.html
```

The DMG does not include an Applications alias because the installer is a one-shot utility and does not need to remain installed. A recipient may run it from the mounted image.

## Native installer experience

`Install Tibo Raccoon.app` is an ARM64 SwiftUI application backed by a UI-independent Foundation installer core. Its single window contains:

- the approved calm raccoon artwork;
- product name and version;
- Apple Silicon, macOS, and SwiftBar prerequisite status;
- the resolved SwiftBar plugin folder with a **Change…** button;
- an **Install** or **Update** primary button;
- an **Uninstall** secondary button;
- one concise progress or result message;
- an **Open SwiftBar** or **Open Plugin Folder** follow-up when applicable.

The app runs as the current user and never requests authorization. Selecting **Install** is explicit confirmation of the displayed canonical destination. **Change…** uses `NSOpenPanel` in directory-selection mode and then displays the resolved path before any write.

The app labels the release as unsigned. The Read Me explains:

1. mount the DMG;
2. on macOS 13 or 14, try Control-click **Install Tibo Raccoon.app** and **Open**; if that option is unavailable or the launch remains blocked, try once normally and use **System Settings → Privacy & Security → Open Anyway**;
3. on macOS 15 or 26, follow the release-matrix-observed path: try to open the app once, then use **System Settings → Privacy & Security → Open Anyway** and authenticate when macOS requests it;
4. confirm the detected SwiftBar plugin folder;
5. choose **Install**.

If **Open Anyway** is absent or disabled by device-management policy, the instructions stop and direct the user to the Mac administrator; they never suggest disabling Gatekeeper. The documentation states only that a second Privacy & Security approval may be required for the installed plugin, depending on the measured final quarantine xattr and that OS's response.

The Read Me has two byte-identical outputs generated from one source: an embedded `Contents/Resources/Read Me.html` used by the app and a DMG-root `Read Me.html` available in Finder. The app opens only the embedded copy via `Bundle.main`; it never derives or opens a sibling path on the DMG. Every bundled payload, manifest, metadata document, icon, and embedded Read Me is located from `Bundle.main`; neither the installer nor its tests use the current working directory or an executable-relative path. This remains true when the app is launched from a randomly named mount, copied with `/usr/bin/ditto --rsrc --extattr`, or run from an App Translocation path.

The installer creates the staged executable with descriptor-anchored read/write operations, not a path-copy helper. It explicitly preserves `com.apple.quarantine` from the embedded payload when that attribute is present, never synthesizes or deletes it, and separately applies only the required `com.ameba.SwiftBar` metadata attribute. Release tests measure rather than assume quarantine propagation at the downloaded DMG, mounted app, embedded payload, staged file, and final installed file.

## Portable plugin artifact

The release build compiles the existing `src/main.ts` runtime closure into one self-contained Mach-O executable with Bun's standalone executable support:

```text
tibo-raccoon.2m.bin
```

The name preserves SwiftBar's two-minute schedule contract. The `.bin` suffix distinguishes the Mach-O release artifact from the contributor-oriented `.js` artifact. Version 0.1.0 is built with exactly Bun 1.4.0 for target `bun-darwin-arm64`, with production minification and runtime loading of `.env`, `bunfig.toml`, `tsconfig.json`, and `package.json` disabled. The release builder refuses any other `bun --version`. It verifies that the resulting Mach-O deployment target is compatible with macOS 13.0. The executable embeds the Bun runtime, TypeScript bundle, and all six generated icon payloads. No runtime package or adjacent asset is required.

The existing JavaScript build remains available for contributor checks and local development. The DMG uses only the compiled binary release path.

The executable size is measured and recorded for each release because it embeds Bun, but size is informational rather than a release contract. Removing the recipient's runtime dependency is the priority.

### SwiftBar metadata

A Mach-O file cannot carry the current source-comment header. The installer writes SwiftBar's documented binary-plugin extended attribute `com.ameba.SwiftBar` using the Base64 encoding of this exact metadata document:

```text
# <xbar.title>Tibo Raccoon</xbar.title>
# <xbar.version>v0.1.0</xbar.version>
# <xbar.author>Hojin</xbar.author>
# <xbar.desc>Watch Tibo's public posts from the macOS menu bar.</xbar.desc>
# <xbar.dependencies>swiftbar</xbar.dependencies>
# <swiftbar.runInBash>false</swiftbar.runInBash>
# <swiftbar.hideAbout>true</swiftbar.hideAbout>
# <swiftbar.hideRunInTerminal>true</swiftbar.hideRunInTerminal>
# <swiftbar.hideLastUpdated>true</swiftbar.hideLastUpdated>
# <swiftbar.hideDisablePlugin>true</swiftbar.hideDisablePlugin>
# <swiftbar.hideSwiftBar>true</swiftbar.hideSwiftBar>
```

The UTF-8 metadata document ends with exactly one LF. Its extended-attribute value is standard Base64 ASCII with no line wrapping and no trailing LF or NUL. `runInBash=false` is required by this release's direct Mach-O execution contract. The five hide flags preserve the approved normal-click menu. SwiftBar intentionally reveals hidden defaults on Option-click.

The app embeds the decoded metadata document as a normal bundle resource. It opens the transaction-staged payload without following symlinks, applies `com.ameba.SwiftBar` with Darwin `fsetxattr`, reads it back with `fgetxattr`, and compares both the encoded attribute bytes and decoded document byte-for-byte before activation. The installer applies the attribute itself; the release never relies on DMG or Finder copying to preserve a payload xattr. Release verification repeats the exact encoded and decoded checks after DMG creation, and a real SwiftBar acceptance test proves that SwiftBar loads the installed binary from this attribute.

### Local code signatures

The distribution remains unsigned in the Developer ID sense. After compilation, the build signs the plugin with the following fixed recipe, using a committed entitlements plist:

```text
codesign --force --sign - --options runtime \
  --identifier com.hojin.tiboraccoon.plugin \
  --entitlements TiboRaccoonPlugin.entitlements \
  tibo-raccoon.2m.bin
```

This creates an ad-hoc signature with the hardened-runtime flag and explicit Bun runtime exceptions; ad-hoc signing itself does not grant those permissions.

Version 0.1.0 deliberately starts with this least-privilege subset of Bun's broader documented standalone-signing example:

- `com.apple.security.cs.allow-jit`;
- `com.apple.security.cs.allow-unsigned-executable-memory`;
- `com.apple.security.cs.disable-executable-page-protection`.

The plist contains exactly those three Boolean `true` keys and no others. This is a release-gated experiment for this fixed bundle, not a claim that three keys are sufficient for every Bun executable: Bun's documentation also recommends `allow-dyld-environment-variables` and `disable-library-validation`. Tibo Raccoon does not intentionally load external libraries or depend on dynamic-loader environment variables, so 0.1.0 omits those broader exceptions. If the three-key hardened-runtime build cannot pass isolated executable and real SwiftBar smoke tests across the release OS matrix, implementation stops for a design amendment rather than silently adding them.

The native installer app is ad-hoc signed without special entitlements after its bundle is fully assembled. Ad-hoc signatures provide neither developer identity nor Gatekeeper trust. Product copy and documentation must not imply otherwise.

## Installer architecture

The installer is divided into small, testable units:

1. **Prerequisite inspector** — reports architecture, OS, SwiftBar application, and suggested plugin directory.
2. **Destination validator** — canonicalizes a user-confirmed directory, validates ownership, type, and access, then opens a stable directory descriptor for every mutation.
3. **Payload verifier** — validates the embedded release manifest, SHA-256, ARM64 Mach-O shape, mode, ad-hoc signature, and expected metadata sidecar.
4. **Recovery engine** — interprets the committed transaction journal and either completes cleanup or restores the previous installation before new work.
5. **Install transaction** — stages, verifies, activates, rolls back, and migrates a recognized legacy artifact.
6. **Uninstall transaction** — validates, detaches, and moves only a recognized installed plugin to Trash.
7. **SwiftBar refresher** — opens only the installed plugin's refresh URL and provides a manual fallback.
8. **SwiftUI view model** — converts core results into the single-window interface without owning filesystem logic.

The filesystem and SwiftBar-opening boundaries use dependency injection. Unit tests use temporary directories and fakes; they never inspect or modify the real SwiftBar folder, live state, global defaults, or installed application.

## Destination discovery and validation

The app first verifies that SwiftBar exists by bundle identifier. It obtains `PluginDirectory` from the `com.ameba.SwiftBar` defaults domain and treats it only as a suggestion.

Before enabling Install or Uninstall, the app:

- expands a leading tilde only in the suggested preference value;
- requires an absolute path;
- resolves symlinks and displays the resulting canonical path;
- requires an existing directory owned by the current user;
- requires current-user read, write, and search access;
- opens the confirmed directory with Darwin `open` using `O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC` and validates its owner, mode, device, and inode with `fstat`;
- obtains the live descriptor path with `fcntl(F_GETPATH)`, canonicalizes and displays that path, and binds the user's Install/Uninstall confirmation to the still-open descriptor rather than to the earlier suggestion string;
- anchors every child inspection and mutation to that open descriptor with `openat`, `mkdirat`, `fstatat`, `renameat`, and `unlinkat`, using `O_NOFOLLOW` or `AT_SYMLINK_NOFOLLOW` as applicable;
- keeps that descriptor open through recovery and the complete install or uninstall transaction, so replacing a path component after confirmation cannot redirect a write;
- rejects control characters and path representations that the existing SwiftBar action quoting contract cannot represent.

The canonical string is for display and later re-selection, not a mutation authority. The app never creates a conventional plugin folder silently. If the preference is absent or invalid, the user must select an existing directory.

## Embedded release manifest

The installer bundle contains a manifest with fixed, non-user-controlled values:

- product ID;
- semantic version;
- payload filename;
- payload SHA-256;
- exact encoded xattr SHA-256 and decoded metadata SHA-256;
- target CPU and minimum macOS version;
- expected executable mode;
- expected installed filenames for the binary and recognized legacy script;
- an ownership allowlist for every binary and legacy script version this release may replace;
- release provenance: Bun binary SHA-256, Bun version, Swift compiler version, macOS SDK version, builder macOS version, and deployment targets.

An allowlisted binary entry contains the exact full-file SHA-256, decoded metadata SHA-256, product ID, version, filename, and mode. An allowlisted legacy JavaScript entry contains the exact SHA-256 of the byte suffix beginning immediately after its first LF, plus the expected source metadata, filename, and mode. A candidate legacy script must start with one bounded ASCII absolute-path Bun shebang, contain no CR or NUL in that line, and otherwise match the suffix digest exactly; no other normalization is permitted. This admits the current deterministic bundle when only its machine-specific shebang path differs.

The 0.1.0 manifest recognizes the current JavaScript release and its own binary payload. Each future installer explicitly carries hashes for every earlier release it supports upgrading. Matching a filename or product metadata without an allowlisted content digest is never sufficient: an unknown artifact is preserved and reported as a migration conflict.

The manifest and allowlist provide corruption and filename-collision protection, not publisher authentication. In an unsigned release, an attacker who can replace the app can also replace its manifest. The separately published DMG checksum has the same limitation unless distributed over an independently trusted channel; documentation must not overstate either guarantee.

## Install and update transaction

The installed path is:

```text
<confirmed SwiftBar plugin folder>/tibo-raccoon.2m.bin
```

The recognized legacy path is:

```text
<confirmed SwiftBar plugin folder>/tibo-raccoon.2m.js
```

Before any install or uninstall, the recovery engine enumerates only direct children through the open destination descriptor and looks for names matching `.tibo-raccoon-transaction-v1-<UUID>`. SwiftBar documents hidden folders—not arbitrary hidden files—as ignored, so every staged payload, backup, and journal lives inside one exclusive transaction directory created with `mkdirat`, mode `0700`, on the destination filesystem. Only the final active plugin is ever placed as a file in the watched directory root.

The transaction directory contains a mode-`0600` `journal.json`, a staged payload, and zero or more allowlisted backups. The journal has a fixed schema version, monotonic sequence, transaction UUID, operation, phase, expected root names, expected content hashes, and backup names. `journal.json` is the sole committed authority. Each update is first written to the fixed `journal.next` name and `fsync`ed; that file is uncommitted intent until `renameat` atomically replaces `journal.json` and the transaction directory is synced. If recovery finds both files, it verifies that `journal.next` is exactly the allowed next sequence and transition, discards it, syncs the directory, and follows `journal.json`. If an initial valid `created` `journal.next` is the directory's sole child, no root mutation was authorized: recovery unlinks it, syncs the now-empty transaction directory, removes that directory, and syncs the destination. Any other no-`journal.json` state is a conflict.

Every sync call is checked. A failure stops the transaction at the current recoverable phase. These calls establish ordering for normal execution and process-termination recovery, but the design does not claim that macOS `fsync` and directory sync can prove physical-media ordering across a kernel panic or sudden power loss. After such an event, the same recovery engine proceeds only when the journal and filesystem match an accepted state; otherwise it preserves all artifacts and reports a recovery conflict. Version 0.1.0's atomicity claim is therefore scoped to caught failures and process termination, with fail-closed inspection after a machine-level crash.

Immediately after `mkdirat`, the app syncs the destination and writes a `created` journal before staging any payload. Apart from the sole-valid-`journal.next` case above, recovery may remove a transaction directory with no journal only when its name has a valid UUID, it is owned by the current user with mode `0700`, and it is completely empty. Any other nonempty no-journal directory is a conflict. This closes the unavoidable process-stop window between exclusive directory creation and the first committed journal without granting permission to delete arbitrary hidden content.

Install and update use these committed phases:

1. **prepare** — validate prerequisites and the embedded manifest, recover an interrupted transaction, inspect only the two expected root filenames with `fstatat(..., AT_SYMLINK_NOFOLLOW)`, and refuse special files, symlinks, or unknown regular files at those names.
2. **created** — exclusively create and open one transaction directory, sync the destination, and commit the initial journal before adding any other child.
3. **prepared** — copy the `Bundle.main` payload into the transaction directory, set mode `0755`, apply the exact xattr, and verify hash, architecture, deployment target, signature, mode, encoded xattr, and decoded metadata. Run it against a marked temporary test-state directory; require exit zero, empty standard error, no network, and a valid paired-image SwiftBar header. Persist `prepared` only after all checks pass.
4. **moving_old** — commit intent, then move each allowlisted existing binary or legacy script from the root into the transaction directory with `renameat`; sync both directories after each move.
5. **old_moved** — commit that the old artifacts are backed up and the final binary name is absent.
6. **activating_new** — commit intent, atomically rename the verified staged payload to `tibo-raccoon.2m.bin`, then sync both directories.
7. **new_active** — verify and smoke-test the final descriptor-anchored path, then commit that the new binary is active while backups remain.
8. **committed** — commit success, remove only journal-listed backups, sync, and remove the empty transaction directory.

Recovery runs before every new transaction and evaluates the journal together with descriptor-anchored filesystem facts:

- `created` or `prepared` means no root artifact moved; remove only the journal-listed transaction contents and directory after verifying them.
- `moving_old` restores any journal-listed artifact already moved and leaves any not-yet-moved root artifact in place.
- `old_moved` restores the backups only when the final name is absent; any occupant at the final name is a conflict.
- `activating_new` rolls back: if the exact new payload reached the final name, move it back into the transaction directory, then restore every allowlisted backup; if the final name is absent, restore the backups directly.
- `new_active` verifies the final payload. If valid, advance to `committed` and finish cleanup; if invalid, detach it into the transaction directory and restore the backups.
- `committed` verifies the expected final payload and completes only the journal-listed cleanup.

Recovery refuses to guess when there are multiple transaction directories, an invalid journal, an unlisted child, a hash mismatch, a phase/filesystem combination outside the state machine, or a collision at a restore path. It preserves everything in place and reports an actionable recovery conflict. Kill-after-every-committed-step tests must prove that each accepted process-termination state converges to either the exact old installation or the exact new installation without duplicates.

Installing the same version is allowed and behaves as a verified repair. Installing a newer version uses the same transaction. Downgrading requires a confirmation that names both versions. A recognized legacy `.js` artifact is removed from the watched root only by being backed up during this successful migration. An unrecognized legacy artifact is never moved or removed.

Every failure is sanitized for the UI, leaves state untouched, and either preserves the old plugin or restores it. Recovery completes or rolls back an already-authorized interrupted operation, but the installer never automatically retries a failed install request.

## State preservation

Install, update, migration, repair, and uninstall must not read, enumerate, chmod, move, replace, quarantine, or delete:

```text
~/Library/Application Support/Tibo Raccoon/
```

The compiled plugin continues to use the existing state schema and path. Replacing the executable therefore preserves known IDs, unread IDs, cached posts, backoff state, and recovery state exactly as the current `.js` installation does.

The installer contains no reset action. The Read Me may state that history is retained, but it does not provide a destructive reset command.

## Uninstall transaction

The **Uninstall** button requires confirmation and operates only on `tibo-raccoon.2m.bin` in the currently confirmed plugin directory. It never treats the metadata xattr alone as ownership.

Before removal, the installer opens the destination descriptor, runs recovery, and requires a current-user-owned regular file whose full hash and decoded metadata match a binary entry in the release ownership allowlist. It refuses a symlink, unexpected file type, missing or mismatched identity metadata, unknown hash, or destination conflict.

On confirmation, uninstall uses the same hidden-directory and journal machinery:

1. create and verify a transaction directory, commit `created`, then commit `uninstall_prepared` with the allowlisted target hash, device, and inode;
2. commit `uninstall_moving`, atomically `renameat` the verified root target to the journal-listed name inside that directory, and sync both directory descriptors;
3. commit `uninstall_removed`, then commit `uninstall_recycling` before calling the macOS recycle API only on that detached transaction-owned path;
4. after the recycle API succeeds, commit `uninstall_recycled` with its returned Trash URL and the detached file identity, then remove the journal and empty transaction directory.

Detaching the descriptor-verified file before recycling prevents a path swap at the public plugin filename from changing what is sent to Trash. If the app stops in `uninstall_moving`, `uninstall_removed`, or `uninstall_recycling` while the exact detached file still exists, recovery restores it and reports an interrupted uninstall rather than retrying the recycle operation. If that file is absent before `uninstall_recycled` was committed, recovery cannot distinguish a completed Trash move from unexpected disappearance: it reports an **indeterminate uninstall**, does not claim the file is recoverable, and asks the user to inspect Trash. After the user acknowledges that result, the app may remove only the empty transaction record. A committed `uninstall_recycled` is the only automatic-success recovery branch. Invalid journals, unknown files, or restore collisions stop for manual recovery.

Uninstall does not remove the installer app, the DMG, the plugin directory, any recognized or unrecognized legacy `.js` artifact, or Tibo Raccoon state. A legacy `.js` is removed only as part of a successful allowlisted install migration.

## SwiftBar refresh behavior

After successful install or update, the app opens the plugin-specific URL using `URLComponents` and `NSWorkspace`:

```text
swiftbar://refreshplugin?plugin=tibo-raccoon.2m.bin
```

The URL is best-effort, not a discovery barrier: for a fresh `.bin` name, it can arrive before SwiftBar's debounced directory observer has registered the file. Successful fresh install and migration therefore rely on eventual file-watcher discovery; an update of an already known `.bin` also receives the targeted refresh. The app never opens SwiftBar's `disableplugin` URL because that records persistent disabled state. Uninstall relies on the file watcher after removal. The app does not call `refreshallplugins`, alter SwiftBar defaults, relaunch SwiftBar, or refresh unrelated plugins.

The result UI tells the user that discovery may take a few seconds. If the raccoon does not appear, or a removed menu item remains visible, the explicit fallback is to quit and reopen SwiftBar; **Refresh All** is not presented as a guaranteed rescan. The completed filesystem transaction remains successful regardless, and the installer never quits or relaunches SwiftBar itself.

## DMG build

The release builder:

1. requires `bun --version` to equal exactly `1.4.0`, hashes the resolved Bun executable, and records that hash together with `swift --version`, the selected macOS SDK version, builder macOS version, and deployment targets;
2. runs the existing TypeScript typecheck and test suite;
3. compiles the ARM64 standalone plugin, rejects an incompatible Mach-O deployment target, applies the exact hardened-runtime ad-hoc signature recipe, and verifies its runtime flag and exact entitlement set;
4. builds and tests the ARM64 native installer core and app with deployment target macOS 13.0;
5. computes the post-signing plugin hash and ownership entries, then assembles the `.app` with payload, metadata, manifest, icon, and embedded Read Me as `Bundle.main` resources;
6. applies and verifies the app's entitlement-free ad-hoc signature after its bundle is complete;
7. stages only the app and a DMG-root Read Me generated byte-for-byte from the same source as the embedded Read Me in a fresh release directory;
8. creates a compressed, read-only UDZO DMG with `hdiutil`;
9. runs `hdiutil verify`;
10. mounts the final DMG read-only and without browsing;
11. verifies exact contents, architectures, signatures, manifest, payload hash, resource lookup, and absence of unexpected files;
12. copies the mounted app to a random temporary path with `/usr/bin/ditto --rsrc --extattr`, then repeats resource, payload, metadata, recovery, install, and uninstall tests in a temporary plugin directory;
13. detaches the image and writes `Tibo-Raccoon-0.1.0-arm64.dmg.sha256` in standard `shasum -a 256` form: 64 lowercase hexadecimal characters, two spaces, the DMG basename, and one LF.

The Bun version is an enforced reproducibility input; the Bun binary hash and Apple toolchain values are provenance recorded in both the release manifest and build log. Any Bun upgrade requires a new review, rebuild, re-sign, and complete verification. Release scripts create and clean only their own temporary directories. Existing output is replaced only when the caller supplies an explicit release output path and confirmation flag; otherwise the build fails closed.

## Verification strategy

### Existing contract

All existing TypeScript tests, strict typecheck, icon checksum tests, state-store tests, build verification, and acceptance tests remain green. The portable binary runs the same calm, unread, and offline fixture states and emits the same menu output as the JavaScript artifact apart from its executable path.

### Portable artifact tests

- Output is one thin ARM64 Mach-O named `tibo-raccoon.2m.bin`.
- Its load commands declare a deployment target compatible with macOS 13.0.
- Output mode is `0755` and `codesign --verify --strict` succeeds for the ad-hoc signature.
- The signature carries the hardened-runtime flag, identifier `com.hojin.tiboraccoon.plugin`, exactly the approved three entitlements, and no broader ones.
- The encoded xattr has no wrapping or terminal whitespace; its decoded UTF-8 metadata has exactly one trailing LF, matches the approved literal, and contains every hide flag exactly once.
- Runtime configuration autoloading is disabled.
- All six canonical icon hashes appear in executed output.
- Isolated calm, unread, and offline fixture executions exit zero with empty standard error and no network.
- `mark-read` and `refresh-now` action rows target the installed binary path safely.
- The executable has no adjacent runtime asset or package dependency.
- The release manifest records Bun 1.4.0, its executable hash, the Swift and SDK versions, builder OS, and both deployment targets.

### Installer core tests

- Missing or unsupported prerequisites cause zero writes. SwiftBar versions absent, malformed, prerelease, `2.1.0`, `2.1.1`, and newer exercise the exact parser and numeric comparison branches.
- Suggested, selected, symlinked, unsafe, control-character, non-directory, wrong-owner, unwritable, and replaced destinations follow the specified validation branches.
- Directory-component replacement after confirmation cannot redirect descriptor-anchored operations; target, backup, transaction-directory, and restore-path symlink swaps are refused.
- Fresh install activates exactly one verified target.
- Same-version repair and newer-version update replace only the target.
- Downgrade requires explicit confirmation.
- Staging and backups exist only inside one mode-`0700` hidden transaction directory; no temporary file appears in the watched root.
- A worker process killed after every `journal.next` write, journal commit, file sync, directory sync, and rename recovers to the exact old or exact new installation without duplicates or unowned residue. Tests separately prove that an uncommitted successor `.next` is discarded and that a sole valid initial `created` `.next` is unlinked, synced, and followed by removal of its now-empty transaction directory.
- Malformed, multiply present, phase-inconsistent, hash-mismatched, or child-injected transaction directories stop without mutation.
- Exact binary full-file hashes and exact legacy post-shebang suffix hashes recognize only allowlisted releases; product metadata alone never establishes ownership.
- Recognized legacy migration removes the duplicate only after final binary verification.
- Unrecognized legacy or target artifacts are preserved and reported.
- If the embedded payload has `com.apple.quarantine`, staging and activation preserve its exact value; if it is absent, the installer does not synthesize one. No branch removes that attribute.
- Install, update, failure, rollback, and uninstall leave a sentinel state tree byte-for-byte and mode-for-mode unchanged.
- Uninstall recycles only an allowlisted target; kills before detachment restore or preserve the target, kills after a committed recycle acknowledgement complete cleanup, and the post-recycle/pre-acknowledgement window reports an indeterminate uninstall without claiming Trash recovery.
- Install, update, migration, and uninstall never invoke `disableplugin` or programmatically refresh all plugins.
- Dynamic paths and errors render as printable, bounded UI text without leaking raw diagnostics.

### Installer UI tests

- The window exposes prerequisite, destination, install/update, uninstall, and result states.
- Buttons are disabled while prerequisites or destination validation fail and while a transaction is running.
- No administrator prompt or destructive reset control exists.
- The app clearly labels the release unsigned and links to the Read Me guidance.
- Every bundled resource resolves from `Bundle.main` when the current directory, mount name, and copied app path are randomized.
- The in-app Read Me link resolves only the embedded resource and never a DMG sibling, including under App Translocation.

### DMG acceptance tests

- `hdiutil verify` succeeds.
- A read-only mount contains exactly the app and Read Me.
- The mounted app is ARM64, has a valid ad-hoc signature, and contains the expected payload and manifest.
- The DMG-root and app-embedded Read Me files are byte-identical.
- The checksum parser accepts exactly the specified standard line and recomputes the DMG file hash.
- A `/usr/bin/ditto --rsrc --extattr` copy from the mounted image resolves every resource and can install into a temporary SwiftBar-like directory without touching live state or the real SwiftBar folder.
- The installed payload retains valid metadata, hash, mode, architecture, and signature.
- An acceptance table records the presence and exact value or explicit absence of `com.apple.quarantine` on the DMG file, mounted app, embedded payload, staged payload, and installed payload; it also records each Gatekeeper alert actually observed.
- Install, repair, migration, update, action execution, forced-crash recovery, rollback, and uninstall pass from the copied app.

### Manual release gate

Before calling version 0.1.0 ready for others, perform clean Apple Silicon user-account or VM smoke tests on the latest available point releases of macOS 13, 14, 15, and 26. Test SwiftBar 2.1.1 at the minimum-version gate and the current SwiftBar release on the newest OS:

1. download or otherwise apply quarantine to the DMG;
2. on macOS 13 and 14, verify the documented Control-click **Open** path; on macOS 15 and 26, verify the initial block followed by **Privacy & Security → Open Anyway**;
3. launch the installer from the mounted DMG, record whether App Translocation occurs, and verify all `Bundle.main` resources resolve there;
4. install into the user-confirmed SwiftBar folder and complete a separate Privacy & Security approval if macOS blocks SwiftBar from executing the plugin;
5. verify the signed Bun payload launches on every OS, exactly one raccoon appears, and the normal-click default footer remains hidden;
6. exercise **Refresh now**, **Mark all as read**, and an X link;
7. update from the current allowlisted `.js` build and verify no duplicate raccoon;
8. restart SwiftBar and verify persistence;
9. uninstall and verify the plugin disappears while state remains.

This quarantine, translocation, SwiftBar-loader, and OS-matrix gate is separate from repository-only completion. If it has not run in full, the release is a verified build candidate, not a confirmed clean-machine distribution.

The gate produces a versioned `docs/releases/0.1.0-validation.md` report containing the exact macOS build, SwiftBar version, Bun executable hash, DMG checksum, quarantine-hop table, Gatekeeper and plugin-alert outcome, App Translocation observation, and pass/fail result for every matrix cell. Missing cells remain explicitly **not run**; the report cannot mark the distribution confirmed until all required cells pass.

## Error handling and user messages

Errors are grouped into stable categories: unsupported Mac, SwiftBar missing or too old, destination invalid, payload corrupt, installation blocked, migration conflict, recovery conflict, refresh unavailable, and uninstall refused. The UI shows a concise recovery action and writes no raw filesystem, command, token, or process detail into the user-facing message.

Detailed build diagnostics are allowed only in developer release logs. The installer itself does not create persistent logs in version 0.1.0.

## Build and live-install boundaries

Repository checks, installer tests, portable-artifact tests, and DMG acceptance tests operate only on fixtures and transaction-owned temporary directories. They do not make a Dayclaw request, open the real SwiftBar application, copy into the real SwiftBar plugin directory, read or write live Tibo Raccoon state, or trigger a live plugin refresh.

Creating the DMG and checksum under an explicit release output directory is part of the approved packaging implementation. The generated DMG, checksum, mounted-image temporaries, compiled payload, and app bundle are release artifacts and are not committed to Git.

Installing the new binary into the current user's real SwiftBar folder, migrating the currently installed `.js` plugin, applying quarantine for a realistic test, or creating a separate macOS user remains a distinct approval-gated action after the DMG build candidate exists. A repository-only green result must not be reported as a live installation or clean-account validation.

## Security and privacy boundaries

- The installer is unprivileged and user-scoped.
- The destination must be explicitly displayed and confirmed.
- Remote content never influences installer paths, commands, metadata, or release manifests.
- The installer does not use a shell or interpolate paths into command strings.
- An open, validated destination directory descriptor—not a mutable path string—anchors child inspection, staging, activation, rollback, and detachment.
- All staging, journals, and backups are exclusive children of one current-user-owned mode-`0700` hidden transaction directory; only the active plugin is a top-level file.
- Committed intent phases precede each rename, and recovery mutates only names and hashes listed by a valid journal.
- Existing unexpected artifacts are never overwritten or removed.
- Quarantine is never cleared programmatically.
- Artifact ownership requires an allowlisted content hash plus metadata; neither metadata alone nor a filename authorizes replacement or removal.
- Ad-hoc signatures, manifests, allowlists, and checksums are described as integrity and collision checks, not publisher authentication.
- The installer makes no network request. Opening the official SwiftBar page or SwiftBar URL scheme occurs only from a user-visible action or successful transaction.
- The installed plugin retains its existing fixed public Dayclaw request and privacy contract.

## Versioning and future signing

Version `0.1.0` is sourced once and propagated to the DMG name, volume name, app version, manifest, binary metadata, Read Me, and checksum filename. Release tests reject drift.

A future signed release may add Developer ID Application signing, hardened runtime review, notarization, and stapling without changing the installer transaction or state contract. That work requires a separate design because it introduces credentials and external Apple service actions.

Intel support, a universal plugin, automatic updates, and a Swift rewrite are also separate future decisions.

## Alternatives considered

### Terminal `.command` installer

This could install the same portable binary with less native UI code, but it opens Terminal, exposes path handling to shell quoting, and provides a poorer unsigned first-run experience. It remains a possible developer fallback, not the release path.

### Native Swift rewrite of the plugin

A Swift rewrite could produce a smaller executable, but it would replace the tested Bun/TypeScript runtime, state transitions, parser, rendering, and safety boundaries. Package size does not justify that regression risk.

### `.swiftbar` package with a wrapper script

A packaged plugin could keep metadata in visible script comments and execute a compiled helper. It adds a wrapper and newer package-loader behavior that the direct binary does not need. The documented binary metadata attribute is the narrower version 0.1.0 contract. A packaged plugin is the fallback only if final DMG copying tests prove the binary metadata attribute unreliable.

### Privileged `.pkg`

A package installer is a poor fit for a per-user, user-selected SwiftBar directory. Root post-install scripts would complicate console-user discovery and create unnecessary privilege and multi-user risks.

### Current Bun script in a DMG

Wrapping `tibo-raccoon.2m.js` would preserve the recipient's Bun requirement and embed a machine-specific interpreter path. It is not a shareable release.

## Sources

- [Bun standalone executable documentation](https://bun.com/docs/bundler/executables)
- [Bun macOS executable signing guidance](https://bun.com/guides/runtime/codesign-macos-executable)
- [SwiftBar plugin-folder contract](https://github.com/swiftbar/SwiftBar/blob/main/README.md#plugin-folder)
- [SwiftBar plugin metadata and binary-plugin guidance](https://github.com/swiftbar/SwiftBar/blob/main/README.md#script-metadata)
- [SwiftBar plugin naming and refresh contract](https://github.com/swiftbar/SwiftBar/blob/main/README.md#plugin-naming)
- [SwiftBar URL scheme](https://github.com/swiftbar/SwiftBar/blob/main/README.md#url-scheme)
- [SwiftBar 2.1.1 release](https://github.com/swiftbar/SwiftBar/releases/tag/v2.1.1)
- [Apple Developer: Updates to runtime protection in macOS Sequoia](https://developer.apple.com/news/?id=saqachfa)
- [Apple Support: Open an app by overriding security settings](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unknown-developer-mh40616/mac)
- [Apple Foundation: Bundle](https://developer.apple.com/documentation/foundation/bundle)
- [Apple: Notarizing macOS software before distribution](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
- [Apple: Packaging Mac software for distribution](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution)
- [Apple: Code signing tasks](https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/Procedures/Procedures.html)
- [Apple: Understanding the code signature](https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/AboutCS/AboutCS.html)
