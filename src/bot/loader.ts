/**
 * Connecting a real nerimity.js bot to the sandbox.
 *
 * The key idea: we never fake the SDK. We use the real `Client` and make it
 * connect to the sandbox's real socket.io + HTTP servers. Three entry points:
 *
 *   - createClient(): `new Client({ wsUrlOverride, apiUrlOverride })`, logged in.
 *   - mount(client):  repoint an already-constructed client.
 *   - loadBot(path):  patch the SDK's module-level endpoints, then import the
 *                     bot file so a vanilla `new Client()` connects here with
 *                     ZERO source changes.
 *
 * Endpoint patching uses the SDK's own `updateWsPath`/`updatePath` (exported
 * from its internal `serviceEndpoints` module), which is exactly how the SDK
 * itself repoints in its constructor.
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import type { Logger } from "../logging/logger";

// The SDK's `Client` is loosely typed here to avoid a hard build-time dependency
// on @nerimity/nerimity.js (it's a peer dependency, optional for non-bot use).
export interface NerimityClientLike {
  token?: string;
  socket: { io: { uri?: string; opts?: Record<string, unknown> }; connect?: () => void };
  login(token: string): void;
  user?: unknown;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
}

export interface NerimityModule {
  Client: new (opts?: {
    wsUrlOverride?: string;
    apiUrlOverride?: string;
    messageCacheLimit?: number;
  }) => NerimityClientLike;
  Events?: Record<string, string>;
}

interface ServiceEndpointsModule {
  updatePath: (p: string) => void;
  updateWsPath: (p: string) => void;
  path: string;
  wsPath: string;
}

export interface LoaderTargets {
  wsUrl: string;
  apiUrl: string;
  botToken: string;
}

export class BotLoader {
  private require = createRequire(path.join(process.cwd(), "index.js"));
  private endpointsPatched = false;
  private clients = new Set<NerimityClientLike>();

  constructor(
    private targets: LoaderTargets,
    private logger: Logger,
  ) {}

  /** Resolve the installed @nerimity/nerimity.js main module. */
  resolveModule(): NerimityModule {
    try {
      return this.require("@nerimity/nerimity.js") as NerimityModule;
    } catch (err) {
      throw new Error(
        "Could not load @nerimity/nerimity.js. Install it in your project " +
          "(`npm i @nerimity/nerimity.js`) to run real bots in the sandbox.\n" +
          (err as Error).message,
      );
    }
  }

  /**
   * Patch the SDK's module-level ws/api endpoints so any client constructed
   * afterwards (including inside a bot file) points at the sandbox.
   */
  patchEndpoints(): void {
    if (this.endpointsPatched) return;
    try {
      const endpoints = this.require(
        "@nerimity/nerimity.js/build/services/serviceEndpoints",
      ) as ServiceEndpointsModule;
      endpoints.updateWsPath(this.targets.wsUrl);
      endpoints.updatePath(this.targets.apiUrl);
      this.endpointsPatched = true;
      this.logger.info("system", "patched nerimity.js endpoints to sandbox");
    } catch (err) {
      this.logger.warn(
        "system",
        "could not patch SDK endpoints; use sandbox.createClient() instead",
        (err as Error).message,
      );
    }
  }

  /** Construct a real Client wired to the sandbox and log it in. */
  createClient(opts: { token?: string; messageCacheLimit?: number } = {}): NerimityClientLike {
    const mod = this.resolveModule();
    this.patchEndpoints();
    const client = new mod.Client({
      wsUrlOverride: this.targets.wsUrl,
      apiUrlOverride: this.targets.apiUrl,
      messageCacheLimit: opts.messageCacheLimit,
    });
    client.login(opts.token ?? this.targets.botToken);
    this.clients.add(client);
    this.logger.info("system", "created and logged in sandbox client");
    return client;
  }

  /** Repoint an already-constructed client at the sandbox and log it in. */
  mount(client: NerimityClientLike, opts: { token?: string } = {}): NerimityClientLike {
    this.patchEndpoints();
    // The client built its socket in its constructor with the default URL; if it
    // hasn't connected yet, repoint the manager URI so login() dials the sandbox.
    try {
      if (client.socket?.io) {
        client.socket.io.uri = this.targets.wsUrl;
        if (client.socket.io.opts) {
          (client.socket.io.opts as Record<string, unknown>).hostname = undefined;
          (client.socket.io.opts as Record<string, unknown>).port = undefined;
        }
      }
    } catch {
      /* best effort */
    }
    const token = opts.token ?? this.targets.botToken;
    // If the bot already set a token/logged in, override with the sandbox token.
    if (client.token && client.token !== token) {
      this.logger.debug("system", "overriding client token for sandbox");
    }
    client.login(token);
    this.clients.add(client);
    this.logger.info("system", "mounted existing client onto sandbox");
    return client;
  }

  /**
   * Disconnect every client this loader created/mounted, disabling reconnection
   * first so no reconnect timers keep the process alive after teardown.
   */
  disconnectAll(): void {
    for (const client of this.clients) {
      try {
        const socket = client.socket as unknown as {
          io?: { reconnection?: (v: boolean) => void };
          disconnect?: () => void;
          close?: () => void;
        };
        socket.io?.reconnection?.(false);
        socket.disconnect?.();
        socket.close?.();
      } catch {
        /* best effort */
      }
    }
    this.clients.clear();
  }

  /**
   * Import a bot entrypoint after patching endpoints. The bot's own
   * `new Client()` + `client.login(...)` will connect to the sandbox unchanged.
   */
  async loadBot(entry: string): Promise<unknown> {
    this.patchEndpoints();
    const abs = path.isAbsolute(entry) ? entry : path.resolve(process.cwd(), entry);
    this.logger.info("system", `loading bot from ${abs}`);

    // Track any client the bot constructs so teardown can disconnect it (the bot
    // never hands us its client reference). The module's `Client` export is a
    // getter-only property, so we wrap the prototype's `login` instead - every
    // bot calls it to connect.
    const mod = this.resolveModule();
    const proto = (mod.Client as unknown as { prototype: Record<string, unknown> }).prototype;
    const originalLogin = proto.login as (this: NerimityClientLike, token: string) => void;
    const self = this;
    proto.login = function (this: NerimityClientLike, token: string) {
      self.clients.add(this);
      return originalLogin.call(this, token);
    };

    try {
      // Dynamic import handles ESM and (via interop) CJS, and .ts under tsx/ts-node.
      return await import(pathToFileURL(abs).href);
    } finally {
      proto.login = originalLogin;
    }
  }
}
