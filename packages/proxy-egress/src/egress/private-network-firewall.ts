import dns from "node:dns/promises";
import { isIP } from "node:net";
import type { AgentsInTheCloudEventBus } from "@agents-in-the-cloud/core";
import { hostAvailable, hostRequest } from "@agents-in-the-cloud/host/connection";
import { isPrivateNetworkAddress } from "@agents-in-the-cloud/shared/egress-policy";
import { listWorkspaces, workspaceBridgeName } from "@agents-in-the-cloud/workspace";
import { effectivePrivateNetworkAccess, formatPrivateNetworkDestination, onWorkspaceTemplateStoreChanged, workspaceTemplateIdOfInit, type PrivateNetworkDestination } from "@agents-in-the-cloud/workspace-templates";

type FirewallDestination = { bridge: string; address: string; port: number };
type ResolveHost = (host: string) => Promise<string[]>;

/** Re-resolve listed hostnames this often, so the firewall follows DNS changes. */
const refreshInterval = 60_000;

// Every sync repeats the same problems; report each one once.
const reported = new Set<string>();
function report(message: string): void {
  if (reported.has(message)) return;
  reported.add(message);
  console.error(message);
}

const resolveHost: ResolveHost = async (host) => isIP(host) ? [host] : (await dns.lookup(host, { all: true, family: 4 })).map(({ address }) => address);

/** The firewall entries for each workspace's listed destinations. Only private IPv4
 * addresses are opened; workspace bridges have no IPv6. An unresolvable host is
 * reported and skipped so it can't hold back every other workspace's access. */
export async function privateNetworkFirewallDestinations(workspaces: ReadonlyMap<string, PrivateNetworkDestination[]>, resolve: ResolveHost = resolveHost): Promise<FirewallDestination[]> {
  const addresses = new Map<string, Promise<string[] | undefined>>();
  const lookup = (host: string) => {
    let pending = addresses.get(host);
    if (!pending) {
      pending = resolve(host).catch((error) => {
        report(`Private network access: could not resolve ${host}: ${String(error)}`);
        return undefined;
      });
      addresses.set(host, pending);
    }
    return pending;
  };
  const entries = await Promise.all([...workspaces].flatMap(([workspaceId, destinations]) => destinations.map(async (destination) => {
    const addresses = await lookup(destination.host);
    if (!addresses) return [];
    const resolved = addresses.filter((address) => isIP(address) === 4 && isPrivateNetworkAddress(address));
    if (!resolved.length) report(`Private network access: ${formatPrivateNetworkDestination(destination)} has no private IPv4 address; direct connections stay blocked`);
    return resolved.map((address) => ({ bridge: workspaceBridgeName(workspaceId), address, port: destination.port }));
  })));
  return entries.flat();
}

/** Keeps System's firewall in step with Private network access. Without System
 * (development and nested installations) there is no firewall to update; the
 * egress proxy enforces the same list for HTTP either way. */
export async function startPrivateNetworkFirewallSync(events: AgentsInTheCloudEventBus): Promise<void> {
  if (!hostAvailable()) return;
  const workspaceTemplates = new Map<string, string | undefined>();
  for (const workspace of (await listWorkspaces({ inspectImages: false })).workspaces) workspaceTemplates.set(workspace.id, workspaceTemplateIdOfInit(workspace.init));

  let running: Promise<void> | undefined;
  let pending = false;
  const sync = async () => {
    const workspaces = new Map<string, PrivateNetworkDestination[]>();
    for (const [workspaceId, workspaceTemplateId] of workspaceTemplates) workspaces.set(workspaceId, await effectivePrivateNetworkAccess(workspaceTemplateId));
    await hostRequest({ operation: "private-network-access", destinations: await privateNetworkFirewallDestinations(workspaces) });
  };
  // One update at a time; changes arriving meanwhile coalesce into one more.
  const schedule = () => {
    if (running) { pending = true; return; }
    running = sync()
      .catch((error) => console.error("Private network access: could not update the System firewall", error))
      .finally(() => {
        running = undefined;
        if (pending) { pending = false; schedule(); }
      });
  };

  // A workspace's bridge name is fixed by its ID, so its entries can be added before Docker creates the bridge.
  events.on("workspace_plan_prepare", ({ workspaceId, init }) => { workspaceTemplates.set(workspaceId, workspaceTemplateIdOfInit(init)); schedule(); });
  events.on("workspace_deleted", ({ workspaceId }) => { workspaceTemplates.delete(workspaceId); schedule(); });
  onWorkspaceTemplateStoreChanged(schedule);
  const timer = setInterval(schedule, refreshInterval);
  events.on("agents_in_the_cloud_host_stopping", () => clearInterval(timer));
  schedule();
}
