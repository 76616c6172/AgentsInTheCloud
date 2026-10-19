import { posix } from "node:path";
import { checkFileInWorkspace, execWorkspaceCommand, readFileInWorkspace, workspaceRoot, writeFileInWorkspace } from "@agents-in-the-cloud/workspace";
import type { ReadToolOptions, WriteToolOptions, EditToolOptions } from "@earendil-works/pi-coding-agent";

export function normalizeWorkspacePath(path: string): string {
  if (!path || path.includes("\0")) throw new Error("path is required");
  const absolute = path.startsWith("/") ? posix.normalize(path) : posix.normalize(posix.join(workspaceRoot, path));
  return absolute;
}

const supportedImageMimeTypes = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp"]);

async function detectWorkspaceImageMimeType(workspaceId: string, absolutePath: string): Promise<string | null> {
  const result = await execWorkspaceCommand(workspaceId, ["file", "--brief", "--mime-type", absolutePath]);
  if (result.exitCode !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || `could not inspect ${absolutePath}`);
  const mimeType = result.stdout.trim().toLowerCase();
  return supportedImageMimeTypes.has(mimeType) ? mimeType : null;
}

/** Larger files fail to read; the agent can still page through them with bash. */
const maxReadBytes = 64 * 1024 * 1024;

function readFileBuffer(workspaceId: string, absolutePath: string): Promise<Buffer> {
  return readFileInWorkspace(workspaceId, { user: "agents-in-the-cloud", path: absolutePath }, { maxBytes: maxReadBytes });
}

function writeFile(workspaceId: string, absolutePath: string, content: string): Promise<void> {
  return writeFileInWorkspace(workspaceId, { user: "agents-in-the-cloud", path: absolutePath }, content);
}

function accessFile(workspaceId: string, absolutePath: string): Promise<void> {
  return checkFileInWorkspace(workspaceId, { user: "agents-in-the-cloud", path: absolutePath });
}

export function workspaceFileToolOptions(workspaceId: string) {
  const read: ReadToolOptions = {
    operations: {
      readFile: (path) => readFileBuffer(workspaceId, normalizeWorkspacePath(path)),
      access: (path) => accessFile(workspaceId, normalizeWorkspacePath(path)),
      detectImageMimeType: (path) => detectWorkspaceImageMimeType(workspaceId, normalizeWorkspacePath(path)),
    },
  };
  const write: WriteToolOptions = {
    operations: {
      writeFile: (path, content) => writeFile(workspaceId, normalizeWorkspacePath(path), content),
      // Writing creates missing folders.
      mkdir: async () => {},
    },
  };
  const edit: EditToolOptions = {
    operations: {
      readFile: (path) => readFileBuffer(workspaceId, normalizeWorkspacePath(path)),
      writeFile: (path, content) => writeFile(workspaceId, normalizeWorkspacePath(path), content),
      access: (path) => accessFile(workspaceId, normalizeWorkspacePath(path)),
    },
  };
  return { read, write, edit };
}
