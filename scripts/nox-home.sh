#!/usr/bin/env bash
# Import portable dotfiles into the installation's persistent shared home.
set -Eeuo pipefail
usage() {
  printf 'Usage:\n  bash scripts/nox-home.sh snapshot DOTVULPIX OUTPUT.tar.gz\n  bash scripts/nox-home.sh deploy SSH_HOST DOTVULPIX --yes\n\nCopies image-matched Neovim settings, Bash comforts, tmux, and optional zsh settings.\nExcludes secrets, histories, plugin installs, caches and laptop startup commands.\nDeployment backs up only the managed configuration paths; running shells are unchanged.\nThe Nox workspace image supplies the programs. Existing containers need those packages too.\n'
}
operation=${1:-help}
case "$operation" in
  snapshot) [[ $# == 3 ]] || { usage; exit 1; }; source_root=$(realpath "$2"); output=$(realpath -m "$3") ;;
  deploy)
    [[ $# == 4 && $4 == --yes ]] || { usage; exit 1; }
    host=$2
    [[ "$host" =~ ^[a-zA-Z0-9_.@:-]+$ && "$host" != -* ]] || { echo 'Invalid SSH destination' >&2; exit 1; }
    source_root=$(realpath "$3")
    ;;
  help|--help|-h) usage; exit 0 ;;
  *) usage; exit 1 ;;
esac
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
home="$stage/home"
mkdir -p "$home/.config"
workspace_module="$(dirname "${BASH_SOURCE[0]}")/../packages/nox-workspace"
defaults="$workspace_module/home-defaults"
cp -R "$defaults/.config/nox-shell" "$home/.config/nox-shell"
cp "$defaults/.bashrc" "$home/.bashrc"
# The shared config must match the plugins baked into this release. Refresh the
# checked-in nvim snapshot, lockfile and nvim-plugins.json together when updating.
cp -R "$workspace_module/nvim" "$home/.config/nvim"
# Dereference selected shell links, but never copy compiled laptop artifacts.
rsync -aL --exclude=.git --exclude='*.zwc' \
  "$source_root/dotfiles/zsh/powerlevel10k/" "$home/.config/powerlevel10k/"
rsync -aL --exclude=.git --exclude='*.zwc' --exclude='*.so' --exclude='*.o' \
  "$source_root/dotfiles/zsh/fzf-tab/" "$home/.config/fzf-tab/"
cp "$source_root/dotfiles/zsh/powerlevel10k/p10k.zsh" "$home/.p10k.zsh"
cp "$source_root/dotfiles/zsh/fzf-zoxide/.zoxide_fzf_dir" "$home/.zoxide_fzf_dir"
cp "$source_root/dotfiles/zsh/cloud.zsh" "$home/.zshrc"
cp "$source_root/dotfiles/tmux/.tmux.conf" "$home/.tmux.conf"
chmod 755 "$home/.zoxide_fzf_dir"
# Reuse the laptop's actual palettes, without sourcing its startup or secrets.
grep -E '^(color_opts|export (FZF_DEFAULT_OPTS|FZF_CTRL_R_OPTS|LS_COLORS|EZA_COLORS))=' \
  "$source_root/dotfiles/zsh/.zshrc" > "$home/.config/nox-shell-colors.zsh"
[[ $(wc -l < "$home/.config/nox-shell-colors.zsh") == 5 ]] || { echo 'Expected the five shell palette assignments; review the source zshrc.' >&2; exit 1; }
test -s "$home/.config/nvim/lua/plugins/theme.lua"
archive="$stage/home.tar.gz"
tar -czf "$archive" -C "$home" .
if [[ "$operation" == snapshot ]]; then
  cp "$archive" "$output"
  printf 'Configuration snapshot: %s\n' "$output"
  exit 0
fi
remote=$(ssh -o BatchMode=yes "$host" mktemp -d /tmp/nox-home.XXXXXXXX)
# Keep deployment paths shell-safe independently of the SSH destination.
[[ "$remote" =~ ^/tmp/nox-home\.[a-zA-Z0-9]+$ ]] || { echo 'Unexpected remote staging path' >&2; exit 1; }
scp -q "$archive" "$host:$remote/home.tar.gz"
scp -q "$(dirname "${BASH_SOURCE[0]}")/nox-home-install.sh" "$host:$remote/nox-home-install.sh"
ssh -o BatchMode=yes "$host" bash -s -- "$remote" <<'REMOTE'
set -Eeuo pipefail
upload=$1
name=agents-in-the-cloud-system
docker cp "$upload/home.tar.gz" "$name:$upload.tar.gz"
docker exec -i "$name" bash -s -- /data/app/home "$upload.tar.gz" < "$upload/nox-home-install.sh"
docker exec "$name" rm "$upload.tar.gz"
rm -rf "$upload"
REMOTE
