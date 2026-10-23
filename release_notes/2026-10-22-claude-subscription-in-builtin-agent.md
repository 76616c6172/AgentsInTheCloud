# Claude subscription support in the built-in agent

## Features / enhancements
- Use your Claude subscription with the built-in agent and Pi.
- Claude Code, and the built-in agent on Claude, ChatGPT and xAI, suggest your next prompt as ghost text in the empty composer.
- While the built-in agent works, new messages queue as follow-ups for when it's done. Press Cmd+Enter twice to steer with one instead.
- Codemode scripts can hand questions to one-shot agents that answer as checked JSON, run script files, and run as prompt templates.
- Agents can link commits and commit ranges that open in Changes.
- Changes can group files into buckets like Tests and Evals, with separate line counts.
- Claude Code and Codex agents get named from their prompts, and a named agent names its workspace.
- The Files view now uses Pierre's editor and diffs, the same as Changes.
- Syntax highlighting now uses the Highlights library, which is faster and covers about 50 more file types.
- See OpenCode Go's five-hour and weekly usage, and your Anthropic extra usage status.
- GitHub-style `<details>` blocks show as collapsed sections, and `f` opens Markdown images fullscreen.
- Code blocks and tool output wrap by default.
- ⌘⌥] now toggles the Work pane, and ⌘⌥[ is gone.
- The Host page no longer has root terminals.

## Background work and subagents
- See what an agent is doing in the background, like Claude Code's background tasks and workflows, Codex sub-agents and built-in subagents, in a bar above its transcript.
- Subagent reports, finished background commands and messages from other agents show as their own Incoming Message item.
- Claude Code finishes its turn while background work runs, and background tasks that finish mid-turn show as notes.

## Bugfixes
- AgentsInTheCloud and its Docker no longer trust certificates from eMudhra's compromised intermediates, so your secrets and image downloads can't be intercepted with a forged certificate. Run the installer again to get the whole fix.
- Opening or expanding something in a conversation no longer gets yanked away by new output. Following resumes when you scroll back to the end.
- When the built-in agent keeps crashing the app at the same step, it now pauses and offers Try again instead of looking busy forever.
- A Claude Code command's output, like `/code-review`'s findings, now shows as its answer.
- Images in Claude Code steering messages now show in the conversation.
- Starting an agent with a model that can't run now tells you why instead of quietly using the default.
- A secret's URL permission now covers query strings too.
- Changes falls back to the default comparison when the commits you picked are gone, and word-level highlights are easier to read.
- Selecting text in the Files editor works properly again.
- On phones, scrollbars show while you scroll, and the tap highlight no longer sticks over the launch composer.
- The Anthropic subscription notice shows only once when you sign in again.
