#!/usr/bin/env bash
#
# Checks that every version the catalog offers can actually be installed.
#
# ArtifactHub reads this repository and hands what it finds to Headlamp's
# in-app catalog, so every manifest under releases/ is an install offered to
# users. One pointing at an artifact that is missing, or whose checksum does not
# match it, is a broken install - and nothing else notices, because the plugin
# itself builds and tests just fine.
#
# The whole history is checked, not just the newest: a release asset deleted
# years later breaks an entry that nobody has touched since.
#
# Run it by hand before pushing a catalog change; CI runs it on main, and the
# release workflow runs it again on its own freshly written entry.

set -uo pipefail

cd "$(dirname "$0")/.."

status=0

# Inside Actions these become annotations against the offending file; run from a
# terminal they are just readable lines.
fail() {
  local file=$1 message=$2
  if [ -n "${GITHUB_ACTIONS:-}" ]; then
    echo "::error file=$file::$message"
  else
    echo "$file: $message" >&2
  fi
  status=1
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

artifact=$(mktemp)
trap 'rm -f "$artifact"' EXIT

for manifest in releases/*/artifacthub-pkg.yml; do
  folder=$(basename "$(dirname "$manifest")")
  version=$(grep -m1 '^version:' "$manifest" | awk '{print $2}')
  url=$(grep -m1 'archive-url:' "$manifest" | sed 's/.*"\(.*\)"/\1/')
  declared=$(grep -m1 'archive-checksum:' "$manifest" | sed 's/.*"SHA256:\(.*\)"/\1/')

  if [ "$folder" != "$version" ]; then
    fail "$manifest" "Folder says $folder, manifest says $version"
    continue
  fi

  expected="persistent-port-forwards-$version.tar.gz"
  case "$url" in
    *"$expected") ;;
    *)
      fail "$manifest" "archive-url does not point at $expected"
      continue
      ;;
  esac

  # Retried, because the release workflow checks its own entry seconds after
  # publishing it: a release asset is not always served the instant it exists,
  # and a red release run for that would cry wolf about a release that is fine.
  downloaded=""
  for attempt in 1 2 3; do
    if curl -fsSL "$url" -o "$artifact"; then
      downloaded=yes
      break
    fi
    [ "$attempt" -lt 3 ] && sleep 5
  done

  if [ -z "$downloaded" ]; then
    fail "$manifest" "archive-url does not resolve. Version $version is offered by the catalog but cannot be downloaded."
    continue
  fi

  actual=$(sha256_of "$artifact")
  if [ "$actual" != "$declared" ]; then
    fail "$manifest" "Checksum mismatch. Declared $declared, downloaded $actual - Headlamp refuses an install on this."
    continue
  fi

  echo "$version ok"
done

# A stray artifacthub-pkg.yml outside releases/ would register a second copy of
# whatever version it names.
if [ -e artifacthub-pkg.yml ]; then
  fail "artifacthub-pkg.yml" "artifacthub-pkg.yml in the repository root is indexed as its own package version. Edit artifacthub-pkg.template.yml instead."
fi

exit $status
