/**
 * Record / replay of sandbox traffic.
 *
 * While recording, every gateway packet (both directions) and every REST
 * request/response is captured with a timestamp. `save()` writes a portable
 * JSON session; `replay()` re-emits the recorded server->client packets to the
 * currently connected bot in order, reproducing exactly what the bot saw. Handy
 * for turning a captured production/session bug into a deterministic regression
 * test.
 */
import { readFileSync, writeFileSync } from "node:fs";

export type Direction = "out" | "in" | "api";

export interface RecordEntry {
  t: number; // ms offset from record start
  dir: Direction;
  event: string;
  payload: unknown;
}

export interface Session {
  version: 1;
  recordedAt: number;
  entries: RecordEntry[];
}

export interface ReplaySink {
  /** Emit a recorded server->client packet to all connected bots. */
  emit(event: string, payload: unknown): void;
}

export class Recorder {
  private recording = false;
  private startedAt = 0;
  private entries: RecordEntry[] = [];

  constructor(private nowFn: () => number) {}

  get isRecording(): boolean {
    return this.recording;
  }

  start(): void {
    this.recording = true;
    this.startedAt = this.nowFn();
    this.entries = [];
  }

  stop(): Session {
    this.recording = false;
    return this.toSession();
  }

  capture(dir: Direction, event: string, payload: unknown): void {
    if (!this.recording) return;
    this.entries.push({
      t: this.nowFn() - this.startedAt,
      dir,
      event,
      payload: clone(payload),
    });
  }

  toSession(): Session {
    return { version: 1, recordedAt: this.startedAt, entries: this.entries.slice() };
  }

  save(file: string): void {
    writeFileSync(file, JSON.stringify(this.toSession(), null, 2), "utf8");
  }

  static load(file: string): Session {
    return JSON.parse(readFileSync(file, "utf8")) as Session;
  }

  /**
   * Replay a session's server->client packets into a sink. With
   * `realtime: true` the original inter-packet timing is honoured; otherwise
   * packets are emitted back-to-back.
   */
  static async replay(
    session: Session | string,
    sink: ReplaySink,
    opts: { realtime?: boolean; speed?: number } = {},
  ): Promise<void> {
    const s = typeof session === "string" ? Recorder.load(session) : session;
    const speed = opts.speed ?? 1;
    let last = 0;
    for (const entry of s.entries) {
      if (entry.dir !== "out") continue;
      if (opts.realtime) {
        const wait = (entry.t - last) / speed;
        if (wait > 0) await sleep(wait);
        last = entry.t;
      }
      sink.emit(entry.event, entry.payload);
    }
  }
}

function clone<T>(v: T): T {
  try {
    return structuredClone(v);
  } catch {
    return JSON.parse(JSON.stringify(v ?? null));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
