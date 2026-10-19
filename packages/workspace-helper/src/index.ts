import { Client, credentials, Metadata, status, type ClientDuplexStream, type ServiceDefinition, type ServiceError } from "@grpc/grpc-js";
import { loadSync } from "@grpc/proto-loader";
import { fileURLToPath } from "node:url";

/** Runs a workspace process from a host terminal: `bun <cli> <socket> <user> <workdir> <argv...>`. */
export const workspaceHelperCliPath = fileURLToPath(new URL("./cli.ts", import.meta.url));

export type WorkspaceHelperUser = "agents-in-the-cloud" | "root";
export type WorkspaceHelperSignal = "SIGHUP" | "SIGINT" | "SIGTERM" | "SIGKILL";
export interface TerminalSize { cols: number; rows: number }

export interface WorkspaceExecStart {
  argv: string[];
  user: WorkspaceHelperUser;
  /** Absolute; defaults to /work. */
  workdir?: string;
  env?: Record<string, string>;
  /** Gives the process a stdin pipe. */
  stdin?: boolean;
  /** Runs the process on a PTY; output then arrives only on stdout. */
  terminal?: TerminalSize;
}

export type WorkspaceExit = { exitCode: number; signal?: undefined } | { exitCode?: undefined; signal: number };

/** An exit status the way shells report it, e.g. 137 for SIGKILL. */
export function exitStatus(exit: WorkspaceExit): number {
  return exit.signal === undefined ? exit.exitCode : 128 + exit.signal;
}

/** A process running in a workspace through its helper. */
export interface WorkspaceProcess {
  /** Applies backpressure to the process. Cancelling either stream cancels the call. */
  readonly stdout: ReadableStream<Uint8Array>;
  /** Buffers without limit, so ignoring it never stalls stdout. */
  readonly stderr: ReadableStream<Uint8Array>;
  /** Resolves after all output; rejects when the call fails. */
  readonly exited: Promise<WorkspaceExit>;
  write(data: string | Uint8Array): void;
  closeStdin(): void;
  signal(signal: WorkspaceHelperSignal): void;
  resize(size: TerminalSize): void;
  /** Ends the call, which kills the process group. */
  cancel(): void;
}

/** Starts a process in one particular workspace. */
export type StartWorkspaceProcess = (start: WorkspaceExecStart) => WorkspaceProcess;

export class WorkspaceHelperError extends Error {
  constructor(readonly code: status, message: string) {
    super(message);
    this.name = "WorkspaceHelperError";
  }
}

/** How a detached process ended. `unknown` means it exited while a restarted helper was no longer its parent. */
export type DetachedWorkspaceExit = WorkspaceExit | { exitCode?: undefined; signal?: undefined; unknown: true };

/** Output offsets: how many bytes of stdout and stderr a client has read. */
export interface WorkspaceOutputOffsets { stdout: number; stderr: number }

/** A process that outlives its call; see `startDetachedWorkspaceProcess`. */
export interface DetachedWorkspaceProcess {
  /** Applies backpressure to the call, not the process, which writes to disk. */
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: ReadableStream<Uint8Array>;
  /** Resolves once the process has exited and all its output arrived; the process is gone after that. Rejects when the call ends first, e.g. on `detach`. */
  readonly exited: Promise<DetachedWorkspaceExit>;
  write(data: string | Uint8Array): void;
  signal(signal: WorkspaceHelperSignal): void;
  /** The output before these offsets is no longer needed; the helper frees it, and attaching before them fails. */
  acknowledge(offsets: WorkspaceOutputOffsets): void;
  /** Ends this call. The process keeps running. */
  detach(): void;
}

type HelperSignal = (typeof signals)[WorkspaceHelperSignal];
/** ExecStart on the wire: how stdio connects is one explicit choice. */
type HelperStart = Pick<WorkspaceExecStart, "argv" | "workdir" | "env"> & { user: string } & (
  | { pipes: { stdin: boolean } }
  | { terminal: TerminalSize }
  | { detached: { name: string; stdin: boolean } }
);
/** Options for a detached process; it can't have a terminal. */
export type WorkspaceDetachedStart = Omit<WorkspaceExecStart, "terminal">;
type Acknowledge = { stdoutOffset: number; stderrOffset: number };
type ExecRequest =
  | { start: HelperStart }
  | { stdin: Uint8Array }
  | { closeStdin: Record<string, never> }
  | { signal: HelperSignal }
  | { resize: TerminalSize }
  | { acknowledge: Acknowledge };
type AttachRequest =
  | { attach: { name: string } & Acknowledge }
  | { stdin: Uint8Array }
  | { signal: HelperSignal }
  | { acknowledge: Acknowledge };
type Exited = { status: "exitCode"; exitCode: number } | { status: "signal"; signal: number } | { status: "unknown"; unknown: Record<string, never> };
type ExecResponse =
  | { response: "stdout"; stdout: Buffer }
  | { response: "stderr"; stderr: Buffer }
  | { response: "exited"; exited: Exited };
type HelperCall<Request> = ClientDuplexStream<Request, ExecResponse>;

const definition = loadSync(fileURLToPath(new URL("../proto/workspace_helper.proto", import.meta.url)), { longs: Number, enums: String, defaults: false, oneofs: true });
// SAFETY: workspace_helper.proto defines WorkspaceHelper as a service whose Exec and Attach stream ExecRequest and AttachRequest to ExecResponse, decoded with the options above.
const service = definition["agents_in_the_cloud.workspace_helper.v1.WorkspaceHelper"] as ServiceDefinition;
const execMethod = service.Exec!;
const attachMethod = service.Attach!;

const users = { "agents-in-the-cloud": "USER_AGENT", root: "USER_ROOT" } satisfies Record<WorkspaceHelperUser, string>;
const signals = { SIGHUP: "SIGNAL_HUP", SIGINT: "SIGNAL_INT", SIGTERM: "SIGNAL_TERM", SIGKILL: "SIGNAL_KILL" } satisfies Record<WorkspaceHelperSignal, string>;

const clients = new Map<string, Client>();

function client(socketPath: string): Client {
  let existing = clients.get(socketPath);
  if (!existing) {
    existing = new Client(`unix://${socketPath}`, credentials.createInsecure(), {
      // The helper is local; reconnect quickly once it is back, e.g. after a workspace restart.
      "grpc.initial_reconnect_backoff_ms": 100,
      "grpc.max_reconnect_backoff_ms": 1000,
    });
    clients.set(socketPath, existing);
  }
  return existing;
}

/** Drops the connection to a helper, e.g. once its workspace is gone. */
export function closeWorkspaceHelper(socketPath: string): void {
  clients.get(socketPath)?.close();
  clients.delete(socketPath);
}

function openCall<Request>(socketPath: string, method: typeof execMethod, waitForReady: boolean | undefined): HelperCall<Request> {
  return client(socketPath).makeBidiStreamRequest(method.path, method.requestSerialize, method.responseDeserialize, new Metadata({ waitForReady }), {});
}

/** The output and exit of one Exec or Attach call. */
function receive<Request>(call: HelperCall<Request>, signal: AbortSignal | undefined) {
  let stdout!: ReadableStreamDefaultController<Uint8Array>;
  let stderr!: ReadableStreamDefaultController<Uint8Array>;
  let outputCancelled = false;
  const cancelOutput = () => {
    outputCancelled = true;
    call.cancel();
  };
  const stdoutStream = new ReadableStream<Uint8Array>({
    start: (controller) => { stdout = controller; },
    // Paused calls stop reading, so HTTP/2 flow control holds the helper back.
    pull: () => { call.resume(); },
    cancel: cancelOutput,
  }, new ByteLengthQueuingStrategy({ highWaterMark: 1024 * 1024 }));
  const stderrStream = new ReadableStream<Uint8Array>({ start: (controller) => { stderr = controller; }, cancel: cancelOutput });
  let exit: DetachedWorkspaceExit | undefined;
  let finished = false;
  const abort = () => call.cancel();
  signal?.addEventListener("abort", abort, { once: true });

  const exited = new Promise<DetachedWorkspaceExit>((resolve, reject) => {
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener("abort", abort);
      if (error) {
        stdout.error(error);
        stderr.error(error);
        reject(error);
        return;
      }
      if (!outputCancelled) {
        stdout.close();
        stderr.close();
      }
      if (!exit) {
        reject(new WorkspaceHelperError(status.INTERNAL, "The workspace helper ended the call without an exit status"));
        return;
      }
      resolve(exit);
    };
    call.on("data", (response: ExecResponse) => {
      if (outputCancelled) return;
      switch (response.response) {
        case "stdout":
          stdout.enqueue(new Uint8Array(response.stdout));
          if (stdout.desiredSize! <= 0) call.pause();
          return;
        case "stderr": stderr.enqueue(new Uint8Array(response.stderr)); return;
        case "exited": {
          const exited = response.exited;
          exit = exited.status === "exitCode" ? { exitCode: exited.exitCode } : exited.status === "signal" ? { signal: exited.signal } : { unknown: true };
          return;
        }
      }
    });
    call.on("error", (error: ServiceError) => {
      if (error.code === status.CANCELLED && signal?.aborted) {
        finish(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason)));
        return;
      }
      finish(new WorkspaceHelperError(error.code, error.details || error.message));
    });
    call.on("end", () => finish());
  });
  // Callers that only use the output streams still learn about failures there.
  exited.catch(() => {});
  return {
    stdout: stdoutStream,
    stderr: stderrStream,
    exited,
    /** Sends a request unless the call is over. */
    send(request: Request) { if (!finished) call.write(request); },
  };
}

const encode = (data: string | Uint8Array) => data instanceof Uint8Array ? data : new TextEncoder().encode(data);
const acknowledgement = (offsets: WorkspaceOutputOffsets): Acknowledge => ({ stdoutOffset: offsets.stdout, stderrOffset: offsets.stderr });

/**
 * Starts a process in a workspace. `waitForReady` waits for a helper that is
 * still starting instead of failing at once; pair it with an abort signal.
 */
export function startWorkspaceProcess(socketPath: string, start: WorkspaceExecStart, options: { signal?: AbortSignal; waitForReady?: boolean } = {}): WorkspaceProcess {
  options.signal?.throwIfAborted();
  const { terminal, stdin, user, ...rest } = start;
  if (terminal && stdin) throw new Error("A terminal always takes input; stdin must be unset with one");
  const call = openCall<ExecRequest>(socketPath, execMethod, options.waitForReady);
  const received = receive(call, options.signal);
  call.write({ start: { ...rest, user: users[user], ...terminal ? { terminal } : { pipes: { stdin: stdin ?? false } } } });
  return {
    stdout: received.stdout,
    stderr: received.stderr,
    exited: received.exited.then((exit) => {
      if ("unknown" in exit) throw new WorkspaceHelperError(status.INTERNAL, "The workspace helper lost track of a process it should have reaped");
      return exit;
    }),
    write(data) { received.send({ stdin: encode(data) }); },
    closeStdin() { received.send({ closeStdin: {} }); },
    signal(signal) { received.send({ signal: signals[signal] }); },
    resize(size) { received.send({ resize: size }); },
    cancel() { call.cancel(); },
  };
}

/**
 * Starts a process that outlives this call, so `attachWorkspaceProcess` can
 * reconnect to it, e.g. after the app restarts. Its output goes to disk in the
 * workspace and its stdin never closes; stop it with `signal`. The call
 * streams the output from the start.
 */
export function startDetachedWorkspaceProcess(socketPath: string, name: string, start: WorkspaceDetachedStart, options: { signal?: AbortSignal; waitForReady?: boolean } = {}): DetachedWorkspaceProcess {
  options.signal?.throwIfAborted();
  const call = openCall<ExecRequest>(socketPath, execMethod, options.waitForReady);
  const received = receive(call, options.signal);
  const { stdin, user, ...rest } = start;
  call.write({ start: { ...rest, user: users[user], detached: { name, stdin: stdin ?? false } } });
  return detachedProcess(call, received);
}

/** Reconnects to a detached process, streaming its output from `offsets`. Fails with NOT_FOUND once the process is gone. */
export function attachWorkspaceProcess(socketPath: string, name: string, offsets: WorkspaceOutputOffsets, options: { signal?: AbortSignal; waitForReady?: boolean } = {}): DetachedWorkspaceProcess {
  options.signal?.throwIfAborted();
  const call = openCall<AttachRequest>(socketPath, attachMethod, options.waitForReady);
  const received = receive(call, options.signal);
  call.write({ attach: { name, ...acknowledgement(offsets) } });
  return detachedProcess(call, received);
}

function detachedProcess<Request extends ExecRequest | AttachRequest>(call: HelperCall<Request>, received: ReturnType<typeof receive<Request>>): DetachedWorkspaceProcess {
  // SAFETY: Exec and Attach requests share the stdin, signal and acknowledge shapes.
  const send = (request: ExecRequest & AttachRequest) => received.send(request as Request);
  return {
    stdout: received.stdout,
    stderr: received.stderr,
    exited: received.exited,
    write(data) { send({ stdin: encode(data) }); },
    signal(signal) { send({ signal: signals[signal] }); },
    acknowledge(offsets) { send({ acknowledge: acknowledgement(offsets) }); },
    detach() { call.cancel(); },
  };
}

const stdinChunkBytes = 64 * 1024;

export interface WorkspaceRunResult { exitCode: number; stdout: Buffer; stderr: Buffer }

/** Runs a process to completion, collecting its output. */
export async function runWorkspaceProcess(socketPath: string, start: Omit<WorkspaceExecStart, "stdin" | "terminal">, options: { stdin?: string | Uint8Array; signal?: AbortSignal; waitForReady?: boolean } = {}): Promise<WorkspaceRunResult> {
  const process = startWorkspaceProcess(socketPath, { ...start, stdin: options.stdin !== undefined }, options);
  if (options.stdin !== undefined) {
    const input = options.stdin instanceof Uint8Array ? options.stdin : new TextEncoder().encode(options.stdin);
    for (let offset = 0; offset < input.byteLength; offset += stdinChunkBytes) process.write(input.subarray(offset, offset + stdinChunkBytes));
    process.closeStdin();
  }
  const [stdout, stderr, exit] = await Promise.all([new Response(process.stdout).arrayBuffer(), new Response(process.stderr).arrayBuffer(), process.exited]);
  return { exitCode: exitStatus(exit), stdout: Buffer.from(stdout), stderr: Buffer.from(stderr) };
}

export { status as WorkspaceHelperStatus } from "@grpc/grpc-js";
