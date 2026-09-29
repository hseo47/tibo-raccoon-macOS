#!/bin/sh
set -eu
cd "$(dirname "$0")"
mkdir -p .build .cache/clang
export CLANG_MODULE_CACHE_PATH="$PWD/.cache/clang"
sdk_path=${TIBO_SDK_PATH:-/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk}
if [ ! -d "$sdk_path" ]; then sdk_path=$(xcrun --sdk macosx --show-sdk-path); fi
swiftc -parse-as-library -sdk "$sdk_path" Sources/TiboCore/*.swift Tests/Checks.swift -o .build/tibo-checks
.build/tibo-checks
