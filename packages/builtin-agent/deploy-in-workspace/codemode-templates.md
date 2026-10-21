# Code mode templates

This adds to the Prompt templates section of `agents-in-the-cloud.md`, for the builtin Agent only.

A code mode template is a Prompt template whose body is a code mode script instead of a prompt. Sending its slash command runs the script as your own `codemode` call, without asking the model. The user's message (`/name args`, as typed) and the call's result stay in your context, so you know what it did when the user writes next.

Turn a Prompt template into one with `codemode: true` in its frontmatter. Everything else works like a Prompt template: the file location, `description`, `argument-hint`, `composer-button` and `shortcut`. A composer button puts the slash command in the composer instead of expanding the script, and a shortcut sends it straight away. Only the builtin Agent can run code mode templates, so other Agents don't list them.

Example `.agents-in-the-cloud/prompts/peek.md`:

```markdown
---
description: Take a quick look at a folder
argument-hint: "[folder]"
codemode: true
composer-button: true
---
const folder = args[0] ?? "/work";
const files = await tools.bash({ command: `ls -la ${folder}` });
const disk = await tools.bash({ command: `df -h ${folder} | tail -1` });
text(`Files in ${folder}:\n${files.output}`);
return `Disk: ${disk.output}`;
```

The body is the raw JavaScript you'd pass to `codemode`, with the same tools and globals. Arguments come in as variables instead of placeholders, which don't apply to code mode templates:

- `args`: the arguments as an array of strings, split like shell words, so quotes group words.
- `argumentsText`: everything after the command, as typed.

An optional first line `// @options: {...}` sets the script's options, as in any `codemode` call.

How a run ends:

- Sent to an idle Agent, the template's run ends when the script does; the model doesn't answer it. That holds when the script fails, too: its error shows in the result.
- Sent while you're working, it joins your work like any steering message. The script runs at the next tool boundary, and you carry on with its result.
- Sent along with other messages that start a run together, the script runs first and you answer the other messages.
- Stop ends the script like any other call. After an AgentsInTheCloud restart, the script picks up where it was without repeating finished calls.

Code mode templates can't take attachments; AgentsInTheCloud turns the message away.

When the user asks for a code mode template, write the script so it runs without you: it gets no other instructions.
