/**
 * The fake gateway: a real socket.io server.
 *
 * The SDK connects to this with its real `socket.io-client`, so at the wire
 * level there is nothing to distinguish it from `wss://nerimity.com`. The
 * gateway:
 *
 *   1. runs the `user:authenticate` -> `user:authenticated` handshake exactly
 *      as nerimity-server does, using the store's auth payload;
 *   2. subscribes to store domain events and forwards them to the sockets that
 *      should see them (server members / DM participants);
 *   3. injects faults on demand - latency, packet loss, duplicate packets,
 *      forced disconnects - so bots can test their reconnect/recovery logic.
 */
import { createServer, type Server as HttpServer } from "node:http";
import { Server as IOServer, type Socket } from "socket.io";
import type { Store } from "../model/store";
import type { Logger } from "../logging/logger";
import { ClientToServer, ServerToClient } from "./events";
import type { RawPresence } from "../model/rawTypes";

export interface FaultConfig {
  /** Extra latency added to every server->client emit, in ms. */
  latencyMs: number;
  /** Probability [0,1] that a server->client packet is silently dropped. */
  packetLossRate: number;
  /** Probability [0,1] that a server->client packet is delivered twice. */
  duplicateRate: number;
  /** When true, the next authenticate attempt fails with an auth error. */
  failNextAuth: boolean;
}

interface Conn {
  socket: Socket;
  userId?: string;
  serverIds: Set<string>;
}

export interface GatewayHooks {
  /** Called with (event, payload) for every emit that actually reaches a client. Used by the recorder. */
  onEmit?: (event: string, payload: unknown) => void;
  /** Called for every client->server packet. */
  onReceive?: (event: string, payload: unknown) => void;
}

export class Gateway {
  private http?: HttpServer;
  private io?: IOServer;
  private conns = new Map<string, Conn>();
  private unsubs: Array<() => void> = [];
  private port = 0;

  faults: FaultConfig = {
    latencyMs: 0,
    packetLossRate: 0,
    duplicateRate: 0,
    failNextAuth: false,
  };

  // When set, unknown tokens authenticate as this user. This is what lets a
  // completely unmodified bot (`client.login("paste token here")`) connect: any
  // token it sends maps to the sandbox's default bot identity.
  private defaultIdentity?: string;
  private acceptAnyToken = false;

  constructor(
    private store: Store,
    private logger: Logger,
    private hooks: GatewayHooks = {},
  ) {}

  get url(): string {
    return `http://localhost:${this.port}`;
  }

  get connectionCount(): number {
    return this.conns.size;
  }

  async start(): Promise<string> {
    this.http = createServer();
    this.io = new IOServer(this.http, {
      cors: { origin: "*" },
      // Match production: SDK connects with transports: ["websocket"].
      transports: ["websocket", "polling"],
    });

    this.io.on("connection", (socket) => this.onConnection(socket));
    this.subscribeStore();

    await new Promise<void>((resolve) => {
      this.http!.listen(0, "127.0.0.1", () => {
        const addr = this.http!.address();
        if (addr && typeof addr === "object") this.port = addr.port;
        resolve();
      });
    });
    this.logger.info("gateway", `gateway listening on ${this.url}`);
    return this.url;
  }

  async stop(): Promise<void> {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.conns.clear();
    await new Promise<void>((resolve) => {
      if (!this.io) return resolve();
      this.io.close(() => resolve());
    });
    await new Promise<void>((resolve) => {
      if (!this.http) return resolve();
      this.http.close(() => resolve());
    });
  }

  // ---- connection lifecycle ------------------------------------------------

  private onConnection(socket: Socket): void {
    const conn: Conn = { socket, serverIds: new Set() };
    this.conns.set(socket.id, conn);
    this.logger.debug("ws", `socket connected ${socket.id}`);

    socket.on(ClientToServer.AUTHENTICATE, (payload: { token?: string }) => {
      this.hooks.onReceive?.(ClientToServer.AUTHENTICATE, payload);
      this.handleAuthenticate(conn, payload?.token);
    });

    socket.on(ClientToServer.UPDATE_ACTIVITY, (activity: unknown) => {
      this.hooks.onReceive?.(ClientToServer.UPDATE_ACTIVITY, activity);
      if (conn.userId) {
        const presence: RawPresence = { userId: conn.userId, activity };
        this.store.setPresence(presence);
      }
    });

    socket.on(ClientToServer.NOTIFICATION_DISMISS, (payload: unknown) => {
      this.hooks.onReceive?.(ClientToServer.NOTIFICATION_DISMISS, payload);
    });

    socket.on("disconnect", (reason) => {
      this.conns.delete(socket.id);
      this.logger.debug("ws", `socket disconnected ${socket.id} (${reason})`);
    });
  }

  private handleAuthenticate(conn: Conn, token?: string): void {
    if (this.faults.failNextAuth) {
      this.faults.failNextAuth = false;
      this.logger.warn("gateway", "authenticate rejected (fault injection)");
      conn.socket.emit(ServerToClient.AUTHENTICATE_ERROR, {
        message: "Invalid token.",
      });
      return;
    }
    const userId =
      this.store.userIdForToken(token) ??
      (this.acceptAnyToken ? this.defaultIdentity : undefined);
    if (!userId) {
      this.logger.warn("gateway", "authenticate rejected (bad token)");
      conn.socket.emit(ServerToClient.AUTHENTICATE_ERROR, {
        message: "Invalid token.",
      });
      return;
    }

    conn.userId = userId;
    const payload = this.store.authPayloadFor(userId);
    for (const server of payload.servers) conn.serverIds.add(server.id);

    const fullPayload = {
      ...payload,
      messageMentions: [],
      friends: [],
      inbox: [],
      lastSeenServerChannelIds: {},
    };

    this.logger.info("gateway", `authenticated as ${payload.user.username} (${userId})`);
    this.deliver(conn, ServerToClient.AUTHENTICATED, fullPayload);
  }

  // ---- store event -> socket emit -----------------------------------------

  private subscribeStore(): void {
    const s = this.store;
    const to = ServerToClient;

    this.unsubs.push(
      s.on("messageCreated", (p) => this.broadcastChannel(p.message.channelId, to.MESSAGE_CREATED, p)),
      s.on("messageUpdated", (p) => this.broadcastChannel(p.channelId, to.MESSAGE_UPDATED, p)),
      s.on("messageDeleted", (p) => this.broadcastChannel(p.channelId, to.MESSAGE_DELETED, p)),
      s.on("reactionAdded", (p) => this.broadcastChannel(p.channelId, to.MESSAGE_REACTION_ADDED, p)),
      s.on("reactionRemoved", (p) => this.broadcastChannel(p.channelId, to.MESSAGE_REACTION_REMOVED, p)),
      s.on("typingStart", (p) => this.broadcastChannel(p.channelId, to.CHANNEL_TYPING, p)),
      s.on("buttonClicked", (p) => this.broadcastChannel(p.channelId, to.MESSAGE_BUTTON_CLICKED, p)),

      s.on("memberJoined", (p) => this.broadcastServer(p.serverId, to.SERVER_MEMBER_JOINED, p)),
      s.on("memberLeft", (p) => this.broadcastServer(p.serverId, to.SERVER_MEMBER_LEFT, p)),
      s.on("memberUpdated", (p) => this.broadcastServer(p.serverId, to.SERVER_MEMBER_UPDATED, p)),

      s.on("serverJoined", (p) => this.handleServerJoined(p)),
      s.on("serverLeft", (p) => this.handleServerLeft(p)),
      s.on("serverUpdated", (p) => this.broadcastServer(p.serverId, to.SERVER_UPDATED, p)),

      s.on("channelCreated", (p) => this.broadcastServer(p.serverId, to.SERVER_CHANNEL_CREATED, p)),
      s.on("channelUpdated", (p) => this.broadcastServer(p.serverId, to.SERVER_CHANNEL_UPDATED, p)),
      s.on("channelDeleted", (p) => this.broadcastServer(p.serverId, to.SERVER_CHANNEL_DELETED, p)),

      s.on("roleCreated", (p) => this.broadcastServer(p.serverId, to.SERVER_ROLE_CREATED, p)),
      s.on("roleUpdated", (p) => this.broadcastServer(p.serverId, to.SERVER_ROLE_UPDATED, p)),
      s.on("roleDeleted", (p) => this.broadcastServer(p.serverId, to.SERVER_ROLE_DELETED, p)),
      s.on("roleOrderUpdated", (p) => this.broadcastServer(p.serverId, to.SERVER_ROLE_ORDER_UPDATED, p)),

      s.on("presenceUpdate", (p) => this.broadcastAll(to.USER_PRESENCE_UPDATE, p)),
    );
  }

  private handleServerJoined(p: { server: { id: string } }): void {
    // The bot is now in this server; add it to every connection's room set,
    // then deliver the join payload.
    for (const conn of this.conns.values()) {
      if (!conn.userId) continue;
      if (this.store.getMember(p.server.id, conn.userId)) {
        conn.serverIds.add(p.server.id);
        this.deliver(conn, ServerToClient.SERVER_JOINED, p);
      }
    }
  }

  private handleServerLeft(p: { serverId: string }): void {
    for (const conn of this.conns.values()) {
      if (conn.serverIds.has(p.serverId)) {
        this.deliver(conn, ServerToClient.SERVER_LEFT, p);
        conn.serverIds.delete(p.serverId);
      }
    }
  }

  private broadcastServer(serverId: string, event: string, payload: unknown): void {
    for (const conn of this.conns.values()) {
      if (conn.serverIds.has(serverId)) this.deliver(conn, event, payload);
    }
  }

  private broadcastChannel(channelId: string, event: string, payload: unknown): void {
    const channel = this.store.channels.get(channelId);
    if (channel?.serverId) {
      this.broadcastServer(channel.serverId, event, payload);
    } else {
      // DM / unknown channel: deliver to every authenticated socket (the bot).
      for (const conn of this.conns.values()) {
        if (conn.userId) this.deliver(conn, event, payload);
      }
    }
  }

  private broadcastAll(event: string, payload: unknown): void {
    for (const conn of this.conns.values()) {
      if (conn.userId) this.deliver(conn, event, payload);
    }
  }

  // ---- fault-aware delivery ------------------------------------------------

  private deliver(conn: Conn, event: string, payload: unknown): void {
    const send = () => {
      if (!this.conns.has(conn.socket.id)) return;
      if (this.faults.packetLossRate > 0 && Math.random() < this.faults.packetLossRate) {
        this.logger.warn("ws", `dropped packet ${event} (fault injection)`);
        return;
      }
      conn.socket.emit(event, payload);
      this.hooks.onEmit?.(event, payload);
      this.logger.debug("ws", `-> ${event}`, payload);
      if (this.faults.duplicateRate > 0 && Math.random() < this.faults.duplicateRate) {
        conn.socket.emit(event, payload);
        this.hooks.onEmit?.(event, payload);
        this.logger.warn("ws", `duplicated packet ${event} (fault injection)`);
      }
    };
    if (this.faults.latencyMs > 0) setTimeout(send, this.faults.latencyMs);
    else send();
  }

  // ---- fault-injection controls -------------------------------------------

  setLatency(ms: number): void {
    this.faults.latencyMs = ms;
  }
  setPacketLoss(rate: number): void {
    this.faults.packetLossRate = clamp01(rate);
  }
  setDuplication(rate: number): void {
    this.faults.duplicateRate = clamp01(rate);
  }
  rejectNextAuth(): void {
    this.faults.failNextAuth = true;
  }

  /** Configure the fallback identity for unknown tokens (used by unmodified bots). */
  setDefaultIdentity(userId: string, acceptAnyToken: boolean): void {
    this.defaultIdentity = userId;
    this.acceptAnyToken = acceptAnyToken;
  }

  /** Low-level emit to every authenticated socket. Used by the recorder's replay. */
  emitRaw(event: string, payload: unknown): void {
    this.broadcastAll(event, payload);
  }

  /** Forcibly disconnect connected sockets, simulating a gateway drop. */
  disconnect(opts: { close?: boolean } = {}): void {
    for (const conn of this.conns.values()) {
      conn.socket.disconnect(opts.close ?? true);
    }
    this.logger.warn("gateway", "forced disconnect of all sockets");
  }
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
