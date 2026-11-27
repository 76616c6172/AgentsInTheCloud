import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  createAgentsInTheCloudEventBus,
  getAgentsInTheCloudRuntimeContext,
  writeJsonAtomic,
  type AgentsInTheCloudEventBus,
} from "@agents-in-the-cloud/core";
import {
  createWorkspace,
  deleteWorkspace,
  ensureWorkspaceStarted,
  generateWorkspaceId,
  isWorkspaceRunning,
  type WorkspaceProvisionRun,
} from "@agents-in-the-cloud/workspace";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

const poolStateSchema = Type.Object({
  version: Type.Literal(1),
  spareIds: Type.Array(Type.String()),
  threadContainers: Type.Record(Type.String(), Type.String()),
});

type PoolState = Static<typeof poolStateSchema>;

export interface HubContainerBackend {
  createContainer(id: string): Promise<void>;
  ensureRunning(id: string): Promise<void>;
  isRunning(id: string): Promise<boolean>;
  deleteContainer(id: string): Promise<void>;
}

function noopProvisionRun(): WorkspaceProvisionRun {
  const controller = new AbortController();
  return {
    signal: controller.signal,
    async step<T>(_id: string, _label: string, run: () => Promise<T> | T): Promise<T> {
      return await run();
    },
    report() {},
  };
}

export function createDockerHubContainerBackend(getEvents?: () => AgentsInTheCloudEventBus | undefined): HubContainerBackend {
  return {
    async createContainer(id: string): Promise<void> {
      const events = getEvents?.() ?? createAgentsInTheCloudEventBus();
      await createWorkspace({
        id,
        events,
        run: noopProvisionRun(),
        containerType: "hub",
      });
    },
    async ensureRunning(id: string): Promise<void> {
      if (await isWorkspaceRunning(id)) return;
      await ensureWorkspaceStarted(id);
    },
    async isRunning(id: string): Promise<boolean> {
      return await isWorkspaceRunning(id);
    },
    async deleteContainer(id: string): Promise<void> {
      await deleteWorkspace(id, { force: true, events: getEvents?.() });
    },
  };
}

export class HubContainerPool {
  private state: PoolState = { version: 1, spareIds: [], threadContainers: {} };
  private loaded = false;
  private warming?: Promise<string | undefined>;
  private readonly claimingByThread = new Map<string, Promise<string>>();
  private mutationTail: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(
    private readonly dataDir = getAgentsInTheCloudRuntimeContext().agentsInTheCloudDataDir,
    private readonly backend: HubContainerBackend = createDockerHubContainerBackend(),
    private readonly targetSpares = 1,
  ) {}

  private statePath(): string {
    return join(this.dataDir, "hub", "container-pool.json");
  }

  private async load(): Promise<PoolState> {
    if (this.loaded) return this.state;
    try {
      const raw = await readFile(this.statePath(), "utf8");
      this.state = Value.Parse(poolStateSchema, JSON.parse(raw));
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      this.state = { version: 1, spareIds: [], threadContainers: {} };
    }
    this.loaded = true;
    return this.state;
  }

  private async save(): Promise<void> {
    const path = this.statePath();
    await mkdir(dirname(path), { recursive: true });
    await writeJsonAtomic(path, this.state);
  }

  private serialize<T>(run: () => Promise<T>): Promise<T> {
    const next = this.mutationTail.then(run, run);
    this.mutationTail = next.then(() => {}, () => {});
    return next;
  }

  async getThreadContainerId(threadId: string): Promise<string | undefined> {
    const state = await this.load();
    return state.threadContainers[threadId];
  }

  async spareCount(): Promise<number> {
    const state = await this.load();
    return state.spareIds.length;
  }

  warmSpareInBackground(): void {
    if (this.disposed || this.targetSpares <= 0) return;
    void this.ensureWarmSpare().catch((error) => {
      console.warn("Could not warm spare Hub container:", error instanceof Error ? error.message : String(error));
    });
  }

  async ensureWarmSpare(): Promise<string | undefined> {
    if (this.disposed || this.targetSpares <= 0) return undefined;
    const state = await this.load();
    if (state.spareIds.length >= this.targetSpares) return state.spareIds[0];
    if (this.warming) return await this.warming;

    const pending = (async () => {
      const id = `hub-${generateWorkspaceId()}`;
      await this.backend.createContainer(id);
      if (this.disposed) {
        await this.backend.deleteContainer(id).catch(() => {});
        return undefined;
      }
      await this.serialize(async () => {
        await this.load();
        if (!this.state.spareIds.includes(id)) {
          this.state.spareIds = [...this.state.spareIds, id];
          await this.save();
        }
      });
      return id;
    })().finally(() => {
      if (this.warming === pending) this.warming = undefined;
    });
    this.warming = pending;
    return await pending;
  }

  async ensureThreadContainer(
    threadId: string,
    onProgress?: (message: string) => void | Promise<void>,
  ): Promise<string> {
    const inflight = this.claimingByThread.get(threadId);
    if (inflight) return await inflight;

    const claim = (async () => {
      const existing = await this.serialize(async () => {
        await this.load();
        return this.state.threadContainers[threadId];
      });
      if (existing) {
        if (!await this.backend.isRunning(existing)) {
          await onProgress?.("Waking Hub container…");
          await this.backend.ensureRunning(existing);
        }
        return existing;
      }

      const popSpare = async (): Promise<string | undefined> => this.serialize(async () => {
        await this.load();
        const spare = this.state.spareIds[0];
        if (!spare) return undefined;
        this.state.spareIds = this.state.spareIds.slice(1);
        this.state.threadContainers[threadId] = spare;
        await this.save();
        return spare;
      });

      let claimed = await popSpare();
      if (!claimed && this.warming) {
        await onProgress?.("Waiting for warm Hub container…");
        try {
          await this.warming;
          claimed = await popSpare();
        } catch {
          claimed = undefined;
        }
      }

      if (claimed) {
        try {
          await this.backend.ensureRunning(claimed);
          this.warmSpareInBackground();
          return claimed;
        } catch {
          await this.serialize(async () => {
            await this.load();
            if (this.state.threadContainers[threadId] === claimed) {
              delete this.state.threadContainers[threadId];
              await this.save();
            }
          });
        }
      }

      await onProgress?.("Starting Hub container…");
      const freshId = `hub-${generateWorkspaceId()}`;
      await this.backend.createContainer(freshId);
      await this.serialize(async () => {
        await this.load();
        this.state.threadContainers[threadId] = freshId;
        await this.save();
      });
      this.warmSpareInBackground();
      return freshId;
    })().finally(() => {
      if (this.claimingByThread.get(threadId) === claim) this.claimingByThread.delete(threadId);
    });

    this.claimingByThread.set(threadId, claim);
    return await claim;
  }

  async releaseThreadContainer(threadId: string): Promise<void> {
    const containerId = await this.serialize(async () => {
      await this.load();
      const id = this.state.threadContainers[threadId];
      if (!id) return undefined;
      delete this.state.threadContainers[threadId];
      await this.save();
      return id;
    });
    if (!containerId) return;
    await this.backend.deleteContainer(containerId);
  }

  dispose(): void {
    this.disposed = true;
  }
}
