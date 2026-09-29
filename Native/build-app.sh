#!/bin/sh
set -eu
cd "$(dirname "$0")"

sdk_path=${TIBO_SDK_PATH:-/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk}
if [ ! -d "$sdk_path" ]; then sdk_path=$(xcrun --sdk macosx --show-sdk-path); fi
mkdir -p .cache/clang .cache/swiftpm .cache/config .cache/security dist
export CLANG_MODULE_CACHE_PATH="$PWD/.cache/clang"

build_arch() {
    swift build --disable-sandbox --sdk "$sdk_path" --triple "$1-apple-macosx13.0" \
        -c release --cache-path .cache/swiftpm --config-path .cache/config \
        --security-path .cache/security --manifest-cache local
}

build_arch arm64
archive=dist/Tibo-Raccoon-macOS.zip
binary=.build/arm64-apple-macosx/release/TiboApp
if build_arch x86_64; then
    lipo -create .build/arm64-apple-macosx/release/TiboApp \
        .build/x86_64-apple-macosx/release/TiboApp -output dist/TiboApp-universal
    binary=dist/TiboApp-universal
else
    archive=dist/Tibo-Raccoon-macOS-arm64.zip
    echo "Intel build failed; packaging Apple Silicon only" >&2
fi

app='dist/Tibo Raccoon.app'
rm -rf "$app" "$archive"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$binary" "$app/Contents/MacOS/TiboApp"
cp Info.plist "$app/Contents/Info.plist"
cp Resources/TiboRaccoon.icns "$app/Contents/Resources/"
cp ../assets/icons/*.png "$app/Contents/Resources/"
chmod 755 "$app/Contents/MacOS/TiboApp"
codesign --force --sign - "$app"
ditto -c -k --sequesterRsrc --keepParent "$app" "$archive"
echo "App: $PWD/$app"
echo "ZIP: $PWD/$archive"
