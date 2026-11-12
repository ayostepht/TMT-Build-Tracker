#!/bin/sh
# Docker build helper: puts the kit packs listed in an index.json into an output directory,
# each verified against the sha256 (and size) in the index. Order of sources per pack:
#   1. the pack already in the build context's kitpacks/ directory (local builds)
#   2. $GH_TOKEN_FILE (a build secret): the GitHub API asset endpoint of the release
#      (only needed for a private fork)
#   3. the plain URL: $KITPACK_URL (placeholders {slug} {version} {file}, or a base URL),
#      default https://github.com/$KITPACK_REPO/releases/download/kitpack-<slug>-<version>/<file>
# A pack that cannot be fetched fails the build unless KITPACK_OPTIONAL=1 (the app then
# downloads it at first start, if it can).
#
#   fetch-kitpacks.sh <index.json> <local dir> <out dir>
set -eu
INDEX=$1
LOCAL=$2
OUT=$3
REPO=${KITPACK_REPO:-ayostepht/TMT-Build-Tracker}
OPTIONAL=${KITPACK_OPTIONAL:-0}
TOKEN=
if [ -n "${GH_TOKEN_FILE:-}" ] && [ -s "$GH_TOKEN_FILE" ]; then TOKEN=$(cat "$GH_TOKEN_FILE"); fi

mkdir -p "$OUT"
cp "$INDEX" "$OUT/index.json"
LIST=$(mktemp)
node -e '
const i = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
for (const p of i.packs) console.log([p.slug, p.version, p.file, p.sha256, p.size].join(" "));
' "$INDEX" > "$LIST"

fail() {
	if [ "$OPTIONAL" = 1 ]; then echo "warning: $1 (KITPACK_OPTIONAL=1, continuing)" >&2; return 0; fi
	echo "error: $1" >&2
	exit 1
}

while read -r SLUG VERSION FILE SHA SIZE; do
	DEST="$OUT/$FILE"
	TAG="kitpack-$SLUG-$VERSION"
	rm -f "$DEST"
	if [ -f "$LOCAL/$FILE" ]; then
		echo "kit pack $FILE: using the copy in the build context"
		cp "$LOCAL/$FILE" "$DEST"
	elif [ -n "$TOKEN" ] && [ -z "${KITPACK_URL:-}" ]; then
		echo "kit pack $FILE: downloading release $TAG through the GitHub API"
		API="https://api.github.com/repos/$REPO"
		ASSET=$(curl -fsSL -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" \
			"$API/releases/tags/$TAG" | node -e '
const r = JSON.parse(require("fs").readFileSync(0, "utf8"));
const a = (r.assets || []).find((x) => x.name === process.argv[1]);
if (a) console.log(a.id);
' "$FILE") || ASSET=
		if [ -z "$ASSET" ]; then fail "release $TAG has no asset $FILE (or the token cannot read it)"; continue; fi
		curl -fSL -H "Authorization: Bearer $TOKEN" -H "Accept: application/octet-stream" \
			-o "$DEST" "$API/releases/assets/$ASSET" || { rm -f "$DEST"; fail "download of $FILE failed"; continue; }
	else
		PATTERN=${KITPACK_URL:-https://github.com/$REPO/releases/download/kitpack-{slug}-{version}/{file}}
		case $PATTERN in
			*"{"*) URL=$(printf '%s' "$PATTERN" | sed "s|{slug}|$SLUG|g; s|{version}|$VERSION|g; s|{file}|$FILE|g") ;;
			*) URL="${PATTERN%/}/$FILE" ;;
		esac
		echo "kit pack $FILE: downloading $URL"
		curl -fSL -o "$DEST" "$URL" || { rm -f "$DEST"; fail "download of $FILE failed"; continue; }
	fi
	GOT=$(sha256sum "$DEST" | cut -d' ' -f1)
	SZ=$(wc -c < "$DEST" | tr -d ' ')
	if [ "$GOT" != "$SHA" ] || [ "$SZ" != "$SIZE" ]; then
		rm -f "$DEST"
		fail "$FILE does not match kitpacks/index.json (sha256 $GOT, $SZ bytes)"
		continue
	fi
	echo "kit pack $FILE: ok ($SZ bytes)"
done < "$LIST"
rm -f "$LIST"
