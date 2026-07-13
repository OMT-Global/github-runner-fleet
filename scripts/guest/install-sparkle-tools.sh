#!/usr/bin/env bash
set -Eeuo pipefail

SPARKLE_VERSION="2.9.4"
SPARKLE_ARCHIVE="Sparkle-${SPARKLE_VERSION}.tar.xz"
SPARKLE_URL="https://github.com/sparkle-project/Sparkle/releases/download/${SPARKLE_VERSION}/${SPARKLE_ARCHIVE}"
SPARKLE_SHA256="ce89daf967db1e1893ed3ebd67575ed82d3902563e3191ca92aaec9164fbdef9"
SPARKLE_INSTALL_ROOT="${HOME}/.local/share/omt-tools/sparkle"
SPARKLE_INSTALL_DIR="${SPARKLE_INSTALL_ROOT}/${SPARKLE_VERSION}"
SPARKLE_ARCHIVE_PATH="${SPARKLE_ARCHIVE_PATH:-}"

fail() {
  echo "install-sparkle-tools: $*" >&2
  exit 1
}

for command in cp curl shasum tar codesign; do
  command -v "${command}" >/dev/null 2>&1 || fail "${command} is required"
done

work_dir="$(mktemp -d /tmp/omt-sparkle.XXXXXX)"
trap 'rm -rf "${work_dir}"' EXIT
archive_path="${work_dir}/${SPARKLE_ARCHIVE}"
staging_dir="${work_dir}/staging"

if [[ -n "${SPARKLE_ARCHIVE_PATH}" ]]; then
  [[ -f "${SPARKLE_ARCHIVE_PATH}" ]] || fail "archive path does not exist: ${SPARKLE_ARCHIVE_PATH}"
  cp "${SPARKLE_ARCHIVE_PATH}" "${archive_path}"
else
  curl --fail --location --retry 3 --proto '=https' --tlsv1.2 \
    --output "${archive_path}" \
    "${SPARKLE_URL}"
fi

actual_sha256="$(shasum -a 256 "${archive_path}" | awk '{print $1}')"
if [[ "${actual_sha256}" != "${SPARKLE_SHA256}" ]]; then
  fail "checksum mismatch for ${SPARKLE_ARCHIVE}"
fi

mkdir -p "${staging_dir}"
tar -xJf "${archive_path}" -C "${staging_dir}" \
  ./bin/generate_appcast \
  ./bin/generate_keys

for tool in generate_appcast generate_keys; do
  tool_path="${staging_dir}/bin/${tool}"
  [[ -x "${tool_path}" ]] || fail "missing Sparkle tool ${tool}"
  codesign --verify --strict "${tool_path}" >/dev/null
done

rm -rf "${SPARKLE_INSTALL_DIR}"
mkdir -p "${SPARKLE_INSTALL_ROOT}"
mv "${staging_dir}" "${SPARKLE_INSTALL_DIR}"

"${SPARKLE_INSTALL_DIR}/bin/generate_appcast" --help >/dev/null
"${SPARKLE_INSTALL_DIR}/bin/generate_keys" --help >/dev/null

printf 'Installed Sparkle %s tools at %s/bin\n' \
  "${SPARKLE_VERSION}" \
  "${SPARKLE_INSTALL_DIR}"
