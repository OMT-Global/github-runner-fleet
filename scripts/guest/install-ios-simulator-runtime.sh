#!/usr/bin/env bash
set -Eeuo pipefail

ios_runtime_download_timeout_seconds="${IOS_SIMULATOR_DOWNLOAD_TIMEOUT_SECONDS:-3600}"
if [[ ! "${ios_runtime_download_timeout_seconds}" =~ ^[1-9][0-9]*$ ]]; then
  echo "IOS_SIMULATOR_DOWNLOAD_TIMEOUT_SECONDS must be a positive integer." >&2
  exit 2
fi

has_available_ios_runtime() {
  xcrun simctl list runtimes available -j \
    | python3 -c '
import json
import sys

runtimes = json.load(sys.stdin).get("runtimes", [])
available = any(
    runtime.get("isAvailable") and runtime.get("name", "").startswith("iOS")
    for runtime in runtimes
)
sys.exit(0 if available else 1)
'
}

if has_available_ios_runtime; then
  echo "An available iOS Simulator runtime is already installed."
else
  echo "Installing the Xcode iOS Simulator platform in the base image."
  if ! perl -e 'alarm shift; exec @ARGV' \
    "${ios_runtime_download_timeout_seconds}" xcodebuild -downloadPlatform iOS; then
    echo "Xcode iOS Simulator platform installation failed or exceeded ${ios_runtime_download_timeout_seconds} seconds." >&2
    exit 1
  fi
fi

if ! has_available_ios_runtime; then
  echo "No available iOS Simulator runtime exists after Xcode platform provisioning." >&2
  exit 1
fi

xcodebuild -version
xcrun simctl list runtimes available
