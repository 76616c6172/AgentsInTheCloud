// Offline registration/tool check against the real compiled Pi host. No UI tests,
// model calls, credentials, or access to the user's repository are needed.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { VERSION, getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import load from "./loader.ts";
import profile from "./package.json";

export default async function (pi: ExtensionAPI) {
  const tools = new Map();
  const commands = new Set<string>();
  let renderers = 0;
  const monitored = new Proxy(pi, {
    get(target, key) {
      if (key === "registerTool") return (tool) => { tools.set(tool.name, tool); return target.registerTool(tool); };
      if (key === "registerCommand") return (name, command) => { commands.add(name); return target.registerCommand(name, command); };
      if (key === "registerToolRenderer") return (...args) => { renderers++; return target.registerToolRenderer(...args); };
      return Reflect.get(target, key);
    },
  });
  await load(monitored);
  pi.on("session_start", async (_event, ctx) => {
    assert(!commands.has("diff"), "pi-changes must not be loaded in the cloud profile");
    assert(commands.has("exhash"));
    assert(renderers > 0);
    const path = join(getAgentDir(), "fixture.ts");
    await writeFile(path, "export function value() {\n  return 1;\n}\n");
    const call = async (name, args) => {
      assert(tools.has(name), `Missing tool: ${name}`);
      const result = await tools.get(name).execute("smoke", args, new AbortController().signal, undefined, ctx);
      assert(!result.isError, `${name} failed`);
      return result.content.filter(c => c.type === "text").map(c => c.text).join("\n");
    };
    const text = await call("exhash_read", { path });
    const address = text.match(/\b2\|[A-Za-z0-9_-]{2}\|/)?.[0];
    assert(address, "exhash_read returned no verified address");
    await call("exhash_edit", { path, commands: [{ address, op: "change", text: "  return 42;" }] });
    assert((await readFile(path, "utf8")).includes("return 42;"));
    assert((await call("exhash_open", { path })).includes("value"));
    await writeFile(join(getAgentDir(), "smoke.json"), JSON.stringify({ pi: VERSION, extensions: profile.nox.extensions, tools: [...tools.keys()], commands: [...commands], renderers }));
  });
}
