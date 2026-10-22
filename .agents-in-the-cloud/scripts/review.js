// One review round for /review: a one-shot tools.agent reviewer.
//
// Its input, the JSON after the call's `// @path:` line:
// {
//   "scope": "the changes to review, as git commands or commit ranges",
//   "pushbacks": ["<finding>: <why it's not being fixed>"],                        // from earlier rounds
//   "fixes": [{ "commit": "<sha>", "finding": "<the finding and repro it fixes>" }] // from the previous round
// }
//
// Returns the reviewer's answer, shaped by `schema` below. The reviewer sees only this prompt: not the plan, not the
// conversation.

const pushbacks = input.pushbacks ?? [];
const fixes = input.fixes ?? [];

const finding = {
  type: "object",
  required: ["title", "file", "line", "detail", "suggestion", "repro"],
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    file: { type: ["string", "null"] },
    line: { type: ["integer", "null"] },
    detail: { type: "string" },
    suggestion: { type: "string" },
    repro: {
      type: ["object", "null"],
      required: ["kind", "detail", "hit"],
      additionalProperties: false,
      properties: {
        kind: { type: "string", enum: ["steps", "test"] },
        detail: { type: "string" },
        hit: { type: "boolean" },
      },
    },
  },
};

const schema = {
  type: "object",
  required: ["blocker", "major", "minor", "serializedState", "upgradeRisk", "fixChecks"],
  additionalProperties: false,
  properties: {
    blocker: { type: "array", items: finding },
    major: { type: "array", items: finding },
    minor: { type: "array", items: finding },
    serializedState: { type: ["string", "null"] },
    upgradeRisk: { type: ["string", "null"] },
    fixChecks: {
      type: "array",
      items: {
        type: "object",
        required: ["commit", "verdict", "reproStillHits", "note"],
        additionalProperties: false,
        properties: {
          commit: { type: "string" },
          verdict: { type: "string", enum: ["resolved", "partial", "unresolved"] },
          reproStillHits: { type: ["boolean", "null"] },
          note: { type: "string" },
        },
      },
    },
  },
};

const prompt = `You're reviewing code changes in the git repository in your working directory.

The changes: ${input.scope}

Review them for correctness, and for missed opportunities to do something simpler. Sort your findings into blocker, major and minor.

For every blocker and major, try to prove it with a reproduction: steps you actually ran, or a unit test you wrote and ran. Set repro.hit to whether you actually hit the bug. Leave the unit tests in the tree. Minors have repro null.

Report any new state the changes serialize to disk in serializedState, and anything that will cause problems when older installs upgrade to this version in upgradeRisk. Use null for none.
${pushbacks.length ? `
These have already been decided; leave them out of your findings:
${pushbacks.map(p => `- ${p}`).join("\n")}
` : ""}${fixes.length ? `
Each of these commits fixes an earlier finding. For each, check whether it solves the finding itself, not just its repro, and rerun the repro if there is one. Fill in one fixChecks entry per commit. A fix whose repro still hits is never resolved.
${fixes.map(f => `- ${f.commit}: ${f.finding}`).join("\n")}
` : `
Leave fixChecks empty.
`}`;

return await tools.agent({ label: "review", prompt, schema });
