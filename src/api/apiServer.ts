/**
 * The fake REST API: a real express server.
 *
 * The SDK's `request()` helper does plain `fetch()` against `apiUrl + "/api"`,
 * so pointing it here (via `apiUrlOverride`) makes every REST call - send/edit/
 * delete message, ban/kick, posts, bot commands, button callbacks, webhooks -
 * hit real HTTP handlers that mutate the same store the gateway reads from.
 *
 * Endpoints, response bodies and error shapes are matched to nerimity-server so
 * a bot's success and failure paths behave identically to production. Fault
 * injection (rate limits, forced failures, latency, hangs) lets bots exercise
 * their retry/backoff logic.
 */
import express, { type Express, type Request, type Response } from "express";
import { createServer, type Server as HttpServer } from "node:http";
import type { Store } from "../model/store";
import type { Logger } from "../logging/logger";
import { generateError } from "./errors";
import { RolePermissions } from "../model/permissions";
import type { RawAttachment } from "../model/rawTypes";

export interface ApiFault {
  status: number;
  body: unknown;
}

export interface ApiHooks {
  onRequest?: (info: { method: string; path: string; body: unknown; status: number; response: unknown }) => void;
}

export class ApiServer {
  private app: Express;
  private http?: HttpServer;
  private port = 0;

  private latencyMs = 0;
  private failQueue: ApiFault[] = [];
  private rateLimitRemaining = 0;
  private rateLimitRetryAfter = 5000;
  private hangQueue: number[] = [];
  private defaultToken?: () => string;
  private defaultUserId?: string;
  private acceptAnyToken = false;

  constructor(
    private store: Store,
    private logger: Logger,
    private hooks: ApiHooks = {},
  ) {
    this.app = express();
    this.app.use(express.json({ limit: "10mb" }));
    this.registerRoutes();
  }

  get url(): string {
    return `http://localhost:${this.port}`;
  }

  async start(): Promise<string> {
    this.http = createServer(this.app);
    await new Promise<void>((resolve) => {
      this.http!.listen(0, "127.0.0.1", () => {
        const addr = this.http!.address();
        if (addr && typeof addr === "object") this.port = addr.port;
        resolve();
      });
    });
    this.logger.info("api", `api listening on ${this.url}/api`);
    return this.url;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (!this.http) return resolve();
      this.http.close(() => resolve());
    });
  }

  // ---- fault injection -----------------------------------------------------

  setLatency(ms: number): void {
    this.latencyMs = ms;
  }
  failNext(status: number, body: unknown): void {
    this.failQueue.push({ status, body });
  }
  rateLimit(opts: { requests?: number; retryAfterMs?: number } = {}): void {
    this.rateLimitRemaining = opts.requests ?? 1;
    this.rateLimitRetryAfter = opts.retryAfterMs ?? 5000;
  }
  hangNext(ms = 30000): void {
    this.hangQueue.push(ms);
  }

  setDefaultToken(fn: () => string): void {
    this.defaultToken = fn;
  }

  /** Mirror the gateway: authenticate unknown tokens as the default bot (for unmodified bots). */
  setDefaultIdentity(userId: string, acceptAnyToken: boolean): void {
    this.defaultUserId = userId;
    this.acceptAnyToken = acceptAnyToken;
  }

  // ---- direct request helpers (sandbox.api.get/post/...) -------------------

  /** Issue a raw request against the fake API, authenticated as the default bot. */
  async request<T = unknown>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    apiPath: string,
    body?: unknown,
  ): Promise<{ status: number; body: T }> {
    const url = `${this.url}${apiPath.startsWith("/") ? "" : "/"}${apiPath}`;
    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: this.defaultToken?.() ?? "",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* leave as text */
    }
    return { status: res.status, body: parsed as T };
  }

  get<T = unknown>(apiPath: string) {
    return this.request<T>("GET", apiPath);
  }
  post<T = unknown>(apiPath: string, body?: unknown) {
    return this.request<T>("POST", apiPath, body);
  }
  patch<T = unknown>(apiPath: string, body?: unknown) {
    return this.request<T>("PATCH", apiPath, body);
  }
  delete<T = unknown>(apiPath: string) {
    return this.request<T>("DELETE", apiPath);
  }

  // ---- middleware ----------------------------------------------------------

  private userId(req: Request): string | undefined {
    const token = req.header("authorization") || undefined;
    return (
      this.store.userIdForToken(token) ??
      (this.acceptAnyToken ? this.defaultUserId : undefined)
    );
  }

  /**
   * Applies fault injection. Returns true if the request was handled by a fault
   * (and the caller should stop).
   */
  private async faultGate(req: Request, res: Response): Promise<boolean> {
    if (this.hangQueue.length) {
      const ms = this.hangQueue.shift()!;
      this.logger.warn("api", `hanging request ${req.method} ${req.path} for ${ms}ms`);
      await sleep(ms);
    }
    if (this.latencyMs > 0) await sleep(this.latencyMs);

    if (this.rateLimitRemaining > 0) {
      this.rateLimitRemaining--;
      const body = {
        ...generateError("You are being rate limited."),
        retryAfter: this.rateLimitRetryAfter,
        ttl: this.rateLimitRetryAfter,
      };
      res.setHeader("Retry-After", Math.ceil(this.rateLimitRetryAfter / 1000).toString());
      this.respond(req, res, 429, body);
      return true;
    }
    if (this.failQueue.length) {
      const fault = this.failQueue.shift()!;
      this.respond(req, res, fault.status, fault.body);
      return true;
    }
    return false;
  }

  private respond(req: Request, res: Response, status: number, body: unknown): void {
    res.status(status).json(body);
    this.logger.info("api", `${req.method} ${req.path} -> ${status}`, body);
    this.hooks.onRequest?.({
      method: req.method,
      path: req.path,
      body: req.body,
      status,
      response: body,
    });
  }

  // ---- routes --------------------------------------------------------------

  private registerRoutes(): void {
    const app = this.app;
    const gate = (fn: (req: Request, res: Response) => void) => {
      return async (req: Request, res: Response) => {
        try {
          if (await this.faultGate(req, res)) return;
          fn(req, res);
        } catch (err) {
          this.respond(req, res, 500, generateError((err as Error).message));
        }
      };
    };

    // --- messages ---
    app.get("/api/channels/:channelId/messages", gate((req, res) => {
      if (!this.requireAuth(req, res)) return;
      const list = this.store.messagesForChannel(req.params.channelId);
      const limit = Number(req.query.limit ?? 50);
      this.respond(req, res, 200, list.slice(-limit).reverse());
    }));

    app.get("/api/channels/:channelId/messages/:messageId", gate((req, res) => {
      if (!this.requireAuth(req, res)) return;
      const msg = this.store.messages.get(req.params.messageId);
      this.respond(req, res, 200, msg ?? null);
    }));

    app.post("/api/channels/:channelId/messages", gate((req, res) => {
      const userId = this.requireAuth(req, res);
      if (!userId) return;
      const { channelId } = req.params;
      const channel = this.store.channels.get(channelId);
      if (!channel) {
        return this.respond(req, res, 404, generateError("Channel not found."));
      }
      const body = req.body ?? {};
      const hasAttachment = !!body.nerimityCdnFileId || !!body.attachment;
      if (!body.content && !hasAttachment) {
        return this.respond(req, res, 400, generateError("content or attachment is required."));
      }
      if (
        channel.serverId &&
        !this.store.memberHasPermission(channel.serverId, userId, RolePermissions.SEND_MESSAGE)
      ) {
        this.logger.warn("permission", `${userId} lacks SEND_MESSAGE in ${channelId}`);
        return this.respond(req, res, 403, generateError("You are not allowed to send messages in this channel."));
      }

      const attachments: RawAttachment[] = [];
      if (body.nerimityCdnFileId) {
        attachments.push({
          id: this.store.ids.next(),
          provider: "local",
          fileId: body.nerimityCdnFileId,
          createdAt: Date.now(),
        });
      }

      const message = this.store.createMessage({
        channelId,
        createdById: userId,
        content: body.content,
        htmlEmbed: body.htmlEmbed,
        buttons: body.buttons,
        silent: body.silent,
        mentionReplies: body.mentionReplies,
        replyToMessageIds: body.replyToMessageIds,
        attachments: attachments.length ? attachments : undefined,
      });
      this.respond(req, res, 200, message);
    }));

    app.patch("/api/channels/:channelId/messages/:messageId", gate((req, res) => {
      const userId = this.requireAuth(req, res);
      if (!userId) return;
      const { channelId, messageId } = req.params;
      const existing = this.store.messages.get(messageId);
      if (!existing) return this.respond(req, res, 404, generateError("Message not found."));
      if (existing.createdBy.id !== userId) {
        return this.respond(req, res, 403, generateError("You can only edit your own messages."));
      }
      const body = req.body ?? {};
      const updated = this.store.editMessage(channelId, messageId, {
        content: body.content,
        htmlEmbed: body.htmlEmbed,
        buttons: body.buttons,
      });
      this.respond(req, res, 200, updated);
    }));

    app.delete("/api/channels/:channelId/messages/:messageId", gate((req, res) => {
      const userId = this.requireAuth(req, res);
      if (!userId) return;
      const { channelId, messageId } = req.params;
      const msg = this.store.messages.get(messageId);
      if (!msg) return this.respond(req, res, 404, generateError("Message not found."));
      // Author can always delete; otherwise need MANAGE_CHANNELS in the server.
      const channel = this.store.channels.get(channelId);
      const isAuthor = msg.createdBy.id === userId;
      if (!isAuthor && channel?.serverId &&
        !this.store.memberHasPermission(channel.serverId, userId, RolePermissions.MANAGE_CHANNELS)) {
        return this.respond(req, res, 403, generateError("You are not allowed to delete this message."));
      }
      this.store.deleteMessage(channelId, messageId);
      this.respond(req, res, 200, { message: "Message deleted." });
    }));

    // --- button callback (modals/interactions) ---
    app.post(
      "/api/channels/:channelId/messages/:messageId/buttons/:buttonId/callback",
      gate((req, res) => {
        if (!this.requireAuth(req, res)) return;
        // In production this pushes a modal/ack back to the clicking user.
        // We record it and echo success; the facade surfaces it for assertions.
        this.store.clickButton({
          channelId: req.params.channelId,
          messageId: req.params.messageId,
          buttonId: req.params.buttonId,
          userId: req.body?.userId,
          type: req.body?.components ? "modal_click" : "button_click",
          data: undefined,
        });
        this.respond(req, res, 200, { success: true });
      }),
    );

    // --- moderation ---
    app.post("/api/servers/:serverId/bans/:userId", gate((req, res) => {
      const actor = this.requireAuth(req, res);
      if (!actor) return;
      const { serverId, userId } = req.params;
      if (!this.store.servers.get(serverId)) return this.respond(req, res, 404, generateError("Server not found."));
      if (!this.store.memberHasPermission(serverId, actor, RolePermissions.BAN)) {
        return this.respond(req, res, 403, generateError("You are not allowed to ban members."));
      }
      this.store.banMember(serverId, userId, req.body?.reason);
      this.respond(req, res, 200, { banned: { id: userId }, reason: req.body?.reason ?? null });
    }));

    app.delete("/api/servers/:serverId/bans/:userId", gate((req, res) => {
      const actor = this.requireAuth(req, res);
      if (!actor) return;
      const { serverId, userId } = req.params;
      if (!this.store.memberHasPermission(serverId, actor, RolePermissions.BAN)) {
        return this.respond(req, res, 403, generateError("You are not allowed to unban members."));
      }
      this.store.unbanMember(serverId, userId);
      this.respond(req, res, 200, { message: "Unbanned." });
    }));

    app.delete("/api/servers/:serverId/members/:userId/kick", gate((req, res) => {
      const actor = this.requireAuth(req, res);
      if (!actor) return;
      const { serverId, userId } = req.params;
      if (!this.store.getMember(serverId, userId)) return this.respond(req, res, 404, generateError("Member not found."));
      if (!this.store.memberHasPermission(serverId, actor, RolePermissions.KICK)) {
        return this.respond(req, res, 403, generateError("You are not allowed to kick members."));
      }
      this.store.kickMember(serverId, userId);
      this.respond(req, res, 200, { message: "Kicked." });
    }));

    // --- bot commands ---
    app.post("/api/applications/bot/commands", gate((req, res) => {
      const userId = this.requireAuth(req, res);
      if (!userId) return;
      const token = req.header("authorization") || "";
      this.store.commands.set(token, req.body?.commands ?? []);
      this.respond(req, res, 200, req.body?.commands ?? []);
    }));

    // --- posts ---
    app.get("/api/posts", gate((req, res) => {
      if (!this.requireAuth(req, res)) return;
      this.respond(req, res, 200, []);
    }));
    app.post("/api/posts", gate((req, res) => {
      const userId = this.requireAuth(req, res);
      if (!userId) return;
      const user = this.store.users.get(userId)!;
      const now = this.store.ids.next();
      this.respond(req, res, 200, {
        id: now,
        content: req.body?.content,
        deleted: false,
        commentToId: "",
        createdBy: user,
        createdAt: Date.now(),
        editedAt: 0,
        likedBy: [],
        reposts: [],
        _count: { likedBy: 0, comments: 0, reposts: 0 },
        views: 0,
        announcement: null,
        poll: req.body?.poll,
      });
    }));
    app.patch("/api/posts/:postId", gate((req, res) => {
      const userId = this.requireAuth(req, res);
      if (!userId) return;
      const user = this.store.users.get(userId)!;
      this.respond(req, res, 200, {
        id: req.params.postId,
        content: req.body?.content,
        deleted: false,
        commentToId: "",
        createdBy: user,
        createdAt: Date.now(),
        editedAt: Date.now(),
        likedBy: [],
        reposts: [],
        _count: { likedBy: 0, comments: 0, reposts: 0 },
        views: 0,
        announcement: null,
      });
    }));
    app.delete("/api/posts/:postId", gate((req, res) => {
      if (!this.requireAuth(req, res)) return;
      this.respond(req, res, 200, { message: "Post deleted." });
    }));

    // --- webhooks (WebhookBuilder posts here) ---
    app.post("/api/webhooks/:channelId/:token", gate((req, res) => {
      const channel = this.store.channels.get(req.params.channelId);
      if (!channel) return this.respond(req, res, 404, generateError("Channel not found."));
      // Post as a synthetic webhook user so bots can observe it over the gateway.
      const webhookUser = this.ensureWebhookUser(req.body?.username, req.body?.avatarUrl);
      const message = this.store.createMessage({
        channelId: req.params.channelId,
        createdById: webhookUser,
        content: req.body?.content,
        webhookId: req.params.token,
      });
      this.respond(req, res, 200, message);
    }));

    app.use((req, res) => {
      this.respond(req, res, 404, generateError(`Unknown route: ${req.method} ${req.path}`));
    });
  }

  private requireAuth(req: Request, res: Response): string | undefined {
    const userId = this.userId(req);
    if (!userId) {
      this.respond(req, res, 401, generateError("Invalid token."));
      return undefined;
    }
    return userId;
  }

  private webhookUserId?: string;
  private ensureWebhookUser(username?: string, avatarUrl?: string): string {
    if (!this.webhookUserId) {
      const u = this.store.createUser({
        username: username ?? "Webhook",
        bot: true,
        avatar: avatarUrl,
      });
      this.webhookUserId = u.id;
    }
    return this.webhookUserId;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
