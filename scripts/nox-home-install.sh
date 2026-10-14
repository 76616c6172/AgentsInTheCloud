#!/usr/bin/env bash
# Internal installer, run inside System by nox-home.sh. Paths stay relative so
# the shared home also works when mounted at /home/agents-in-the-cloud.
set -Eeuo pipefail
[[ $# == 2 ]] || { echo 'Usage: nox-home-install.sh HOME ARCHIVE' >&2; exit 1; }
home=$(realpath "$1")
archive=$(realpath "$2")
test -d "$home"
umask 077
owner=$(stat -c '%u:%g' "$home")
state="$home/.nox-home"
mkdir -p "$state/releases" "$state/backups"
exec 9>"$state/deploy.lock"
flock -n 9 || { echo 'Another home deployment is running' >&2; exit 1; }
stamp=$(date -u +%Y%m%dT%H%M%S)-$$
release="$state/releases/$stamp"
backup="$state/backups/$stamp"
mkdir "$release" "$backup"
tar -xzf "$archive" -C "$release"
paths=(.config/nvim .config/powerlevel10k .config/fzf-tab .config/nox-shell-colors.zsh .p10k.zsh .zoxide_fzf_dir .zshrc .tmux.conf)
for path in "${paths[@]}"; do test -e "$release/$path"; done
if [[ -L "$state/current" ]]; then readlink "$state/current" > "$backup/previous-release"; fi
# Leave existing managed links in place; one atomic pointer switches updates.
for path in "${paths[@]}"; do
  target=".nox-home/current/$path"
  if [[ "$path" == .config/* ]]; then target="../$target"; fi
  if [[ -L "$home/$path" && $(readlink "$home/$path") == "$target" ]]; then continue; fi
  mkdir -p "$home/$(dirname "$path")" "$backup/$(dirname "$path")"
  if [[ -e "$home/$path" || -L "$home/$path" ]]; then mv "$home/$path" "$backup/$path"; fi
  ln -s "$target" "$home/$path"
  chown -h "$owner" "$home/$path"
done
chown "$owner" "$home/.config"
chown -R "$owner" "$state"
ln -s "releases/$stamp" "$state/next"
mv -Tf "$state/next" "$state/current"
printf 'Shared configuration installed. Backup: %s\nStart a new zsh or Neovim session to use it.\n' "$backup"
