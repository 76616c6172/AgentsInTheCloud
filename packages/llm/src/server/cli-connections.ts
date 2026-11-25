import type { AuthInteraction } from "@earendil-works/pi-ai";
import type { Account } from "./accounts.ts";

export interface CliModelConnection {
  id: string;
  label: string;
  agentLabel: string;
  account(): Promise<Account | undefined>;
  login(interaction: AuthInteraction): Promise<void>;
  disconnect(): Promise<void>;
}

const connections = new Map<string, CliModelConnection>();

export function registerCliModelConnection(connection: CliModelConnection): void {
  connections.set(connection.id, connection);
}

export function cliModelConnections(): CliModelConnection[] { return [...connections.values()]; }
export function cliModelConnection(id: string): CliModelConnection | undefined { return connections.get(id); }
