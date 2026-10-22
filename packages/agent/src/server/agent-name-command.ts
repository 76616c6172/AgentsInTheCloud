import { getWorkspaceTitle, setWorkspaceTitle } from "@agents-in-the-cloud/workspace";
import { parseAgentNameCommand } from "./builtin-slash-commands.ts";

/** Like Builtin Agents, an unnamed Workspace (or one still named after this Agent) follows the Agent's new name. Returns whether it did. */
export async function workspaceFollowsAgentTitle(workspaceId: string, previousTitle: string, title: string): Promise<boolean> {
  const workspaceTitle = await getWorkspaceTitle(workspaceId);
  if (workspaceTitle !== null && workspaceTitle !== previousTitle) return false;
  await setWorkspaceTitle(workspaceId, title);
  return true;
}

/** AgentsInTheCloud owns /name; providers supply only their conversation context and title store. */
export async function runAgentNameCommand(text: string, options: {
  suggest: () => Promise<string | undefined>;
  setTitle: (title: string) => Promise<void>;
}): Promise<"named" | "no-title" | undefined> {
  const command = parseAgentNameCommand(text);
  if (!command) return undefined;
  const title = command.title ?? await options.suggest();
  if (!title) return "no-title";
  await options.setTitle(title);
  return "named";
}
