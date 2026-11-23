#!/bin/sh
# Renders the PNG icons from the two SVG sources. Needs rsvg-convert (brew install librsvg).
set -e
cd "$(dirname "$0")"
rsvg-convert -w 16 icon-small.svg -o icon16.png
rsvg-convert -w 32 icon-small.svg -o icon32.png
rsvg-convert -w 48 icon.svg -o icon48.png
rsvg-convert -w 128 icon.svg -o icon128.png
rsvg-convert -w 1024 icon.svg -o icon-source.png
