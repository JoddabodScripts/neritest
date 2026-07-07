/**
 * Snowflake-ish numeric ID generation.
 *
 * Nerimity IDs are numeric strings, and the SDK relies on that: mentions are
 * parsed with `[@:([0-9]+)]` and commands with `/name:(\d+)`. Non-numeric IDs
 * would silently break mention/command detection, so every id NeriTest mints is
 * a monotonically increasing numeric string derived from the virtual clock.
 */
import type { Clock } from "./time/clock";

const EPOCH = 1_577_836_800_000; // 2020-01-01, arbitrary but stable

export class IdGenerator {
  private seq = 0;
  constructor(private clock: Clock) {}

  next(): string {
    const ms = Math.max(0, this.clock.now() - EPOCH);
    // 42 bits timestamp, 12 bits sequence - comfortably inside Number range
    // when stringified, and always strictly increasing within the sandbox.
    this.seq = (this.seq + 1) & 0xfff;
    const id = ms * 4096 + this.seq;
    return id.toString();
  }
}
