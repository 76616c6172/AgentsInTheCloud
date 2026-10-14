#!/usr/bin/env bash
# The shared-home/private-data mounts must not hide the image's editor tools.
# /opt lives in each container's writable layer; state and cache stay private.
export XDG_DATA_HOME=/opt/agents-in-the-cloud/nox-editor/data
export PATH="$HOME/go/bin:/opt/agents-in-the-cloud/nox-editor/go/bin:$PATH"
exec /opt/agents-in-the-cloud/neovim/bin/nvim "$@"
