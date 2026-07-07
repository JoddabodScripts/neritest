/**
 * The Sandbox: the single object that wires the whole emulator together.
 *
 * Construction is synchronous (so `const sandbox = createSandbox()` reads
 * nicely), but the gateway and API bind to real ports asynchronously. Anything
 * that a bot must connect to (`createClient`/`mount`/`loadBot`) awaits readiness
 * internally, and `await sandbox.ready()` is available if you want to be
 * explicit. World-side operations (create servers/users, send messages) work
 * against the store immediately and don't require the servers to be up.
 */
import { Clock, type TimeInput } from "./time/clock";
import { Logger, type LoggerOptions } from "./logging/logger";
import { Store } from "./model/store";
import { Gateway } from "./gateway/gateway";
import { ApiServer } from "./api/apiServer";
import { Recorder, type Session, type ReplaySink } from "./recorder/recorder";
import { Debugger } from "./debugger/debugger";
import { FetchShim } from "./bot/fetchShim";
import { BotLoader, type NerimityClientLike } from "./bot/loader";
import { ChannelType } from "./model/enums";
import {
  SandboxServer,
  SandboxUser,
  SandboxChannel,
} from "./facade";
import { builtinFixtures } from "./fixtures/index";
import type { RawUser } from "./model/rawTypes";

export interface SandboxOptions {
  /** Logging configuration; pass `{ console: true }` to see live traffic. */
  logging?: LoggerOptions;
  /** Virtual clock start time (ms since epoch). Default: now. */
  startTime?: number;
  /** Username for the default bot identity. Default "TestBot". */
  botUsername?: string;
  /**
   * Authenticate any unknown token as the default bot. Lets a fully unmodified
   * bot (`login("paste token here")`) connect. Default true.
   */
  acceptAnyToken?: boolean;
  /** Install the global fetch shim for hardcoded CDN/webhook hosts. Default true. */
  fetchShim?: boolean;
}

export interface CreateServerOptions {
  name: string;
  /** Server owner. Defaults to the sandbox bot (so the bot has creator permissions). */
  owner?: SandboxUser;
  /** Add the bot as a member if it isn't the owner. Default true. */
  botJoins?: boolean;
  /** Permission bitfield for the bot's auto-assigned role when it joins. Default: ADMIN. */
  botPermissions?: number;
  hexColor?: string;
}

export interface Recording {
  stop(): Session;
  save(file?: string): Session;
}

const ADMIN = 1;

export class Sandbox {
  readonly clock: Clock;
  readonly logs: Logger;
  readonly store: Store;
  readonly gateway: Gateway;
  readonly api: ApiServer;
  readonly debug: Debugger;

  private recorder: Recorder;
  private fetchShimInst?: FetchShim;
  private loader?: BotLoader;
  private botUser: SandboxUser;
  private botToken: string;
  private startPromise: Promise<void>;
  private started = false;
  private pendingRecordFile?: string;
  private opts: SandboxOptions;

  constructor(options: SandboxOptions = {}) {
    this.opts = options;
    this.clock = new Clock(options.startTime);
    this.logs = new Logger(() => this.clock.now(), options.logging);
    this.store = new Store(this.clock);
    this.recorder = new Recorder(() => this.clock.now());

    this.gateway = new Gateway(this.store, this.logs, {
      onEmit: (event, payload) => this.recorder.capture("out", event, payload),
      onReceive: (event, payload) => this.recorder.capture("in", event, payload),
    });
    this.api = new ApiServer(this.store, this.logs, {
      onRequest: (info) =>
        this.recorder.capture("api", `${info.method} ${info.path}`, {
          body: info.body,
          status: info.status,
          response: info.response,
        }),
    });
    this.debug = new Debugger(this.store, this.logs, () => this.gateway.connectionCount, () => this.clock.now());

    // Default bot identity.
    const rawBot = this.store.createUser({
      username: options.botUsername ?? "TestBot",
      bot: true,
    });
    this.botUser = new SandboxUser(this.store, rawBot);
    this.botToken = this.store.issueToken(rawBot.id);

    this.startPromise = this.start();
  }

  private async start(): Promise<void> {
    const [wsUrl, apiUrl] = await Promise.all([this.gateway.start(), this.api.start()]);
    const acceptAny = this.opts.acceptAnyToken ?? true;
    this.gateway.setDefaultIdentity(this.botUser.id, acceptAny);
    this.api.setDefaultIdentity(this.botUser.id, acceptAny);
    this.api.setDefaultToken(() => this.botToken);

    this.loader = new BotLoader({ wsUrl, apiUrl, botToken: this.botToken }, this.logs);

    if (this.opts.fetchShim ?? true) {
      this.fetchShimInst = new FetchShim(this.store, this.logs, { apiUrl });
      this.fetchShimInst.install();
    }
    this.started = true;
    this.logs.info("system", "sandbox ready");
  }

  /** Resolves once the gateway and API are listening. */
  async ready(): Promise<this> {
    await this.startPromise;
    return this;
  }

  get bot(): SandboxUser {
    return this.botUser;
  }
  get token(): string {
    return this.botToken;
  }
  get wsUrl(): string {
    return this.gateway.url;
  }
  get apiUrl(): string {
    return this.api.url;
  }

  // ---- world building ------------------------------------------------------

  createUser(input: { username: string } & Partial<RawUser>): SandboxUser {
    const raw = this.store.createUser(input);
    return new SandboxUser(this.store, raw);
  }

  createServer(opts: CreateServerOptions): SandboxServer {
    const owner = opts.owner ?? this.botUser;
    const { server } = this.store.createServer({
      name: opts.name,
      ownerId: owner.id,
      hexColor: opts.hexColor,
    });
    const sandServer = new SandboxServer(this.store, this.clock, server.id, this.botUser.id);

    // If the bot isn't the owner, add it as a member with a bot role so it can act.
    if (owner.id !== this.botUser.id && (opts.botJoins ?? true)) {
      const botRole = this.store.createRole({
        serverId: server.id,
        name: "Bot",
        permissions: opts.botPermissions ?? ADMIN,
        botRole: true,
        emit: false,
      });
      this.store.addMember(server.id, this.botUser.id, { roleIds: [botRole.id], emit: false });
    }

    // Deliver a serverJoined to the bot if it is already connected; otherwise it
    // arrives in the auth payload when the bot connects.
    this.store.emitServerJoined(server.id);
    return sandServer;
  }

  /** Open a DM channel between the bot and a user. */
  createDM(user: SandboxUser): SandboxChannel {
    const channel = this.store.createChannel({
      name: `dm-${user.username}`,
      type: ChannelType.DM_TEXT,
    });
    return new SandboxChannel(this.store, this.clock, channel.id);
  }

  /** Wrap an existing user id as a facade user. */
  user(id: string): SandboxUser | undefined {
    const raw = this.store.users.get(id);
    return raw ? new SandboxUser(this.store, raw) : undefined;
  }

  // ---- bot execution -------------------------------------------------------

  /** Construct a real nerimity.js Client wired to this sandbox and log it in. */
  async createClient(opts: { token?: string; messageCacheLimit?: number } = {}): Promise<NerimityClientLike> {
    await this.ready();
    return this.loader!.createClient(opts);
  }

  /** Repoint an already-constructed nerimity.js Client at this sandbox. */
  async mount(client: NerimityClientLike, opts: { token?: string } = {}): Promise<NerimityClientLike> {
    await this.ready();
    return this.loader!.mount(client, opts);
  }

  /** Import a bot entrypoint; its vanilla `new Client()` connects here unchanged. */
  async loadBot(entry: string): Promise<unknown> {
    await this.ready();
    return this.loader!.loadBot(entry);
  }

  // ---- time ----------------------------------------------------------------

  /** Advance the virtual clock, firing any scheduled timers. */
  advanceTime(amount: TimeInput): void {
    this.clock.advance(amount);
  }
  now(): number {
    return this.clock.now();
  }

  // ---- record / replay -----------------------------------------------------

  /** Begin recording gateway + API traffic. */
  record(file?: string): Recording {
    this.pendingRecordFile = file;
    this.recorder.start();
    this.logs.info("system", "recording started");
    return {
      stop: () => this.recorder.stop(),
      save: (f?: string) => {
        const session = this.recorder.stop();
        const target = f ?? file;
        if (target) this.recorder.save(target);
        return session;
      },
    };
  }

  /** Replay a recorded session's server->client packets to the connected bot. */
  async replay(
    session: Session | string,
    opts: { realtime?: boolean; speed?: number } = {},
  ): Promise<void> {
    await this.ready();
    const sink: ReplaySink = {
      emit: (event, payload) => this.gateway.emitRaw(event, payload),
    };
    this.logs.info("system", "replaying session");
    await Recorder.replay(session, sink, opts);
  }

  // ---- fixtures ------------------------------------------------------------

  /**
   * Run a fixture to pre-populate the sandbox. Accepts a builtin fixture name
   * or a custom builder function.
   */
  loadFixture<T>(fixture: string | ((sandbox: Sandbox) => T)): T {
    if (typeof fixture === "function") return fixture(this);
    const builder = builtinFixtures[fixture];
    if (!builder) {
      throw new Error(
        `Unknown fixture "${fixture}". Available: ${Object.keys(builtinFixtures).join(", ")}`,
      );
    }
    return builder(this) as T;
  }

  // ---- teardown ------------------------------------------------------------

  /** Stop servers, remove the fetch shim, and release ports. */
  async close(): Promise<void> {
    if (this.pendingRecordFile && this.recorder.isRecording) {
      this.recorder.save(this.pendingRecordFile);
    }
    this.loader?.disconnectAll();
    this.fetchShimInst?.uninstall();
    await Promise.all([this.gateway.stop(), this.api.stop()]);
    this.logs.info("system", "sandbox closed");
  }
}

/** Create and start a sandbox. Synchronous to construct; awaits ports lazily. */
export function createSandbox(options: SandboxOptions = {}): Sandbox {
  return new Sandbox(options);
}
