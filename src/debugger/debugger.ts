/**
 * Optional live debugger.
 *
 * `attach()` streams sandbox activity (log entries) to the console as it
 * happens, so you can watch gateway packets, API calls, events and permission
 * checks flow while a bot runs. `renderState()` prints the whole world - servers,
 * channels, members, roles, recent messages, presences - as a tree snapshot.
 * `snapshot()` returns the same data structured, for a custom UI.
 *
 * It's a plain console renderer (no TUI dependency) so it works over SSH, in CI
 * logs, and in any terminal. Accent colour is orange, matching house style.
 */
import type { Store } from "../model/store";
import type { Logger, LogEntry } from "../logging/logger";
import { ChannelType } from "../model/enums";

const ORANGE = "\x1b[38;5;208m";
const DIM = "\x1b[90m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

export interface DebuggerSnapshot {
  time: number;
  users: { id: string; username: string; bot: boolean; presence?: unknown }[];
  servers: {
    id: string;
    name: string;
    channels: { id: string; name: string; type: string; messageCount: number }[];
    roles: { id: string; name: string; permissions: number }[];
    members: { id: string; username: string; roleIds: string[] }[];
  }[];
  connections: number;
}

export class Debugger {
  private detach?: () => void;

  constructor(
    private store: Store,
    private logger: Logger,
    private connectionCount: () => number,
    private nowFn: () => number = () => Date.now(),
  ) {}

  /** Start streaming live activity to the console. Returns a stop function. */
  attach(opts: { filter?: LogEntry["category"][] } = {}): () => void {
    this.printBanner();
    this.detach?.();
    this.detach = this.logger.onLog((entry) => {
      if (opts.filter && !opts.filter.includes(entry.category)) return;
      this.printEntry(entry);
    });
    return () => this.stop();
  }

  stop(): void {
    this.detach?.();
    this.detach = undefined;
  }

  private printBanner(): void {
    // eslint-disable-next-line no-console
    console.log(`${ORANGE}${BOLD}┌─ NeriTest debugger ─ live ─┐${RESET}`);
  }

  private printEntry(e: LogEntry): void {
    const t = new Date(e.time).toISOString().slice(11, 23);
    const cat = `${ORANGE}${e.category.padEnd(10)}${RESET}`;
    // eslint-disable-next-line no-console
    console.log(`${DIM}${t}${RESET} ${cat} ${e.message}`);
  }

  snapshot(): DebuggerSnapshot {
    const users = [...this.store.users.values()].map((u) => ({
      id: u.id,
      username: u.username,
      bot: !!u.bot,
      presence: this.store.presences.get(u.id),
    }));
    const servers = [...this.store.servers.values()].map((s) => ({
      id: s.id,
      name: s.name,
      channels: this.store.channelsForServer(s.id).map((c) => ({
        id: c.id,
        name: c.name,
        type: ChannelType[c.type],
        messageCount: this.store.messagesForChannel(c.id).length,
      })),
      roles: this.store.rolesForServer(s.id).map((r) => ({
        id: r.id,
        name: r.name,
        permissions: r.permissions,
      })),
      members: this.store.membersForServer(s.id).map((m) => ({
        id: m.userId,
        username: this.store.users.get(m.userId)?.username ?? m.userId,
        roleIds: m.roleIds,
      })),
    }));
    return {
      time: this.nowFn(),
      users,
      servers,
      connections: this.connectionCount(),
    };
  }

  /** Print a full tree snapshot of the current sandbox state. */
  renderState(): void {
    const snap = this.snapshot();
    const lines: string[] = [];
    lines.push(`${ORANGE}${BOLD}NeriTest state${RESET} ${DIM}(${snap.connections} bot connection(s))${RESET}`);
    lines.push(`${BOLD}Users${RESET} (${snap.users.length})`);
    for (const u of snap.users) {
      lines.push(`  ${u.bot ? ORANGE + "◆" + RESET : "○"} ${u.username} ${DIM}${u.id}${RESET}`);
    }
    for (const s of snap.servers) {
      lines.push(`${BOLD}Server${RESET} ${ORANGE}${s.name}${RESET} ${DIM}${s.id}${RESET}`);
      lines.push(`  ${DIM}roles:${RESET} ${s.roles.map((r) => r.name).join(", ")}`);
      lines.push(`  ${DIM}members:${RESET} ${s.members.map((m) => m.username).join(", ")}`);
      for (const c of s.channels) {
        lines.push(`  # ${c.name} ${DIM}[${c.type}] ${c.messageCount} msg${RESET}`);
      }
    }
    // eslint-disable-next-line no-console
    console.log(lines.join("\n"));
  }
}
