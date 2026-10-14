#!/usr/bin/env bash
# Match the Neovim 0.12 / Tree-sitter requirements of the Nox LazyVim config.
# Ubuntu's packages lag these versions; pin and verify upstream release archives.
set -euo pipefail
nvim_version=0.12.6
tree_sitter_version=0.26.9
case "$(dpkg --print-architecture)" in
  amd64)
    nvim_arch=x86_64
    tree_sitter_arch=x64
    nvim_sha256=474430d53e6264f6d6dd18db42d6dc9df3a1b56ca9e88a325bbf860e1a811d87
    tree_sitter_sha256=9ce82137caa65864e7ca8b869fd391cef88c9bd2a01c4371b9c4dd26c2585efb
    ;;
  arm64)
    nvim_arch=arm64
    tree_sitter_arch=arm64
    nvim_sha256=8f1f64a0bdb97247034038c3823c6cbad5bdf9ecd5751b85494b71c3ee04c815
    tree_sitter_sha256=c8feeb32115958cb44442ca4d68f6d66cf7605dbd65681e62342181ebdd6db3b
    ;;
  *) echo 'Unsupported architecture for the Nox editor toolchain' >&2; exit 1 ;;
esac
staging=$(mktemp -d)
trap 'rm -rf "$staging"' EXIT
curl -fsSL "https://github.com/neovim/neovim/releases/download/v$nvim_version/nvim-linux-$nvim_arch.tar.gz" -o "$staging/nvim.tar.gz"
curl -fsSL "https://github.com/tree-sitter/tree-sitter/releases/download/v$tree_sitter_version/tree-sitter-linux-$tree_sitter_arch.gz" -o "$staging/tree-sitter.gz"
printf '%s  %s\n' "$nvim_sha256" "$staging/nvim.tar.gz" "$tree_sitter_sha256" "$staging/tree-sitter.gz" | sha256sum --check
mkdir -p /opt/agents-in-the-cloud/neovim
tar -xzf "$staging/nvim.tar.gz" -C /opt/agents-in-the-cloud/neovim --strip-components=1
ln -sf /opt/agents-in-the-cloud/neovim/bin/nvim /usr/local/bin/nvim
gzip -dc "$staging/tree-sitter.gz" > /usr/local/bin/tree-sitter
chmod 755 /usr/local/bin/tree-sitter
nvim --version
tree-sitter --version
