import { awaitWithContext } from "@earendil-works/chord/context";
import { defineTool, type ConversationId, type ToolRegistration } from "@earendil-works/pi-durable";
import { createEditTool, createReadTool, createWriteTool, type ImageProcessor } from "@earendil-works/pi-durable/tools";
import { createNodePhotonImages } from "@earendil-works/pi-durable/images/node";
import { WorkspaceFileSystem } from "@agents-in-the-cloud/builtin-agent/server/durable-workspace-files";
import { bashToolDefinition, forcedColorEnvironment, formatBashOutput } from "@agents-in-the-cloud/agent/server/bash-tool";
import { withCommandSignal } from "@agents-in-the-cloud/core";
import { workspaceRoot, workspaceTerminalProcesses } from "@agents-in-the-cloud/workspace";
import { Type } from "typebox";

const defaultBashTimeoutSeconds = 600;

let photon: Promise<ImageProcessor> | undefined;
const images: ImageProcessor = {
  async prepare(bytes, mimeType, limits) {
    return (await (photon ??= createNodePhotonImages())).prepare(bytes, mimeType, limits);
  },
};

const bashEnv: Record<string, string> = Object.fromEntries(
  Object.entries(forcedColorEnvironment).map(([key, value]) => [key, String(value)]),
);

export type ResolveHubContainer = (
  conversationId: ConversationId,
  onProgress?: (message: string) => void | Promise<void>,
) => Promise<string>;

function withLazyContainer<TParams extends object>(
  tool: ToolRegistration<TParams>,
  resolveContainer: ResolveHubContainer,
  replay: "safe" | "unsafe",
): ToolRegistration<TParams> {
  return {
    ...tool,
    replay,
    async execute(args, api, context) {
      const containerId = await awaitWithContext(
        resolveContainer(api.conversationId, (message) => api.details({ status: message }, context)),
        context,
      );
      return await tool.execute(args, { ...api, env: new WorkspaceFileSystem(containerId) }, context);
    },
  };
}

export function createHubContainerTools(resolveContainer: ResolveHubContainer): ToolRegistration[] {
  const readTool = withLazyContainer(createReadTool({ images }), resolveContainer, "safe");
  const writeTool = withLazyContainer(createWriteTool(), resolveContainer, "unsafe");
  const editTool = withLazyContainer(createEditTool(), resolveContainer, "unsafe");

  const bashTool = defineTool({
    name: bashToolDefinition.name,
    description: bashToolDefinition.description,
    parameters: bashToolDefinition.parameters,
    replay: "unsafe",
    async execute(args, api, context) {
      const containerId = await awaitWithContext(
        resolveContainer(api.conversationId, (message) => api.details({ status: message }, context)),
        context,
      );
      const processes = workspaceTerminalProcesses(containerId);
      const processId = `hub-${api.callId}-${crypto.randomUUID().slice(0, 8)}`;
      const timeoutSeconds = args.timeout ?? defaultBashTimeoutSeconds;
      const deadline = Date.now() + Math.max(1, timeoutSeconds) * 1000;
      await awaitWithContext(
        processes.start({
          id: processId,
          command: args.command,
          cwd: workspaceRoot,
          env: bashEnv,
          deadline,
          keepText: true,
        }),
        context,
      );

      const abortOnSignal = () => {
        void processes.stop(processId).catch(() => {});
      };
      context.abortSignal?.addEventListener("abort", abortOnSignal, { once: true });

      try {
        const settled = context.abortSignal
          ? await withCommandSignal(context.abortSignal, () => processes.waitForEnd(processId))
          : await processes.waitForEnd(processId);
        if (settled.state === "missing" || settled.state === "lost") {
          return {
            output: [{ type: "text", text: "The command's terminal process disappeared before it recorded a result." }],
            isError: true,
          };
        }
        const fullOutputPath = processes.textFile(processId);
        const formatted = formatBashOutput(settled.output.text, settled.output.ansi, fullOutputPath);
        const lines = [formatted.output];
        if (settled.timedOut) lines.push(`Command timed out after ${timeoutSeconds} seconds.`);
        else if (settled.aborted) lines.push("Command aborted.");
        else if (settled.exitCode !== 0 && settled.exitCode !== null) lines.push(`Command exited with code ${settled.exitCode}.`);
        return {
          output: [{ type: "text", text: lines.filter(Boolean).join("\n\n") || "(no output)" }],
          details: {
            exitCode: settled.exitCode,
            aborted: settled.aborted,
            timedOut: settled.timedOut,
            truncated: formatted.modelTruncated,
            fullOutputPath,
            displayAnsi: formatted.displayAnsi,
            terminalProcessId: processId,
          },
          isError: Boolean(settled.aborted || settled.timedOut || (settled.exitCode !== null && settled.exitCode !== 0)),
        };
      } finally {
        context.abortSignal?.removeEventListener("abort", abortOnSignal);
        await processes.release(processId).catch(() => {});
      }
    },
  });

  // SAFETY: ToolRegistration<TParams> is contravariant in TParams; Durable's registry stores erased registrations.
  return [readTool, writeTool, editTool, bashTool] as ToolRegistration[];
}

export const hubContainerToolSchemas = {
  bashArgs: Type.Object({ command: Type.String() }),
};
