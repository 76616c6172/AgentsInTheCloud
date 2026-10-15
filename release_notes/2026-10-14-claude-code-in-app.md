# Claude Code, right in the app

## Features / enhancements
- Run Claude Code as an in-app agent, with streamed replies, steering, model and effort controls, /fork, /resume and images. The terminal version is still there as Claude Code CLI.
- Set Secrets, SSH keys, trusted SSH servers and Environment variables once for every workspace in Settings. A template's own entries still override them.
- Let workspaces reach specific hosts on your private network, like `db.internal:5432`, globally or per template. Changes apply to running workspaces.
- Turn off line wrapping in the file viewer when you'd rather scroll long lines.
- New secrets for well-known services, like `ANTHROPIC_API_KEY` or `GH_TOKEN`, fill in their allowed hosts for you.
- See your GitHub Copilot usage for the month, including premium requests and overage.
- Add custom OpenAI-compatible endpoints by name, with their models discovered automatically.
- Codex CLI and Pi install the official way and keep themselves up to date.
- Workspaces no longer come with matplotlib, OpenCV, scikit-image, MoviePy or imageio preinstalled, which keeps them leaner. Install them with pip when you need them.
- Run AgentsInTheCloud from your own fork, publishing releases and updates from your own account.

## Bugfixes
- Copy buttons, dialogs, help tips and menus keep working after a conversation updates.
- Tab and workspace naming works again with models that always think, like Claude Haiku.
- When automatic workspace naming fails, you now see why, plus a hint to use /name.
- Naming a Claude Code CLI, Codex CLI or Pi tab now names its workspace too, like built-in agents.
- When an update needs the installer, the app says so and gives you the command, instead of failing partway.
- Dictation no longer drops your last few words.
- Claude Code CLI, Codex CLI and Pi now get your project's `.agents-in-the-cloud/AGENTS.md` instructions.
- Images, audio and video in the Files tab preview without loading the whole file first. Other files download instead of opening as text.
- One failed subagent call no longer breaks the rest of a Codex conversation.
- Pi's colors now follow your AgentsInTheCloud theme.
- On phones, the agent picker shows clean names instead of squashed descriptions, and settings and prompt buttons have more room.
- Text sizes in the iPhone and iPad app are consistent again.
- Signing in to Codex can fall back to your browser when device-code sign-in doesn't work.
- Connecting an OpenCode Go key works.
- On Arch Linux and other systems with the same kernel default, workspaces start instead of failing with "device or resource busy", once you've run the installer again.
- Host disk diagnostics work on Btrfs, once you've run the installer again.
- When the installer can't download because of an old ghcr.io login, it tells you how to fix it.
