/**
 * Structured, filterable logging.
 *
 * Every subsystem logs through here with a category so tests can subscribe to
 * exactly the traffic they care about (`api`, `ws`, `event`, `permission`,
 * `timing`, `gateway`, `system`). The debugger and recorder are both just
 * listeners on this stream.
 */

export type LogCategory =
  | "api"
  | "ws"
  | "gateway"
  | "event"
  | "permission"
  | "timing"
  | "system";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  time: number;
  category: LogCategory;
  level: LogLevel;
  message: string;
  data?: unknown;
}

export interface LoggerOptions {
  /** Print to the console as entries arrive. Default false (silent). */
  console?: boolean;
  /** Only keep/emit these categories. Default: all. */
  categories?: LogCategory[];
  /** Minimum level to keep. Default "debug". */
  level?: LogLevel;
  /** How many entries to retain in the ring buffer. Default 5000. */
  bufferSize?: number;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const COLORS: Record<LogCategory, string> = {
  api: "\x1b[38;5;208m", // orange
  ws: "\x1b[38;5;214m",
  gateway: "\x1b[38;5;220m",
  event: "\x1b[36m",
  permission: "\x1b[35m",
  timing: "\x1b[90m",
  system: "\x1b[37m",
};
const RESET = "\x1b[0m";

export type LogListener = (entry: LogEntry) => void;

export class Logger {
  private buffer: LogEntry[] = [];
  private listeners = new Set<LogListener>();
  private opts: Required<LoggerOptions>;

  constructor(
    private nowFn: () => number,
    options: LoggerOptions = {},
  ) {
    this.opts = {
      console: options.console ?? false,
      categories: options.categories ?? [
        "api",
        "ws",
        "gateway",
        "event",
        "permission",
        "timing",
        "system",
      ],
      level: options.level ?? "debug",
      bufferSize: options.bufferSize ?? 5000,
    };
  }

  configure(options: Partial<LoggerOptions>): void {
    this.opts = { ...this.opts, ...options } as Required<LoggerOptions>;
  }

  log(
    category: LogCategory,
    level: LogLevel,
    message: string,
    data?: unknown,
  ): void {
    if (!this.opts.categories.includes(category)) return;
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.opts.level]) return;

    const entry: LogEntry = { time: this.nowFn(), category, level, message, data };
    this.buffer.push(entry);
    if (this.buffer.length > this.opts.bufferSize) this.buffer.shift();

    if (this.opts.console) this.print(entry);
    for (const l of this.listeners) l(entry);
  }

  debug(c: LogCategory, m: string, d?: unknown) {
    this.log(c, "debug", m, d);
  }
  info(c: LogCategory, m: string, d?: unknown) {
    this.log(c, "info", m, d);
  }
  warn(c: LogCategory, m: string, d?: unknown) {
    this.log(c, "warn", m, d);
  }
  error(c: LogCategory, m: string, d?: unknown) {
    this.log(c, "error", m, d);
  }

  private print(e: LogEntry): void {
    const color = COLORS[e.category] ?? "";
    const tag = `${color}[${e.category}]${RESET}`;
    const line = `${tag} ${e.message}`;
    if (e.level === "error") console.error(line, e.data ?? "");
    else if (e.level === "warn") console.warn(line, e.data ?? "");
    else console.log(line, e.data ?? "");
  }

  /** Subscribe to the live log stream. Returns an unsubscribe function. */
  onLog(listener: LogListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Snapshot of retained entries, optionally filtered. */
  entries(filter?: {
    category?: LogCategory | LogCategory[];
    level?: LogLevel;
  }): LogEntry[] {
    let out = this.buffer.slice();
    if (filter?.category) {
      const cats = Array.isArray(filter.category)
        ? filter.category
        : [filter.category];
      out = out.filter((e) => cats.includes(e.category));
    }
    if (filter?.level) {
      out = out.filter((e) => LEVEL_ORDER[e.level] >= LEVEL_ORDER[filter.level!]);
    }
    return out;
  }

  clear(): void {
    this.buffer = [];
  }
}
