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

> **Nox fork:** this repository includes Nox Oscura and a separate, reviewed release channel. For this deployment, follow [Nox releases and upgrades](#nox-releases-and-upgrades) below; the installer in the upstream instructions installs upstream images.

## Installation

1. **Connect to your server.** SSH into a Linux server that will only be used for AgentsInTheCloud.
2. **Install AgentsInTheCloud.** Run:

   ```sh
   curl -fsSL https://agentsinthecloud.com/install.sh | bash
   ```

## Contributing

I'm still figuring out how to accept contributions.

I would love to hear how the product could be made better for your use case. In your human voice, not your AI's. Your description can include some AI-generated extra detail, sure, but the main thing you're trying to tell me should be *you* trying to tell *me*.

For now, please don't send pull requests. Telling me exactly how the product could be better for you is very welcome, though. Think of it as a PR in the form of a prompt.

We're all just figuring out this new world in real time :-). Hope you like the product, I had a lot of fun building it.

## Nox releases and upgrades

`main` tracks upstream without personal changes; `nox` carries our theme and release integration. Keep these histories separate, and merge upstream rather than rebasing published releases. The shared distribution identity lives in `packages/shared/src/distribution.ts`. Personal Pi instructions, extensions, and credentials stay in persistent storage, outside release images.

### Bring in upstream improvements

Start on a clean `nox` checkout with an `upstream` remote pointing to `https://github.com/lucasmeijer/AgentsInTheCloud.git`:

```sh
bun scripts/nox-upstream.ts            # merge and check locally
bun scripts/nox-upstream.ts --publish  # recheck, then push main+nox atomically
```

The helper fetches both remotes, refuses diverged `main` or an outdated `nox`, fast-forwards `main`, merges into `nox`, installs locked dependencies, and runs checks and focused tests. It never stashes, force-pushes, promotes, or deploys. Conflicts remain for you to resolve and commit (or `git merge --abort`); rerun after resolution. Fix and commit any check failures before rerunning. Publishing both branches keeps the release manifest's upstream base accurate.

The fork uses **Ctrl+K** for the command palette, **Ctrl+N** to create a new workspace, **Ctrl+T** to create a terminal, **Ctrl+Tab** for the next Work view, **Ctrl+F** for Files, **Ctrl+B** for Browser, **Ctrl+O** for the composer, **Ctrl+P** for terminal/transcript. **Ctrl+, / Ctrl+.** select previous/next workspaces, **Ctrl+[** selects the previous Work view, and **Ctrl+/** selects the oldest workspace needing attention. App shortcuts take precedence when the browser delivers key events to the app; embedded websites and editors retain control while their iframe has focus. Copy/paste and word-deletion shortcuts remain untouched. The remaining actions are available from the command palette. Personal Pi extensions are maintained separately using `pi-cloud` in the `dotvulpix` repository, without rebuilding these images.

A push to `nox` runs the **Nox release** workflow: checks, focused tests, and production builds for this server's `linux/amd64` platform. It publishes a **candidate** GitHub release named `nox-<12-character-commit>` with a `release.json` asset pinning app, System, and workspace images by digest. It does not change either update channel or the server. On a new fork, GHCR packages must be public for anonymous installation/update access.

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

The in-app **Update** button now follows our approved channel, but updates only the app. Use the deployment command for full app/System upgrades. The installer and first-install defaults remain upstream tooling; the Nox deployment command deliberately avoids their upstream channel update.
