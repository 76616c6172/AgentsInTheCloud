/// <reference lib="dom" />

import { observableWebSocketUrl } from "@agents-in-the-cloud/observable-terminal/client";
import { composerSubmitKey, errorMessage, focusLikelyOpensSoftwareKeyboard, isWorkspacePaneVisible, isTextEntry, notifyInputListeners, setTextInputValue, type WorkspaceClientControllerConstructor } from "@agents-in-the-cloud/shared";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { type MicrophoneLease, SharedMicrophone } from "./microphone.ts";
import { VoiceRibbons } from "./voice-ribbon.ts";

type DictationState = "idle" | "loading" | "recording" | "finishing" | "error";
type AudioCapture = { context: AudioContext; processor: ScriptProcessorNode; analyser: AnalyserNode };
const dictationEventSchema = Type.Object({
  type: Type.String(),
  status: Type.Optional(Type.Union([Type.Literal("loading"), Type.Literal("error")])),
  message: Type.Optional(Type.String()),
  delta: Type.Optional(Type.String()),
  transcript: Type.Optional(Type.String()),
  error: Type.Optional(Type.Object({ message: Type.String() })),
  progress: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
});
type DictationEvent = Static<typeof dictationEventSchema>;
const trailingSilenceSeconds = 1;

function composeTranscript(prefix: string, spoken: string, suffix: string) {
  const left = prefix && spoken && !/\s$/.test(prefix) && !/^\s/.test(spoken) ? " " : "";
  const insertion = `${prefix}${left}${spoken}`;
  const right = spoken && suffix && !/\s$/.test(spoken) && !/^[\s,.;:!?)]/.test(suffix) ? " " : "";
  return { text: `${insertion}${right}${suffix}`, caret: insertion.length };
}

export function createDictationComposerController(Controller: WorkspaceClientControllerConstructor, microphoneSource: SharedMicrophone) {
  return class DictationComposerController extends Controller {
    static targets = ["button", "ribbon", "status", "error"];
    static values = { workspaceId: String, workspaceTemplateId: String };

    declare readonly workspaceIdValue: string;
    declare readonly workspaceTemplateIdValue: string;
    declare readonly buttonTargets: HTMLButtonElement[];
    declare readonly statusTargets: HTMLElement[];
    declare readonly errorTargets: HTMLElement[];

    private get input(): HTMLTextAreaElement {
      return this.element.querySelector<HTMLTextAreaElement>(".composer-input")!;
    }

    private get composer(): HTMLElement {
      return this.input.closest<HTMLElement>(".composer")!;
    }

    private state: DictationState = "idle";
    private socket?: WebSocket;
    private capture?: AudioCapture;
    private audioContext?: AudioContext;
    private microphone?: MicrophoneLease;
    private microphoneReady?: Promise<void>;
    private readonly levelSamples = new Float32Array(256);
    private readonly ribbons = new VoiceRibbons(() => this.voiceLevel());
    private prefix = "";
    private suffix = "";
    private committed = "";
    private partial = "";
    private submitPending = false;
    private pendingSubmitter?: HTMLButtonElement | HTMLInputElement;

    connect(): void {
      window.addEventListener("keydown", this.keydown);
      document.addEventListener("agents-in-the-cloud:workspace-pane-hidden", this.hidden);
      this.element.addEventListener("agent-composer:closing", this.closing);
    }

    ribbonTargetConnected(canvas: HTMLCanvasElement): void {
      this.ribbons.add(canvas);
    }

    ribbonTargetDisconnected(canvas: HTMLCanvasElement): void {
      this.ribbons.remove(canvas);
    }

    disconnect(): void {
      window.removeEventListener("keydown", this.keydown);
      document.removeEventListener("agents-in-the-cloud:workspace-pane-hidden", this.hidden);
      this.element.removeEventListener("agent-composer:closing", this.closing);
      this.closeSession();
      this.submitPending = false;
      this.pendingSubmitter = undefined;
      this.setState("idle", "Dictate");
    }

    private readonly hidden = (): void => {
      // A live morph can briefly hide the selected pane; only stop when it stays hidden.
      setTimeout(() => {
        if (this.element.isConnected && !this.element.closest("dialog[open]") && !isWorkspacePaneVisible(this.element)) this.closing();
      }, 0);
    };

    private readonly closing = (): void => {
      this.submitPending = false;
      this.pendingSubmitter = undefined;
      if (this.state === "recording") this.finish();
      else if (this.state === "loading") this.cancel();
    };

    private readonly keydown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || this.state === "idle" || this.state === "error") return;
      if (!this.element.closest("dialog[open]") && !isWorkspacePaneVisible(this.element)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        this.cancel();
        return;
      }
      if (!composerSubmitKey(event)) return;
      const target = event.target instanceof Element ? event.target : null;
      const otherEditor = target?.closest("input, textarea, select, [contenteditable='true']");
      if (otherEditor && !this.composer.contains(otherEditor)) return;
      event.preventDefault();
      const form = this.input.form!;
      const submitter = form.querySelector<HTMLButtonElement | HTMLInputElement>('button[type="submit"], button:not([type]), input[type="submit"]');
      form.requestSubmit(submitter ?? undefined);
    };

    submit(event: SubmitEvent): void {
      if (this.state === "idle" || this.state === "error") return;
      if (this.state === "loading" && this.input.value.trim()) {
        this.cancel();
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      this.submitPending = true;
      this.pendingSubmitter = event.submitter instanceof HTMLButtonElement || event.submitter instanceof HTMLInputElement
        ? event.submitter
        : undefined;
      if (this.state === "recording") this.finish();
      else if (this.state === "loading") this.setState("finishing", "Finishing…");
    }

    toggle(): void {
      if (this.state === "recording") {
        this.finish();
        return;
      }
      if (this.state === "loading") {
        this.cancel();
        return;
      }
      if (this.state === "finishing") return;
      this.start();
    }

    private start(): void {
      const selectionStart = this.input.selectionStart;
      const selectionEnd = this.input.selectionEnd;
      this.prefix = this.input.value.slice(0, selectionStart);
      this.suffix = this.input.value.slice(selectionEnd);
      this.committed = "";
      this.partial = "";
      this.submitPending = false;
      this.pendingSubmitter = undefined;
      this.setState("loading", "Preparing dictation model…");
      // Reveal without focusing the inert input: a single tap starts voice, not the keyboard.
      const focused = document.activeElement;
      this.element.dispatchEvent(new CustomEvent("dictation-composer:started", { bubbles: true }));
      this.input.blur();
      // A CLI's native terminal editor may own the keyboard instead of the composer.
      if (focused instanceof HTMLElement && this.element.contains(focused) && isTextEntry(focused)) focused.blur();
      this.setProgress(0);
      const query = this.workspaceIdValue ? `?workspaceId=${encodeURIComponent(this.workspaceIdValue)}`
        : this.workspaceTemplateIdValue ? `?workspaceTemplateId=${encodeURIComponent(this.workspaceTemplateIdValue)}` : "";
      const socket = new WebSocket(observableWebSocketUrl(`/dictation/realtime${query}`));
      this.socket = socket;
      // Permission and AudioContext activation belong to the user's gesture, not a later
      // socket event. Prepare them while the model starts, without sending audio yet.
      try {
        const context = new AudioContext();
        this.audioContext = context;
        this.microphoneReady = microphoneSource.acquire().then((microphone) => {
          if (this.socket !== socket) microphone.release();
          else this.microphone = microphone;
        });
        void Promise.all([context.resume(), this.microphoneReady]).catch((error) => {
          if (this.socket === socket) this.fail(errorMessage(error));
        });
      } catch (error) {
        this.fail(errorMessage(error));
        return;
      }
      socket.addEventListener("message", (event) => {
        if (this.socket !== socket) return;
        this.received(Value.Parse(dictationEventSchema, JSON.parse(String(event.data))));
      });
      socket.addEventListener("error", () => {
        if (this.socket === socket) this.fail("Could not connect to dictation");
      });
      socket.addEventListener("close", () => {
        if (this.socket !== socket) return;
        this.fail("Dictation disconnected. Your text is still here.");
      });
    }

    private received(event: DictationEvent): void {
      if (event.type === "agents-in-the-cloud.dictation.status") {
        if (event.status === "loading") {
          // A late loading update must not undo a queued finish/send.
          if (this.state === "finishing") return;
          this.setState("loading", event.message ?? "Preparing dictation model…");
          this.setProgress(event.progress ?? 0);
        }
        else if (event.status === "error") this.fail(event.message ?? "Dictation failed");
        return;
      }
      if (event.type === "session.created") {
        if (this.state === "finishing") this.commitAudio();
        else void this.startCapture();
      } else if (event.type.endsWith(".delta")) {
        this.partial += event.delta ?? "";
        this.renderTranscript();
      } else if (event.type.endsWith(".completed")) {
        const transcript = event.transcript ?? this.partial;
        const segment = `${this.committed && transcript ? " " : ""}${transcript}`;
        this.committed += segment;
        this.partial = "";
        this.renderTranscript();
        if (this.state === "finishing") this.dictationFinished();
      } else if (event.type === "error") {
        this.fail(event.error?.message ?? "Dictation failed");
      }
    }

    private async startCapture(): Promise<void> {
      const socket = this.socket;
      try {
        await this.microphoneReady;
        if (this.socket !== socket || socket?.readyState !== WebSocket.OPEN) return;
        if (this.state === "finishing") {
          this.commitAudio();
          return;
        }
        const microphone = this.microphone!;
        const context = this.audioContext!;
        const source = context.createMediaStreamSource(microphone.stream);
        const processor = context.createScriptProcessor(4096, 1, 1);
        const analyser = context.createAnalyser();
        const sink = context.createGain();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.72;
        sink.gain.value = 0;
        processor.onaudioprocess = (audioEvent) => {
          if (this.socket?.readyState !== WebSocket.OPEN || this.state !== "recording") return;
          const samples = audioEvent.inputBuffer.getChannelData(0);
          const pcm = new Int16Array(samples.length);
          for (let index = 0; index < samples.length; index += 1) {
            pcm[index] = Math.max(-32768, Math.min(32767, Math.round((samples[index] ?? 0) * 32767)));
          }
          this.socket.send(pcm.buffer);
        };
        source.connect(analyser);
        analyser.connect(processor);
        processor.connect(sink);
        sink.connect(context.destination);
        this.capture = { context, processor, analyser };
        this.socket?.send(JSON.stringify({
          type: "session.update",
          session: { sample_rate: context.sampleRate, language: "auto", automatic_punctuation: true },
        }));
        this.setState("recording", "Listening…");
      } catch (error) {
        if (this.socket === socket) this.fail(errorMessage(error));
      }
    }

    private finish(): void {
      this.setState("finishing", "Finishing…");
      const { sampleRate } = this.capture!.context;
      this.stopCapture();
      if (this.socket?.readyState !== WebSocket.OPEN) {
        this.fail("Dictation disconnected. Your text is still here.");
        return;
      }
      // The streaming model holds back its last words until it hears what follows; a commit alone drops them.
      this.socket.send(new Int16Array(Math.round(sampleRate * trailingSilenceSeconds)).buffer);
      this.commitAudio();
    }

    private commitAudio(): void {
      this.socket!.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    }

    private dictationFinished(): void {
      this.closeSession();
      this.setState("idle", "Dictate");
      if (!this.submitPending) {
        this.focusAfterDictation();
        return;
      }
      this.submitPending = false;
      const submitter = this.pendingSubmitter;
      this.pendingSubmitter = undefined;
      if (submitter) submitter.form!.requestSubmit(submitter);
      else this.input.form!.requestSubmit();
    }

    private focusAfterDictation(): void {
      if (focusLikelyOpensSoftwareKeyboard() || !this.input.checkVisibility()) return;
      if (!this.element.closest("dialog[open]") && !isWorkspacePaneVisible(this.element)) return;
      this.input.focus({ preventScroll: true });
      const { caret } = this.transcript();
      this.input.setSelectionRange(caret, caret);
    }

    private transcript() {
      return composeTranscript(this.prefix, `${this.committed}${this.partial}`, this.suffix);
    }

    private stopCapture(): void {
      this.microphone?.release();
      this.microphone = undefined;
      if (this.capture) this.capture.processor.onaudioprocess = null;
      if (this.audioContext && this.audioContext.state !== "closed") void this.audioContext.close();
      this.audioContext = undefined;
      this.microphoneReady = undefined;
      this.capture = undefined;
    }

    private renderTranscript(): void {
      // Empty progress deltas and silent sessions must not erase selected draft text.
      if (!this.committed && !this.partial) return;
      setTextInputValue(this.input, this.transcript().text);
      this.input.scrollTop = this.input.scrollHeight;
    }

    private voiceLevel(): number {
      if (!this.capture) return 0;
      this.capture.analyser.getFloatTimeDomainData(this.levelSamples);
      let energy = 0;
      for (const sample of this.levelSamples) energy += sample * sample;
      return Math.min(1, (Math.sqrt(energy / this.levelSamples.length) * 6) ** 0.8);
    }

    cancel(): void {
      this.closeSession();
      this.submitPending = false;
      this.pendingSubmitter = undefined;
      this.setState("idle", "Dictate");
      this.focusAfterDictation();
    }

    private closeSession(): void {
      this.stopCapture();
      this.socket?.close();
      this.socket = undefined;
    }

    private fail(message: string): void {
      this.closeSession();
      this.submitPending = false;
      this.pendingSubmitter = undefined;
      this.setState("error", message);
    }

    private setProgress(progress: number): void {
      this.ribbons.progress = progress / 100;
    }

    private setState(state: DictationState, label: string): void {
      const working = state === "loading" || state === "finishing";
      this.state = state;
      const actionLabel = state === "recording" ? "Done"
        : state === "loading" ? "Cancel"
        : state === "finishing" ? "Finishing…" : "Speak";
      for (const button of this.buttonTargets) {
        button.dataset.state = state;
        button.disabled = state === "finishing";
        button.toggleAttribute("aria-busy", working || state === "recording");
        button.ariaPressed = state === "recording" || state === "finishing" ? "true" : "false";
        button.title = actionLabel;
        button.setAttribute("aria-label", actionLabel);
      }
      this.ribbons.setState(state === "recording" ? "listening" : state === "error" ? "idle" : state);
      for (const status of this.statusTargets) status.textContent = label;
      for (const error of this.errorTargets) {
        error.hidden = state !== "error";
        if (state === "error") error.querySelector("p")!.textContent = label;
      }
      const dictating = state === "loading" || state === "recording" || state === "finishing";
      const dictationStateChanged = this.composer.hasAttribute("data-dictating") !== dictating;
      this.composer.toggleAttribute("data-dictating", dictating);
      this.input.readOnly = dictating;
      // Recognised words stream into the field; it can't take focus until dictation stops.
      this.input.inert = dictating;
      if (dictationStateChanged) notifyInputListeners(this.input);
      if (state === "finishing") this.setProgress(100);
      else if (!working) this.setProgress(0);
    }
  };
}
