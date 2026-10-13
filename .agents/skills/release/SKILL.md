---
name: release
description: Prepare and publish AgentsInTheCloud releases. For stable, propose user-focused release notes since the last stable revision, build while the user reviews them, and publish only after explicit sign-off.
---

# Release AgentsInTheCloud

Run commands from the repository root. A request to prepare a stable release authorizes building an immutable candidate, **not publishing stable or approving release notes**. Do not launch a release merely because this skill is being edited or discussed.

## Stable release

### 1. Figure out the changes and propose candidate notes

Fetch `origin/main` and pin its exact commit as `CODE_SHA`. Only committed, pushed code is released; local working changes are not included.

```sh
git fetch origin refs/heads/main
git rev-parse 'FETCH_HEAD^{commit}'
```

Discover the revision actually installed by the published stable image:

```sh
bun -e 'import { fetchChannelImageMetadata } from "./packages/update/src/server/registry.ts"; console.log(await fetchChannelImageMetadata("stable"));'
```

Use its `revision` as `PREVIOUS_STABLE_SHA`, and verify it is an ancestor of `CODE_SHA`. Consult published `stable-*` GitHub Releases in `lucasmeijer/AgentsInTheCloud` for earlier notes and context, but the Docker stable tag is the authority for what was released. Do not substitute latest, the newest Markdown file, or the newest GitHub release if they disagree. Stop and resolve partial publication first. If there is no previous stable revision, ask the user what baseline to use rather than inventing one.

```sh
git merge-base --is-ancestor "$PREVIOUS_STABLE_SHA" "$CODE_SHA"
git log --oneline "$PREVIOUS_STABLE_SHA..$CODE_SHA"
git diff --stat "$PREVIOUS_STABLE_SHA" "$CODE_SHA"
git diff "$PREVIOUS_STABLE_SHA" "$CODE_SHA"
```

Inspect the actual changes, not just commit messages. Draft notes following the writing rules below. Present the **candidate notes directly to the user as bullet-point lists**, grouped under **Features / enhancements** and **Bugfixes**. Keep the previous stable and candidate revisions and the proposed filename separate from the notes. Invite edits and redactions. Make clear that these are candidates, not approved notes.

Write the candidate file at:

```text
release_notes/YYYY-MM-DD-short-description.md
```

Use the planned release date and a unique lowercase, hyphenated description, e.g. `release_notes/2026-08-03-faster-workspaces.md`. This basename is the release ID. Do not reuse an already reserved/published ID for another code revision. Draft notes can stay uncommitted while the user edits them.

### 2. Build while the user reviews the notes

After presenting candidates, start preparation pinned to `CODE_SHA` in a tmux session, then return to the conversation so the user can edit or redact notes while it builds:

```sh
tmux new-session -d -s release-build "bun run release --prepare --revision $CODE_SHA; result=\$?; printf '\nPreparation exited %s\n' \"\$result\"; exec bash"
```

Present that terminal with `present(kind="tmux", session="release-build")`. Inspect progress/status under Git's common directory, `agents-in-the-cloud-releases/<run-id>/`; `last-run.txt` identifies the latest run. Record the run's commit, immutable image digest, and outcome.

`--prepare` builds and uploads the immutable commit image, verifies both native architectures and pinned dependencies, and stops. **It does not move latest or stable and does not create/publish a GitHub Release.** The approved publication command will reuse this image. Notes editing and building run in parallel; actual promotion waits for both to finish.

Apply the user's redactions and revisions, then show the resulting notes again. Obtain **explicit sign-off on that exact text**. Silence, a successful build, or an earlier request to release is not approval. Do not restore redacted items or make further wording changes after approval without asking again.

### 3. Commit the approved notes, without changing the prepared code

After sign-off, commit only the approved notes file and push it to `origin/main`, following the repository's normal Git workflow. Do not stage unrelated working files, reset the user's branch, or force-push. If the current checkout is not suitable, use a clean worktree at the pinned revision.

Record this new commit as `NOTES_SHA`. The notes commit is separate from the code revision so editing notes does not require rebuilding the application. Between `CODE_SHA` and the fetched main head, only files under `release_notes/` may differ. The command checks ancestry and this restriction. If other code changes landed, stop: prepare the new code, update the candidate notes, and obtain fresh approval. Do not silently release a newer revision.

### 4. Publish after approval and successful preparation

Wait for preparation to finish successfully. Confirm its reported revision equals `CODE_SHA`, the approved file is committed/pushed, and it still contains the signed-off text. Then run:

```sh
bun run release --stable --revision "$CODE_SHA" \
  --notes release_notes/YYYY-MM-DD-short-description.md
```

Run long commands in tmux and present live progress. This command reads notes from the fetched `origin/main` commit, reuses/verifies the prepared code image, reserves a hidden GitHub draft, confirms main has not moved during publication, promotes latest and stable by digest, and publishes the approved notes.

The GitHub tag `stable-<release-id>` points at **CODE_SHA**, not the later notes-only commit. Publication metadata records the code revision, notes revision, source path, and image digest. The Markdown file is the repo history; the GitHub Release is the published history fetched by “What’s new.” Latest users see crossed stable milestones and a comparison for changes beyond them; latest releases need no handwritten notes.

Confirm the status reports both channels and release notes published, registry tags resolve to the prepared digest, and the public GitHub Release contains the approved text. Report the code revision, notes file, digest, and release link to the user.

## Writing the candidate notes

Write for the person using AgentsInTheCloud, not for the developer who implemented the change. What can they do now? What is easier? What no longer gets in their way?

- Split notes into **Features / enhancements** and **Bugfixes**.
- Every release-note entry must be a Markdown bullet (`- `) with a one-line summary. Use this same bullet-point format in the candidate notes shown in chat, the committed file, and the published release. No prose summaries, numbered lists, nested lists, or implementation paragraphs.
- Put the biggest features first. Within each section, put smaller changes and changes affecting fewer people lower down.
- Explain the effect on the user. Prefer “Moving tabs keeps your terminal sessions running” over “Replaced layout reconciliation with keyed DOM operations.”
- Omit changes that do not affect users: internal refactors, developer tooling, tests, publishing machinery, and dependency updates without user-visible consequences.
- Be friendly, direct, specific, and brief. Avoid hype, commit hashes in the notes, internal module names, and unexplained jargon.
- Combine related changes into a benefit; omit reverted changes. Verify claims and do not invent improvements or promise unverified results.
- Omit empty sections instead of adding filler.

```markdown
# Faster workspaces

## Features / enhancements
- Open workspaces faster, so you can get back to your work sooner.
- See what changed before updating, including stable releases you skipped.

## Bugfixes
- Moving tabs now keeps your terminal sessions running.
```

These are format examples, not claims to copy without verification.

## Latest releases

No handwritten notes or notes approval loop is required. Commit/push the intended code, then run `bun run release` in tmux. It builds/verifies and promotes latest only. If the user wants build preparation separately, use `--prepare --revision <full-sha>` and then `bun run release --revision <same-sha>`; main must still contain the same code.

## Prerequisites, checks, and recovery

- Docker, Buildx, Bun, Git, local/SSH builders, existing `GH_PACKAGE_TOKEN`, and `ATELIER_RELEASE_HELPER` are required. Stable publication also requires a `gh` CLI login with repository release write access. No new environment variable is needed.
- `bun run release --check` checks Git and both native builders without publishing. `--stable --check` may omit notes; with `--notes`, it also validates the committed file. Do not combine `--prepare` with `--stable`, `--notes`, or `--check`.
- The repo lock serializes build/publication commands; notes review does not hold that lock. Do not run publishers in different clones concurrently.
- Docker promotion and GitHub publication are not atomic. If publication fails, inspect the per-channel and notes status before claiming success. Never manually publish a draft before stable promotion succeeds.
- Retry the same pinned `CODE_SHA`, notes file, and notes-source commit after a partial failure. Uploaded images and matching reserved/published records are reused. Avoid advancing main until a partial publication is finished. If the prepared build fails, notes approval alone does not authorize promotion; fix the failure and rebuild, renewing approval if code or notes change.
