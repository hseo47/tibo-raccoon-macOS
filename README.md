# Tibo Raccoon 🦝

A little raccoon in your Mac’s menu bar that keeps an eye on [Tibo’s public posts](https://x.com/thsottiaux). When it spots something new, its eyes light up. Click it to read the post or open the original on X.

**[Download Tibo Raccoon for Mac](downloads/Tibo-Raccoon-macOS.zip)** · Free · macOS 13 or newer · Apple Silicon and Intel

<img src="assets/icons/calm-light.png" width="62" alt="Tibo Raccoon menu bar icon">

## Get started

1. Download the ZIP above and open it.
2. Move **Tibo Raccoon.app** to your **Applications** folder, then open it.
3. Look for the raccoon in your menu bar. It has no Dock icon.

Because this app is free and has no Apple Developer ID certificate, macOS may block its first launch. If it does, try opening the app once, then go to **System Settings → Privacy & Security → Open Anyway**. [Apple explains this one-app approval here](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unidentified-developer-mh40616/mac).

## Meet the raccoon

| All caught up | New posts | Feed unavailable |
| :---: | :---: | :---: |
| <img src="assets/icons/calm-light.png" width="62" alt="Calm raccoon"> | <img src="assets/icons/unread-light.png" width="62" alt="Raccoon with fire eyes"> | <img src="assets/icons/offline-light.png" width="62" alt="Sleepy raccoon"> |
| Nothing unread. | Something new to read. | Recent posts are still available from the cache. |

The app checks roughly every two minutes. You can also choose **Refresh now**, **Mark all as read**, **Open Tibo’s profile**, or **Quit** from its panel. Opening a post does not mark it as read. Your first successful refresh starts with existing posts already read; posts found later become unread.

## A couple of things to know

Tibo Raccoon uses the free, independent [FxTwitter](https://github.com/FxEmbed/FxEmbed) feed. It needs an internet connection to find new posts, and that service can sometimes be late or unavailable. When that happens, the raccoon keeps the posts it already saw. This is an unofficial app, not an OpenAI announcement channel.

There is no X sign-in, OpenAI sign-in, analytics, or subscription. The app stores public post history and read status on your Mac. If you used the older SwiftBar version, the native app imports its saved history on first launch. You can remove the old plugin after checking that the native app works; the [SwiftBar guide](docs/swiftbar-legacy.md#uninstall) has the removal command.

The app was built and opened on an Apple Silicon Mac running macOS 26.5.1. The ZIP contains both Apple Silicon and Intel code and targets macOS 13 or newer; Intel and older macOS versions have not been tested on a physical Mac.

## For contributors

The app is written in Swift and SwiftUI. With the macOS Swift command-line tools installed:

```sh
cd Native
./test.sh
./build-app.sh
```

The finished app and ZIP appear in `Native/dist/`. The build uses an ad hoc signature; no paid Apple developer account is required. The editable raccoon SVGs are in [`previews/v2-raccoon/`](previews/v2-raccoon/). The previous [SwiftBar source and instructions](docs/swiftbar-legacy.md) remain available.

Released under the [MIT License](LICENSE).
