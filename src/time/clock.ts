/**
 * Virtual clock.
 *
 * The whole sandbox reads "now" from here instead of `Date.now()`, and timers
 * are scheduled here instead of with the global `setTimeout`. That lets tests
 * fast-forward cooldowns, reminders, temp-bans and cache expiry with
 * {@link Clock.advance} instead of actually waiting.
 *
 * Real time still flows for network I/O (socket.io/express run on the real
 * event loop); only bot-facing scheduled logic is virtualised, and only when
 * the bot opts in by using the clock. By default the clock tracks real time so
 * that unmodified bots using `setTimeout` still behave normally.
 */

export type TimeInput = number | string;

interface VirtualTimer {
  id: number;
  fireAt: number;
  interval?: number;
  cb: () => void;
}

const UNITS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

/** Parse `"5m"`, `"1h30m"`, `"2d"`, or a raw millisecond number. */
export function parseDuration(input: TimeInput): number {
  if (typeof input === "number") return input;
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const re = /(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w)/g;
  let total = 0;
  let matched = false;
  let m: RegExpExecArray | null;
  while ((m = re.exec(trimmed))) {
    matched = true;
    total += parseFloat(m[1]) * UNITS[m[2]];
  }
  if (!matched) throw new Error(`Cannot parse duration: "${input}"`);
  return total;
}

export class Clock {
  private current: number;
  private timers: VirtualTimer[] = [];
  private nextTimerId = 1;

  constructor(startAt: number = Date.now()) {
    this.current = startAt;
  }

  /** Current virtual time in ms since epoch. Use this everywhere instead of Date.now(). */
  now(): number {
    return this.current;
  }

  /** Set the clock to an absolute time. */
  set(at: number): void {
    this.current = at;
  }

  /**
   * Schedule a one-shot virtual timer. Returns an id usable with {@link clear}.
   * Fires only when virtual time reaches `fireAt` via {@link advance}.
   */
  setTimeout(cb: () => void, delay: TimeInput): number {
    const id = this.nextTimerId++;
    this.timers.push({ id, fireAt: this.current + parseDuration(delay), cb });
    return id;
  }

  /** Schedule a repeating virtual timer. */
  setInterval(cb: () => void, every: TimeInput): number {
    const id = this.nextTimerId++;
    const interval = parseDuration(every);
    this.timers.push({ id, fireAt: this.current + interval, interval, cb });
    return id;
  }

  clear(id: number): void {
    this.timers = this.timers.filter((t) => t.id !== id);
  }

  /**
   * Advance virtual time by `amount`, firing every timer whose deadline is
   * crossed, in chronological order. Repeating timers re-arm.
   */
  advance(amount: TimeInput): void {
    const target = this.current + parseDuration(amount);
    // Fire due timers in order until we reach the target instant.
    // Guard against runaway intervals that would fire forever.
    let safety = 1_000_000;
    for (;;) {
      const due = this.timers
        .filter((t) => t.fireAt <= target)
        .sort((a, b) => a.fireAt - b.fireAt);
      if (due.length === 0) break;
      const timer = due[0];
      this.current = timer.fireAt;
      if (timer.interval) {
        timer.fireAt = this.current + timer.interval;
      } else {
        this.timers = this.timers.filter((t) => t.id !== timer.id);
      }
      timer.cb();
      if (--safety <= 0) throw new Error("Clock.advance: too many timer fires");
    }
    this.current = target;
  }

  /** Number of pending virtual timers. */
  get pending(): number {
    return this.timers.length;
  }
}
