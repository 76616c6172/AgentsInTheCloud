---
description: Get your work reviewed by a fresh agent, then address the findings
argument-hint: "[which changes to review]"
---
Get the changes reviewed by a fresh agent, then address what it finds.

Changes to review: $ARGUMENTS
(If that's empty: all uncommitted changes plus commits not on the upstream branch, or on origin/main when there is no upstream.)

## Run a round

Read `.agents-in-the-cloud/scripts/review.js` first, so you know what the reviewer is told and what it returns. For each round, call `codemode` with the line `// @path: .agents-in-the-cloud/scripts/review.js`, followed by the script's input as JSON. The reviewer is a one-shot `tools.agent` call, not a subagent: the input is all it gets from you.

## Address the findings

You have context the reviewer didn't, so you decide every finding, minors included: fix it or push back. A repro that didn't hit the bug is weaker evidence.

- Leave uncommitted changes uncommitted. Stage only each fix's own hunks; when a fix can't be separated from uncommitted work, leave it uncommitted and tell the user.
- One commit per fix, titled `Review: <what was fixed>`. The message explains the bug and the fix, not the review finding. Keep the reviewer's repro test if it's a good regression test; otherwise remove it in that commit.
- For each pushback, tell the user the finding in one line and why you're not fixing it.
- Only tell the user about a fix when it diverged from the plan or what we agreed, changed behaviour or UI they'd notice, needed substantial gymnastics, or added serialized state or upgrade concerns. Mention the other fixes in one line with their commits.
- Always pass on what the reviewer said about serialized state and upgrade risk.

## More rounds

After each round, decide whether to run another. A later round's input scopes it to the previous round's fix commits, lists all pushbacks so far, and lists each fix commit with the finding and repro it addresses. Treat `partial` and `unresolved` fix checks as findings at their original level.

Keep going while rounds turn up things worth fixing. Pause and talk to the user instead when an issue needs their judgement: a fix that would change the plan, a trade-off you can't settle with what you know, or findings that keep coming back.
