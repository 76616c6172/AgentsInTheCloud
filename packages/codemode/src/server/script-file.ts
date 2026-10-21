import { createHash } from "node:crypto";
import { defineDoc, defineEntry, type ToolExecutionApi, type ToolExecutionResult } from "@earendil-works/pi-durable";
import type { Context } from "@earendil-works/chord";
import type { ScriptFileView } from "@agents-in-the-cloud/agent/server/transcript";
import { execWorkspaceCommand } from "@agents-in-the-cloud/workspace";

/** A call's script file, pinned before it first runs, so a rerun after a restart runs the same code. */
const ScriptFileDoc = defineDoc<{ file?: ScriptFileView }>({
  kind: "agents-in-the-cloud.codemode-script-file",
  version: 1,
  scope: "task",
  initial: () => ({}),
});

/** The script file a code mode call ran, by the call's ID, for the transcript; the task's document is gone once it ends. */
export const codemodeScriptFileEntry = defineEntry<{ callId: string } & ScriptFileView>("agents-in-the-cloud.codemode-script-file");

export const scriptFileDescription = "To run a script file instead, make the code a single line `// @path: <file>`, optionally after an `// @options:` line. The file holds a script like any other; edit it and call again to iterate. Each call runs the file as it was when the call started.";

const optionsLine = /^[ \t]*\/\/ @options:[^\r\n]*\r?\n/;
const pathLine = /^[ \t]*\/\/ @path:[ \t]*([^\r\n]*?)\s*$/;

/**
 * A script that names a file instead, as `// @path: <file>`, optionally after an options line: the options line and
 * the file's path, or why the script can't name a file that way. A `// @path:` line that is not the whole script
 * is a mistake, as it would otherwise run as a comment.
 */
function scriptFileReference(code: string): { options: string; path: string } | { error: string } | undefined {
  const options = code.match(optionsLine)?.[0] ?? "";
  const reference = code.slice(options.length).match(pathLine);
  if (!reference) return /^[ \t]*\/\/ @path:/m.test(code) ? { error: "A `// @path:` line must be the whole script, after at most an `// @options:` line." } : undefined;
  if (!reference[1]) return { error: "`// @path:` needs the path of a script file." };
  return { options, path: reference[1] };
}

/** Reads a script file: its text, or why it can't. */
export type ReadScriptFile = (path: string) => Promise<{ text: string } | { error: string }>;

/** Reads script files in a workspace; relative paths start at its root. */
export function workspaceScriptFiles(workspaceId: string): ReadScriptFile {
  return async path => {
    const result = await execWorkspaceCommand(workspaceId, ["cat", "--", path]);
    return result.exitCode === 0 ? { text: result.stdout } : { error: result.stderr.trim() };
  };
}

function errorResult(message: string): ToolExecutionResult {
  return { output: [{ type: "text", text: message }], isError: true };
}

/**
 * The script a code mode call runs: its code, or the file it names, read once and pinned for the call. Its result
 * is an error result when the file can't be the script.
 */
export async function resolveScript(readFile: ReadScriptFile, code: string, api: ToolExecutionApi, context: Context): Promise<{ code: string } | { error: ToolExecutionResult }> {
  const reference = scriptFileReference(code);
  if (!reference) return { code };
  if ("error" in reference) return { error: errorResult(reference.error) };
  // The document is a draft of its transaction: copy the file out of it.
  let file = await api.commit(async tx => {
    const pinned = (await tx.doc(ScriptFileDoc, api.taskId)).file;
    return pinned && { ...pinned };
  }, context);
  if (!file) {
    const contents = await readFile(reference.path);
    if ("error" in contents) return { error: errorResult(`Can't read script file ${reference.path}: ${contents.error}`) };
    const read = { path: reference.path, sha256: createHash("sha256").update(contents.text).digest("hex"), code: contents.text };
    await api.commit(async tx => {
      (await tx.doc(ScriptFileDoc, api.taskId)).file = read;
      await tx.appendEntry(codemodeScriptFileEntry, api.conversationId, { data: { callId: api.callId, ...read } });
    }, context);
    file = read;
  }
  if (reference.options && optionsLine.test(file.code)) {
    return { error: errorResult(`${file.path} has its own \`// @options:\` line. Put options in the file or in the call, not both.`) };
  }
  return { code: `${reference.options}${file.code}` };
}
