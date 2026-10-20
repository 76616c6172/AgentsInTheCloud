---
name: lucas-plan
description: When the user asks for a lucas-plan, get aligned with them on what you're about to implement and how, using numbered recommendations they can accept by silence, before writing any code.
---

# lucas-plan

The user wants alignment on what you're about to build and how, before you build it. Skip the usual Q&A. For every question you'd normally ask, decide what you'd recommend and state that as a recommendation, phrased so the user doesn't need to know the question.

The user signs off implicitly. If they push back on 3 and say nothing about 1, 2 and 4, then 1, 2 and 4 are accepted.

## Before the first round

Read enough of the code to make concrete recommendations about *this* codebase: name the real files, modules and existing patterns they touch. A recommendation the user can't picture is one they can't agree with.

## What to recommend

- Put the decisions that would change the most of the plan if rejected at the top. Recommendations below a heading are ordered the same way.
- If the request could be understood in more than one way, your reading of it is recommendation 1.
- Only include decisions where a reasonable person might choose differently. Leave out things with no real alternative, like "write tests" or "escape user input"; fold those into the context of the decision they belong to.
- Aim for 4–10 recommendations per round. Save later-stage decisions for later rounds.
- Never ask a question. If something is purely the user's preference, still pick a default and say so in its context.

## How it looks

The user reads only the recommendations themselves unless they disagree. Make each one enough on its own.

- Each recommendation is a numbered list item in plain text, with no bold: `4. Deleted projects stay restorable for 30 days.` Use one or two sentences, stated as what will happen, not as an option.
- Put reasoning, alternatives you rejected, and what changes if the user disagrees in a collapsed block inside the list item, indented to line up with the item's text. Keep it brief. Leave it out when there's nothing worth saying.
- The summary line names the strongest alternative you turned down, like `Why not Redis?`, so the user can spot a rejected option they'd prefer without opening anything. Use `Why` alone when there was no real alternative.
- Group recommendations under two headings: `### Big calls`, the ones that would reshape the plan, and `### Smaller calls`. Leave out a heading when it would be empty.
- Use no HTML other than `<details>` and `<summary>`. Write them exactly like this, with each tag on its own line and blank lines around the Markdown inside. Leave a blank line between items, too:

```markdown
2. Search results are cached in memory for five minutes, per server process.

   <details>
   <summary>Why not Redis?</summary>

   Search takes about 2 s today and most people repeat the same few queries.

   - **Redis:** shared across processes, but another service to run, and we only run one process.
   - **No cache:** simplest, but the 2 s wait stays.

   If you'd rather not cache, recommendations 5 and 6 go away too.

   </details>

3. Cached results are cleared whenever a document is saved.
```

- A short Mermaid diagram inside the collapsed block is welcome when the shape of the change is easier to see than to read.
- Open with at most one sentence on what you looked at. End with one line telling the user they only need to reply with the numbers they'd change.
- Don't mention this skill or its rules in your reply. Just follow them.

## Later rounds

- Number recommendations sequentially across all rounds. Never reuse a number.
- When the user pushes back, start the round with the revised recommendations. Give each a new number and end it with `(replaces 3)`. Only re-issue a recommendation when what will happen actually changes. Anything you don't repeat still stands.
- Then continue with the next layer of decisions: file layout, data shapes, order of work, how you'll verify it.
- Keep going until the user tells you to start, or until nothing left is worth deciding together. Then say so in one sentence and suggest starting.

## Implementing

- Don't change any code until the user tells you to start.
- The accepted recommendations are the spec. If you discover partway through that one of them doesn't hold, stop and raise the change as a new numbered recommendation instead of quietly doing something else.
