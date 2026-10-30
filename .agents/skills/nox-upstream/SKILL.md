---
name: nox-upstream
description: Review and merge lucasmeijer/AgentsInTheCloud main into the Nox fork while preserving approved Nox UI, interaction and agent workflows. Use for syncing upstream, reviewing incoming upstream changes, or resolving upstream merge conflicts on nox.
---

# Merge upstream into Nox

The goal is a long-lived, easy-to-update fork: take upstream fixes and infrastructure improvements without silently replacing the user's carefully chosen interaction design. Read `/work/AGENTS.md`, `docs/ui-testing-policy.md`, and `docs/automation.md` first. Paths below are relative to the repository root.

## 1. Establish the exact revisions

- Check branch, remotes and working-tree status. Never discard, stash or commit someone else's changes automatically.
- Use `https://github.com/lucasmeijer/AgentsInTheCloud.git` as upstream; `origin` is the Nox fork. Fetch upstream `main` and fork branches. Do not reset `nox` or rebase its published history.
- Record the starting Nox SHA, target upstream SHA, merge base and incoming commit list. Pin the reviewed SHA; if upstream moves, review the new commits before including them.
- Read fork commits since the merge base and previous merge commit messages to identify intentional differences. Do not assume a conflict-free merge preserves behavior.
- Preview conflicts with `git merge-tree --write-tree HEAD <target-sha>`; this does not change the working tree. Its nonzero exit status can mean conflicts, not a failed fetch.

## 2. Get approval before merging

Group incoming changes into fixes/performance, dependencies/runtime, and visible UI/workflow changes. Explain the user-facing effect, not just commit titles. Explicitly cover transcript presentation, composer/keyboard behavior, navigation, dialogs, workspace lifecycle and agent workflows.

Propose an inclusion/exclusion list and get explicit approval for visible changes. Approval to sync is not approval for new UX. Existing approval only covers the specified changes and revision range. Keep unapproved behavior unchanged. Do not repeatedly ask about already approved decisions in the same task.

Inspect Nox-specific CSS/controllers, keyboard bindings, terminal patches, workspace images and release/update identity. Current examples include ring navigation, phone chrome, ghost composer controls, spread/foldable layouts, grouping, immersive mode, Browser tab controls and terminal sizing/reconnect/paint behavior. This is a discovery checklist, not a frozen specification: follow the actual branch and latest user decisions.

## 3. Integrate with the smallest maintainable delta

- Prefer a real merge commit so Git records upstream ancestry. Do not cherry-pick a whole release or copy upstream files wholesale to avoid understanding conflicts.
- Use `git merge --no-commit --no-ff <reviewed-sha>` when adaptations or exclusions are needed. Resolve semantically, preserving upstream improvements and Nox's deliberate differences.
- Never use blanket `-X ours`, `checkout --ours`, or `checkout --theirs` across the merge. Restoring a specific file is appropriate only when deliberately excluding that entire upstream change, after checking its dependencies.
- Keep upstream module structure and interfaces where possible. Localize Nox presentation differences in existing fork-owned styles/controllers or narrow seams, not parallel implementations, compatibility wrappers, feature flags or configuration layers.
- For excluded multi-file behavior changes, trace callers, data projections, rendering and tests together. Keep unrelated upstream fixes in those files.
- When dependencies change, carry forward still-needed Nox patches against the new version; inspect upstream implementation to remove patches actually fixed there. Do not lose local terminal fixes during a patch filename/version conflict.
- Preserve Nox's bundled tools, extensions, release identity and update behavior. Runtime/image changes must follow the app/installer version contract in AGENTS.md; merging is not publishing or deploying.
- `scripts/nox-upstream.ts` is an existing convenience helper, not a review gate. It automatically merges and may commit, so do not run it before approval or use it to bypass a deliberate no-commit integration. Its `--publish` pushes branches and triggers builds: use only with explicit publication approval. Do not force-push or release as part of an ordinary merge.

## 4. Verify, then commit

- Install locked dependencies with `bun install --frozen-lockfile`; regenerate the lock only for intentional dependency changes.
- Run `bun run check` (generates workspace modules, lints, and checks TypeScript). Before any raw TypeScript check, run `bun run generate:workspace-modules`.
- Run affected non-UI domain/protocol tests and the fork maintenance/release tests. Do not add UI tests or replace removed ones at another layer.
- Start `bun run web` in tmux on an available port (not 2999 or 24800), follow `docs/automation.md`, stage an evaluation workspace and manually review relevant desktop/mobile/spread behavior. Inspect browser errors as well as appearance. Use workspace helper interfaces for workspace commands, never `docker exec`.
- Run `acceptance/composer-layout.ts` for composer/transcript-scroll/floating-control/terminal-sizing changes. Also run `acceptance/soft-keyboard.ts` for soft-keyboard changes. Link reports and state any infrastructure blockers honestly; do not imply unrun checks passed.
- Inspect final diff, conflict markers, dependencies, generated files and Git status. Record target SHA, deliberate exclusions and important conflict/patch adaptations in the merge commit message so the next merge can discover them without a new tracking document.
- Keep feature restoration/polish in separate commits from the upstream merge. Never revert a mixed removal commit blindly: restore the requested feature without unrelated removed UI.
- Present the running app in the preview, summarize included/excluded changes, validation and limitations, and link commits/reports. Do not push, publish images, promote or deploy unless requested.
