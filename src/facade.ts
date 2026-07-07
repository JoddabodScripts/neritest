/**
 * The fluent "world" API.
 *
 * These wrappers are the ergonomic surface a test author drives to set up and
 * manipulate the sandbox from the *outside*: create servers/channels/users, have
 * a user send a message, add a reaction, click a button. Every method mutates
 * the store, which emits domain events, which the gateway forwards to the bot.
 *
 * This is deliberately NOT the same object model as nerimity.js. The bot uses
 * the SDK's classes (built from our payloads); the test author uses these.
 */
import type { Store } from "./model/store";
import type { Clock, TimeInput } from "./time/clock";
import { ChannelType, MessageType } from "./model/enums";
import { RolePermissions } from "./model/permissions";
import type {
  RawChannel,
  RawMessage,
  RawMessageButton,
  RawServer,
  RawServerRole,
  RawUser,
  RawEmbed,
} from "./model/rawTypes";

export interface SendOptions {
  content?: string;
  /** Raw HTML content, mapped to the message's `htmlEmbed` field (Nerimity's HTML support). */
  html?: string;
  /** Alias for {@link html}, matching the SDK field name. */
  htmlEmbed?: string;
  embed?: RawEmbed;
  buttons?: RawMessageButton[];
  attachments?: { id?: string; mime?: string; path?: string; width?: number; height?: number; duration?: number }[];
  silent?: boolean;
  replyTo?: SandboxMessage | string;
  mentionReplies?: boolean;
  type?: MessageType;
}

export type SendInput = string | SendOptions;

export class SandboxUser {
  constructor(
    private store: Store,
    readonly raw: RawUser,
  ) {}

  get id(): string {
    return this.raw.id;
  }
  get username(): string {
    return this.raw.username;
  }
  get tag(): string {
    return this.raw.tag;
  }
  get isBot(): boolean {
    return !!this.raw.bot;
  }

  /** Mention token as it appears in message content (`[@:id]`). */
  toString(): string {
    return `[@:${this.id}]`;
  }

  /** Update this user's presence/activity and broadcast it. */
  setPresence(presence: { status?: number; custom?: string; activity?: unknown }): void {
    this.store.setPresence({ userId: this.id, ...presence });
  }

  /** Whether this user was ever kicked (from a specific server, or anywhere). */
  wasKicked(server?: SandboxServer | string): boolean {
    const serverId = typeof server === "string" ? server : server?.id;
    return this.store.wasKicked(this.id, serverId);
  }

  /** Whether this user was ever banned (from a specific server, or anywhere). */
  wasBanned(server?: SandboxServer | string): boolean {
    const serverId = typeof server === "string" ? server : server?.id;
    return this.store.wasBanned(this.id, serverId);
  }
}

export class SandboxMember {
  constructor(
    private store: Store,
    readonly serverId: string,
    readonly userId: string,
  ) {}

  get nickname(): string | null | undefined {
    return this.store.getMember(this.serverId, this.userId)?.nickname;
  }

  /** The member's roles as `SandboxRole`s (excludes the implicit default role). */
  get roles(): SandboxRole[] {
    const member = this.store.getMember(this.serverId, this.userId);
    if (!member) return [];
    return member.roleIds
      .map((id) => this.store.roles.get(id))
      .filter((r): r is NonNullable<typeof r> => !!r)
      .map((r) => new SandboxRole(this.store, r));
  }

  hasRole(role: SandboxRole | string): boolean {
    const roleId = typeof role === "string" ? role : role.id;
    return !!this.store.getMember(this.serverId, this.userId)?.roleIds.includes(roleId);
  }

  get permissions(): number {
    return this.store.memberPermissions(this.serverId, this.userId);
  }

  hasPermission(bit: number): boolean {
    return this.store.memberHasPermission(this.serverId, this.userId, bit);
  }
}

export class SandboxRole {
  constructor(
    private store: Store,
    readonly raw: RawServerRole,
  ) {}
  get id(): string {
    return this.raw.id;
  }
  get name(): string {
    return this.raw.name;
  }
  get permissions(): number {
    return this.raw.permissions;
  }
  update(patch: Partial<Pick<RawServerRole, "name" | "permissions" | "hexColor" | "hideRole">>): this {
    this.store.updateRole(this.id, patch);
    return this;
  }
  delete(): void {
    this.store.deleteRole(this.id);
  }
}

export class SandboxMessage {
  constructor(
    private store: Store,
    readonly id: string,
  ) {}

  private get raw(): RawMessage | undefined {
    return this.store.messages.get(this.id);
  }

  get content(): string | undefined {
    return this.raw?.content;
  }
  get htmlEmbed(): string | undefined {
    return this.raw?.htmlEmbed;
  }
  get authorId(): string {
    return this.raw?.createdBy.id ?? "";
  }
  get channelId(): string {
    return this.raw?.channelId ?? "";
  }
  get reactions() {
    return this.raw?.reactions ?? [];
  }
  get buttons(): RawMessageButton[] {
    return this.raw?.buttons ?? [];
  }
  get editedAt(): number | undefined {
    return this.raw?.editedAt;
  }
  get deleted(): boolean {
    return !this.raw;
  }
  /** The full raw payload, exactly as the SDK would receive it. */
  toRaw(): RawMessage | undefined {
    return this.raw;
  }

  /** A user adds a reaction to this message. */
  react(user: SandboxUser, emoji: string | { name: string; emojiId?: string; gif?: boolean }): this {
    const e = typeof emoji === "string" ? { name: emoji } : emoji;
    this.store.addReaction(this.channelId, this.id, user.id, e);
    return this;
  }
  removeReaction(user: SandboxUser, emoji: string | { name: string; emojiId?: string; gif?: boolean }): this {
    const e = typeof emoji === "string" ? { name: emoji } : emoji;
    this.store.removeReaction(this.channelId, this.id, user.id, e);
    return this;
  }

  /** A user clicks a button on this message (fires `messageButtonClick` on the bot). */
  clickButton(
    user: SandboxUser,
    buttonId: string,
    opts: { type?: "button_click" | "modal_click"; data?: Record<string, string> } = {},
  ): this {
    this.store.clickButton({
      messageId: this.id,
      channelId: this.channelId,
      buttonId,
      userId: user.id,
      type: opts.type,
      data: opts.data,
    });
    return this;
  }

  /** Edit as the original author (fires `messageUpdate`). */
  edit(patch: { content?: string; html?: string; htmlEmbed?: string; buttons?: RawMessageButton[] }): this {
    this.store.editMessage(this.channelId, this.id, {
      content: patch.content,
      htmlEmbed: patch.html ?? patch.htmlEmbed,
      buttons: patch.buttons,
    });
    return this;
  }

  /** Delete (fires `messageDelete`). */
  delete(): void {
    this.store.deleteMessage(this.channelId, this.id);
  }
}

export class SandboxChannel {
  constructor(
    private store: Store,
    private clock: Clock,
    readonly id: string,
  ) {}

  private get raw(): RawChannel | undefined {
    return this.store.channels.get(this.id);
  }
  get name(): string | undefined {
    return this.raw?.name;
  }
  get type(): ChannelType | undefined {
    return this.raw?.type;
  }
  get serverId(): string | undefined {
    return this.raw?.serverId;
  }

  /** A user posts a message into this channel. Fires `messageCreate` on the bot. */
  send(user: SandboxUser, input: SendInput): SandboxMessage {
    const opts: SendOptions = typeof input === "string" ? { content: input } : input;
    const replyId =
      typeof opts.replyTo === "string"
        ? opts.replyTo
        : opts.replyTo?.id;
    const message = this.store.createMessage({
      channelId: this.id,
      createdById: user.id,
      content: opts.content,
      htmlEmbed: opts.html ?? opts.htmlEmbed,
      embed: opts.embed ?? null,
      buttons: opts.buttons,
      silent: opts.silent,
      type: opts.type,
      mentionReplies: opts.mentionReplies,
      replyToMessageIds: replyId ? [replyId] : undefined,
      attachments: opts.attachments?.map((a) => ({
        id: a.id ?? this.store.ids.next(),
        provider: "local" as const,
        mime: a.mime,
        path: a.path,
        width: a.width,
        height: a.height,
        duration: a.duration,
        createdAt: this.clock.now(),
      })),
    });
    return new SandboxMessage(this.store, message.id);
  }

  /** Convenience for sending pure-HTML content. */
  sendHtml(user: SandboxUser, html: string): SandboxMessage {
    return this.send(user, { html });
  }

  /** A user starts typing in this channel (fires `channel:typing`; note the SDK does not surface this today). */
  startTyping(user: SandboxUser): void {
    this.store.startTyping(this.id, user.id);
  }

  get messages(): SandboxMessage[] {
    return this.store.messagesForChannel(this.id).map((m) => new SandboxMessage(this.store, m.id));
  }
  get lastMessage(): SandboxMessage | undefined {
    const list = this.store.messagesForChannel(this.id);
    const last = list[list.length - 1];
    return last ? new SandboxMessage(this.store, last.id) : undefined;
  }

  update(patch: Partial<Pick<RawChannel, "name" | "permissions" | "categoryId">>): this {
    this.store.updateChannel(this.id, patch);
    return this;
  }
  delete(): void {
    this.store.deleteChannel(this.id);
  }
}

export interface CreateChannelOptions {
  name: string;
  type?: ChannelType;
  category?: SandboxChannel | string;
  permissions?: number;
}

export interface CreateRoleOptions {
  name?: string;
  permissions?: number;
  hexColor?: string;
  hideRole?: boolean;
}

export interface AddMemberOptions {
  nickname?: string | null;
  roles?: Array<SandboxRole | string>;
}

export class SandboxServer {
  constructor(
    private store: Store,
    private clock: Clock,
    readonly id: string,
    private botUserId: string,
  ) {}

  private get raw(): RawServer | undefined {
    return this.store.servers.get(this.id);
  }
  get name(): string | undefined {
    return this.raw?.name;
  }
  get defaultRoleId(): string {
    return this.raw?.defaultRoleId ?? "";
  }
  get ownerId(): string {
    return this.raw?.createdById ?? "";
  }

  createChannel(opts: CreateChannelOptions): SandboxChannel {
    const categoryId = typeof opts.category === "string" ? opts.category : opts.category?.id;
    const channel = this.store.createChannel({
      serverId: this.id,
      name: opts.name,
      type: opts.type ?? ChannelType.SERVER_TEXT,
      categoryId,
      permissions: opts.permissions,
      createdById: this.ownerId,
    });
    return new SandboxChannel(this.store, this.clock, channel.id);
  }

  createCategory(name: string): SandboxChannel {
    return this.createChannel({ name, type: ChannelType.CATEGORY });
  }

  get defaultChannel(): SandboxChannel {
    return new SandboxChannel(this.store, this.clock, this.raw!.defaultChannelId);
  }

  get channels(): SandboxChannel[] {
    return this.store
      .channelsForServer(this.id)
      .map((c) => new SandboxChannel(this.store, this.clock, c.id));
  }

  createRole(opts: CreateRoleOptions = {}): SandboxRole {
    const role = this.store.createRole({ serverId: this.id, ...opts, createdById: this.ownerId });
    return new SandboxRole(this.store, role);
  }

  get roles(): SandboxRole[] {
    return this.store.rolesForServer(this.id).map((r) => new SandboxRole(this.store, r));
  }
  get defaultRole(): SandboxRole {
    return new SandboxRole(this.store, this.store.roles.get(this.defaultRoleId)!);
  }

  /** Add a member to this server. If it's the bot, the bot receives `serverJoined`; otherwise members receive `memberJoined`. */
  addMember(user: SandboxUser, opts: AddMemberOptions = {}): void {
    const roleIds = (opts.roles ?? []).map((r) => (typeof r === "string" ? r : r.id));
    if (user.id === this.botUserId) {
      this.store.addMember(this.id, user.id, { nickname: opts.nickname, roleIds, emit: false });
      this.store.emitServerJoined(this.id);
    } else {
      this.store.addMember(this.id, user.id, { nickname: opts.nickname, roleIds });
    }
  }

  /** Assign the exact set of roles a member has (fires `memberUpdate`). */
  setMemberRoles(user: SandboxUser, roles: Array<SandboxRole | string>): void {
    this.store.setMemberRoles(this.id, user.id, roles.map((r) => (typeof r === "string" ? r : r.id)));
  }

  giveRole(user: SandboxUser, role: SandboxRole | string): void {
    const roleId = typeof role === "string" ? role : role.id;
    const member = this.store.getMember(this.id, user.id);
    if (!member) return;
    if (member.roleIds.includes(roleId)) return;
    this.store.setMemberRoles(this.id, user.id, [...member.roleIds, roleId]);
  }

  /** The member record for a user in this server, or undefined if not a member. */
  member(user: SandboxUser | string): SandboxMember | undefined {
    const userId = typeof user === "string" ? user : user.id;
    if (!this.store.getMember(this.id, userId)) return undefined;
    return new SandboxMember(this.store, this.id, userId);
  }

  get members(): SandboxMember[] {
    return this.store
      .membersForServer(this.id)
      .map((m) => new SandboxMember(this.store, this.id, m.userId));
  }

  memberPermissions(user: SandboxUser): number {
    return this.store.memberPermissions(this.id, user.id);
  }

  isBanned(user: SandboxUser | string): boolean {
    const userId = typeof user === "string" ? user : user.id;
    return this.store.isBanned(this.id, userId);
  }

  /** A member leaves (fires `serverMemberLeft`). */
  removeMember(user: SandboxUser): void {
    this.store.removeMember(this.id, user.id);
  }

  addCustomEmoji(name: string, opts: { gif?: boolean; id?: string } = {}): { id: string; name: string } {
    const emoji = { id: opts.id ?? this.store.ids.next(), name, gif: opts.gif };
    this.store.addCustomEmoji(this.id, emoji);
    return emoji;
  }

  update(patch: Partial<Pick<RawServer, "name" | "avatar" | "banner" | "hexColor">>): this {
    this.store.updateServer(this.id, patch);
    return this;
  }
}
