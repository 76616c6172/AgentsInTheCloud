<p align="center">
  <a href="https://agentsinthecloud.com/">
    <img src="docs/readme/hero.jpg" alt="AgentsInTheCloud: a robed person and a chrome robot look out over a sea of clouds toward a vast arch, where a beam of light falls on a domed city." width="600">
  </a>
</p>

- Run cloud coding agents on your own server
- Use any model provider you want
- Workflows optimized for evaluating agent work
- Free, [MIT licensed](LICENSE)

<p align="center">
  <a href="https://agentsinthecloud.com/">Website</a> · <a href="#installation">Install AgentsInTheCloud</a> · <a href="#contributing">Contributing</a>
</p>

> **AgentsInTheCloud (nox fork):** the `nox` branch adds custom navigation, Nox Oscura, workspace tools, and bundled Pi extensions. The installation command below selects this fork's images, not upstream images. See [nox fork releases and upgrades](#nox-fork-releases-and-upgrades) for the reviewed release workflow.

## Installation

1. **Connect to your server.** SSH into an x86-64 Linux server dedicated to AgentsInTheCloud. This fork's releases currently support `linux/amd64` only.
2. **Install AgentsInTheCloud (nox fork).** For a fresh installation, run:

   ```sh
   curl -fsSL https://agentsinthecloud.com/install.sh | bash -s -- \
     --app-image ghcr.io/76616c6172/agents-in-the-cloud:latest \
     --system-image ghcr.io/76616c6172/agents-in-the-cloud-system:latest
   ```

Both of this fork's update channels, `latest` and `stable`, move only after promotion. This command installs the published images; cloning the repository does not install unreleased changes. For an existing installation, follow [Deploy and roll back](#deploy-and-roll-back).

## Contributing

I'm still figuring out how to accept contributions.

I would love to hear how the product could be made better for your use case. In your human voice, not your AI's. Your description can include some AI-generated extra detail, sure, but the main thing you're trying to tell me should be *you* trying to tell *me*.

For now, please don't send pull requests. Telling me exactly how the product could be better for you is very welcome, though. Think of it as a PR in the form of a prompt.

We're all just figuring out this new world in real time :-). Hope you like the product, I had a lot of fun building it.

## nox fork releases and upgrades

`main` tracks upstream without personal changes; `nox` carries the fork's UI, workspace defaults, and release integration. Keep these histories separate, and merge upstream rather than rebasing published releases. The shared distribution identity lives in `packages/shared/src/distribution.ts`.

### Bundled workspace defaults

This fork's workspace image includes Neovim with pinned plugins, Bash comforts, and tools such as `fzf`, `eza`, `zoxide`, `lazygit`, and `btop`. Fresh installations also get the [Nox Oscura Pi theme](packages/nox-workspace/home-defaults/.pi/agent/themes/nox-oscura.json), `nvim` as Pi's external editor, and these extensions:

| Extension | Purpose |
| --- | --- |
| `pi-tool-display` | Custom tool-call formatting and `/tool-display` preferences. |
| `exhash-tools` | Hash-verified reading, editing, and code navigation with `exhash_read`, `exhash_edit`, and `exhash_open`. |
| `follow-on-type` | Resumes transcript auto-scrolling when you edit your prompt. |
| `notify` | Completion notifications in supported terminals. |
| `window-title-status` | Working status and elapsed time in the terminal title. |

The [extension bundle](packages/nox-workspace/home-defaults/.pi/agent/nox-extensions/bundled/) is vendored from `76616c6172/dotvulpix` at commit `39ebd45d88f50acbb8c740ad63a10fc777071bed`, with source checksums and licenses included. Building or installing AgentsInTheCloud (nox fork) does not require access to that private repository or a separate `pi-cloud` deployment.

[Pi defaults](packages/nox-workspace/home-defaults/.pi/agent/settings.json) load the local bundle, and [tool-display defaults](packages/nox-workspace/home-defaults/.pi/agent/extensions/pi-tool-display/config.json) supply its preferences. The image seeds the persistent shared home only on a fresh installation. Updates do not overwrite an existing home's settings, themes, or separately installed extensions, or add this bundle to it automatically. These defaults are available in published images once a release containing them is promoted.

Credentials, session history, and personal instructions are not bundled. Connect your own model provider after installation.

### Bring in upstream improvements

Start on a clean `nox` checkout with an `upstream` remote pointing to `https://github.com/lucasmeijer/AgentsInTheCloud.git`:

```sh
bun scripts/nox-upstream.ts            # merge and check locally
bun scripts/nox-upstream.ts --publish  # recheck, then push main+nox atomically
```

The helper fetches both remotes, refuses diverged `main` or an outdated `nox`, fast-forwards `main`, merges into `nox`, installs locked dependencies, and runs checks and focused tests. It never stashes, force-pushes, promotes, or deploys. Conflicts remain for you to resolve and commit (or `git merge --abort`); rerun after resolution. Fix and commit any check failures before rerunning. Publishing both branches keeps the release manifest's upstream base accurate.

### Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| **Ctrl+P**, **Ctrl+K**, **Ctrl+O** | Open the command palette. |
| **Ctrl+N** | Create a workspace. |
| **Ctrl+T** | Open the first Terminal view, or create one if none exists. |
| **Ctrl+B** / **Ctrl+E** / **Ctrl+X** | Open Browser / Files / Changes. |
| **Ctrl+1** / **Ctrl+2** / **Ctrl+3** / **Ctrl+4** | Open Changes / Browser / Terminal / Files. |
| **Ctrl+F** | Toggle Work pane focus. |
| **Ctrl+Tab** / **Ctrl+Shift+Tab** | Select the next / previous Agent. |
| **Ctrl+,** / **Ctrl+.** | Select the previous / next workspace. |
| **Ctrl+[** | Select the previous Work view. |
| **Ctrl+/** | Select the oldest workspace needing attention. |

App shortcuts apply when the browser delivers key events to the app; browser-reserved shortcuts may not reach it. Embedded websites and editors retain control while their iframe has focus. Copy/paste and word-deletion shortcuts remain untouched. Other actions are available from the command palette.

### Build and promote

A push to `nox` runs the **Nox release** workflow: checks, focused tests (including bundle integrity and Exhash operation), and production builds for `linux/amd64`. It publishes a **candidate** GitHub release named `nox-<12-character-commit>` with a `release.json` asset pinning app, installer/runtime, and workspace images by digest. It does not change either update channel or the server. On a new fork, GHCR packages must be public for anonymous installation/update access.

Review the candidate in an isolated installation, including relevant acceptance scripts and a manual visual check. Then promote **that same current `nox` revision**, without rebuilding:

```sh
gh workflow run nox-release.yml --repo 76616c6172/AgentsInTheCloud --ref nox -f operation=promote
```

Promotion points both `latest` and `stable` at the reviewed images. Do not use upstream's `bun run release` or the upstream installer's update action for this fork.

### Deploy and roll back

Download the approved release's `release.json` from https://github.com/76616c6172/AgentsInTheCloud/releases. From this repository, with local Bun and SSH access to the existing installation:

```sh
bash scripts/nox-deploy.sh root@server /absolute/path/to/release.json --yes
```

This interrupts running workspaces. Run it when agents are idle. It pulls pinned images, retains the previous app images, stops System for a consistent full-volume backup, replaces System, and selects the app through the supervisor's existing update operation. It preserves the installation volume and Tailscale identity.

The command prints a private backup directory under `/var/backups/agents-in-the-cloud/` containing the data archive, checksum, previous image IDs, deployment status, and a runnable `rollback.sh`. Run that rollback script as root on the server to restore the previous images while retaining current data. If an upstream release changes persisted data incompatibly, image rollback alone is insufficient: stop System and restore the matching data backup as well. Backups and retained image containers are intentionally not automatically deleted; monitor disk space and keep backups off-host too.

The in-app **Update** button follows this fork's approved channel, but updates only the app. Use the deployment command for full app/runtime upgrades. The installation command above reuses the bootstrap installer with explicit image references for this fork; its `--app-image` option does not replace an existing installation's saved app selection.
