import { createConnection } from "node:net";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { hostSocketPath, type HostReply, type HostCommand, type HostResults } from "../protocol.ts";

export const hostAvailable = () => existsSync(hostSocketPath);
export function hostRequest<Command extends HostCommand>(request: Command, socketPath = hostSocketPath): Promise<HostResults[Command["operation"]]> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    const lines = createInterface({ input: socket });
    let settled = false;
    socket.setTimeout(15000, () => socket.destroy(new Error("Host request timed out")));
    socket.on("connect", () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on("error", reject);
    socket.on("close", () => { lines.close(); if (!settled) reject(new Error("Host disconnected before responding")); });
    lines.once("line", line => {
      settled = true;
      try {
        const reply: HostReply = JSON.parse(line);
        if (reply.type === "error") reject(new Error(reply.message));
        else {
          // SAFETY: The private System protocol returns the result associated with this command.
          resolve(reply.value as HostResults[Command["operation"]]);
        }
      } catch (error) { reject(error); }
      socket.end();
    });
  });
}
