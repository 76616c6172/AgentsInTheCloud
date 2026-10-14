#!/usr/bin/env bash
# Build only from the checked-in configuration and public plugin lockfile.
set -Eeuo pipefail
root=/opt/agents-in-the-cloud/nox-editor
staging=$(mktemp -d)
trap 'rm -rf "$staging"' EXIT
export HOME="$staging/home"
export XDG_CONFIG_HOME="$staging/config"
export XDG_DATA_HOME="$root/data"
export XDG_STATE_HOME="$staging/state"
export XDG_CACHE_HOME="$staging/cache"
export GOPATH="$root/go"
export PATH="$GOPATH/bin:$PATH"
mkdir -p "$HOME" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME/nvim/lazy"
cp -a "$root/config" "$XDG_CONFIG_HOME/nvim"

python3 - "$root" "$XDG_DATA_HOME/nvim/lazy" <<'PY'
import concurrent.futures
import json
import pathlib
import subprocess
import sys
root, destination = map(pathlib.Path, sys.argv[1:])
urls = json.loads((root / "plugins.json").read_text())
lock = json.loads((root / "config/lazy-lock.json").read_text())
def clone(item):
    name, url = item
    target = destination / name
    subprocess.run(["git", "clone", "--quiet", "--filter=blob:none", "--no-checkout", url, str(target)], check=True)
    subprocess.run(["git", "-C", str(target), "checkout", "--quiet", lock[name]["commit"]], check=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
    list(pool.map(clone, urls.items()))
PY

# Telescope loads its native extension during configuration, before Lazy can
# run build hooks. Compile that dependency before loading the full config.
make -C "$XDG_DATA_HOME/nvim/lazy/telescope-fzf-native.nvim"
nvim --headless '+lua dofile("/opt/agents-in-the-cloud/nox-editor/build.lua")'
# No build homes, command histories, logs, or compiler/download caches in the image.
rm -rf "$GOPATH/pkg" "$XDG_DATA_HOME/nvim/mason/staging"
# The app runs as 1000:1000 and remaps workspace users to those IDs. The base
# image's build-time account can have different IDs; /opt is outside its home.
chown -R 1000:1000 "$root/data" "$root/go"
