#!/usr/bin/env bash
# Regenerates every app icon from apps/web/public/icon-source.png, keeping upstream's file names.
set -euo pipefail
cd "$(dirname "$0")/.."
src=apps/web/public/icon-source.png
pub=apps/web/public

# Rounded square with transparent corners, for places that show the icon as-is.
rounded() {
  local size=$1 out=$2 radius=$(( $1 * 22 / 100 ))
  magick "$src" -resize "${size}x${size}" \
    \( -size "${size}x${size}" xc:none -fill white -draw "roundrectangle 0,0 $((size - 1)),$((size - 1)) $radius,$radius" \) \
    -compose DstIn -composite -strip "$out"
}
# Full-bleed square, for platforms that apply their own mask.
square() { magick "$src" -resize "$1x$1" -strip "$2"; }

for size in 192 512 1024; do
  rounded "$size" "$pub/icon-$size.png"
  square "$size" "$pub/icon-maskable-$size.png"
done
square 180 "$pub/apple-touch-icon.png"
rounded 16 "$pub/favicon-16x16.png"
rounded 32 "$pub/favicon-32x32.png"
tmp=$(mktemp -d)
for size in 16 32 48 64; do rounded "$size" "$tmp/$size.png"; done
magick "$tmp/16.png" "$tmp/32.png" "$tmp/48.png" "$tmp/64.png" "$pub/favicon.ico"
rm -r "$tmp"
rounded 64 packages/design-system/src/icons/agents-in-the-cloud-brand.png
