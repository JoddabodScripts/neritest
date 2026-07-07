/**
 * The canonical sandbox state.
 *
 * Everything - users, servers, channels, members, roles, messages, reactions,
 * bans, presences, bot commands - lives here as `Raw*`-shaped data, the single
 * source of truth. Both entry points into the world mutate the store:
 *
 *   - the fake REST API (things the *bot* does: send/edit/delete, ban, kick...)
 *   - the fluent facade (things the *world* does: a user sends a message...)
 *
 * Every mutation emits a typed domain event. The gateway listens and forwards
 * those to the right connected sockets, so the SDK sees them as real gateway
 * traffic. Serialization helpers produce the exact `Raw*` payloads the SDK
 * parses.
 */
import { EventEmitter } from "node:events";
import type { Clock } from "../time/clock";
import { IdGenerator } from "../ids";
import { ChannelType, MessageType } from "./enums";
import { addBit, hasBit, RolePermissions } from "./permissions";
import type {
  RawAttachment,
  RawChannel,
  RawEmbed,
  RawMessage,
  RawMessageButton,
  RawServer,
  RawServerMember,
  RawServerRole,
  RawUser,
  RawPresence,
  RawCustomEmoji,
} from "./rawTypes";

export interface StoredMember {
  serverId: string;
  userId: string;
  nickname?: string | null;
  joinedAt: number;
  roleIds: string[];
}

export interface StoredBan {
  serverId: string;
  userId: string;
  reason?: string;
  bannedAt: number;
}

export interface CreateMessageInput {
  channelId: string;
  createdById: string;
  content?: string;
  htmlEmbed?: string;
  embed?: RawEmbed | null;
  buttons?: RawMessageButton[];
  attachments?: RawAttachment[];
  silent?: boolean;
  type?: MessageType;
  replyToMessageIds?: string[];
  mentionReplies?: boolean;
  webhookId?: string;
  id?: string;
  createdAt?: number;
}

const USER_MENTION_RE = /\[@:([0-9]+)\]/gm;

/** Domain events emitted by the store; the gateway maps these to socket emits. */
export interface StoreEvents {
  messageCreated: [{ message: RawMessage }];
  messageUpdated: [{ channelId: string; messageId: string; updated: Partial<RawMessage> }];
  messageDeleted: [{ channelId: string; messageId: string; deletedAttachmentCount: number }];
  reactionAdded: [
    { messageId: string; channelId: string; count: number; reactedByUserId: string; emojiId?: string; name: string; gif?: boolean },
  ];
  reactionRemoved: [
    { messageId: string; channelId: string; count: number; reactionRemovedByUserId: string; emojiId?: string; name: string; gif?: boolean },
  ];
  memberJoined: [{ serverId: string; member: RawServerMember }];
  memberLeft: [{ serverId: string; userId: string }];
  memberUpdated: [{ serverId: string; userId: string; updated: { roleIds: string[] } }];
  serverJoined: [{ server: RawServer; members: RawServerMember[]; channels: RawChannel[]; roles: RawServerRole[] }];
  serverLeft: [{ serverId: string }];
  serverUpdated: [{ serverId: string; updated: Partial<RawServer> }];
  channelCreated: [{ serverId: string; channel: RawChannel }];
  channelUpdated: [{ serverId: string; channelId: string; updated: Partial<RawChannel> }];
  channelDeleted: [{ serverId: string; channelId: string }];
  roleCreated: [RawServerRole];
  roleUpdated: [{ serverId: string; roleId: string; updated: Partial<RawServerRole> }];
  roleDeleted: [{ serverId: string; roleId: string }];
  roleOrderUpdated: [{ serverId: string; roleIds: string[] }];
  typingStart: [{ channelId: string; userId: string }];
  presenceUpdate: [RawPresence];
  buttonClicked: [{ messageId: string; channelId: string; buttonId: string; userId: string; type: "button_click" | "modal_click"; data?: Record<string, string> }];
}

export class Store {
  readonly ids: IdGenerator;

  users = new Map<string, RawUser>();
  servers = new Map<string, RawServer>();
  channels = new Map<string, RawChannel>();
  roles = new Map<string, RawServerRole>();
  members = new Map<string, StoredMember>(); // key: `${serverId}:${userId}`
  messages = new Map<string, RawMessage>();
  bans = new Map<string, StoredBan>(); // key: `${serverId}:${userId}`
  // Historical records so tests can assert `wasKicked()` / `wasBanned()` even
  // after an unban or rejoin. Keyed by `${serverId}:${userId}`.
  kickHistory = new Set<string>();
  banHistory = new Set<string>();
  presences = new Map<string, RawPresence>();
  botCommands: RawMessageButton[] | undefined;
  commands = new Map<string, unknown[]>(); // token -> commands

  // token -> userId, and userId -> token
  private tokensToUser = new Map<string, string>();
  private userToToken = new Map<string, string>();

  // per-message emoji -> set of userIds who reacted, for exact counts
  private reactionUsers = new Map<string, Map<string, Set<string>>>();

  private emitter = new EventEmitter();

  constructor(private clock: Clock) {
    this.ids = new IdGenerator(clock);
    this.emitter.setMaxListeners(0);
  }

  // ---- event bus -----------------------------------------------------------

  on<E extends keyof StoreEvents>(
    event: E,
    listener: (...args: StoreEvents[E]) => void,
  ): () => void {
    this.emitter.on(event, listener as (...args: unknown[]) => void);
    return () => this.emitter.off(event, listener as (...args: unknown[]) => void);
  }

  private emit<E extends keyof StoreEvents>(event: E, ...args: StoreEvents[E]): void {
    this.emitter.emit(event, ...args);
  }

  // ---- tokens --------------------------------------------------------------

  issueToken(userId: string): string {
    const existing = this.userToToken.get(userId);
    if (existing) return existing;
    const token = `neritest.${userId}.${Math.random().toString(36).slice(2, 10)}`;
    this.tokensToUser.set(token, userId);
    this.userToToken.set(userId, token);
    return token;
  }

  userIdForToken(token: string | undefined): string | undefined {
    if (!token) return undefined;
    return this.tokensToUser.get(token);
  }

  // ---- users ---------------------------------------------------------------

  createUser(input: Partial<RawUser> & { username: string }): RawUser {
    const id = input.id ?? this.ids.next();
    const user: RawUser = {
      id,
      username: input.username,
      tag: input.tag ?? randomTag(),
      hexColor: input.hexColor ?? "#ffffff",
      badges: input.badges ?? 0,
      bot: input.bot ?? false,
      avatar: input.avatar,
      banner: input.banner,
      joinedAt: input.joinedAt ?? this.clock.now(),
    };
    this.users.set(id, user);
    return user;
  }

  // ---- servers -------------------------------------------------------------

  createServer(input: Partial<RawServer> & { name: string; ownerId: string }): {
    server: RawServer;
    defaultRole: RawServerRole;
    defaultChannel: RawChannel;
  } {
    const id = input.id ?? this.ids.next();
    const defaultRoleId = this.ids.next();
    const defaultChannelId = this.ids.next();

    const server: RawServer = {
      id,
      name: input.name,
      hexColor: input.hexColor ?? "#57f287",
      defaultChannelId,
      systemChannelId: input.systemChannelId ?? defaultChannelId,
      avatar: input.avatar,
      banner: input.banner,
      defaultRoleId,
      createdById: input.ownerId,
      createdAt: this.clock.now(),
      verified: input.verified ?? false,
      customEmojis: input.customEmojis ?? [],
    };
    this.servers.set(id, server);

    // @everyone default role: send-message on by default, like Nerimity.
    const defaultRole: RawServerRole = {
      id: defaultRoleId,
      name: "everyone",
      order: 0,
      hexColor: "#ffffff",
      createdById: input.ownerId,
      permissions: RolePermissions.SEND_MESSAGE,
      serverId: id,
      hideRole: false,
    };
    this.roles.set(defaultRoleId, defaultRole);

    const defaultChannel: RawChannel = {
      id: defaultChannelId,
      name: "general",
      type: ChannelType.SERVER_TEXT,
      serverId: id,
      createdById: input.ownerId,
      createdAt: this.clock.now(),
      order: 1,
    };
    this.channels.set(defaultChannelId, defaultChannel);

    // owner is a member
    this.addMemberRaw(id, input.ownerId, { roleIds: [] });

    return { server, defaultRole, defaultChannel };
  }

  updateServer(serverId: string, updated: Partial<RawServer>): void {
    const server = this.servers.get(serverId);
    if (!server) return;
    Object.assign(server, updated);
    this.emit("serverUpdated", { serverId, updated });
  }

  // ---- channels ------------------------------------------------------------

  createChannel(input: {
    serverId?: string;
    name: string;
    type?: ChannelType;
    categoryId?: string;
    createdById?: string;
    permissions?: number;
    id?: string;
    emit?: boolean;
  }): RawChannel {
    const id = input.id ?? this.ids.next();
    const channel: RawChannel = {
      id,
      name: input.name,
      type: input.type ?? (input.serverId ? ChannelType.SERVER_TEXT : ChannelType.DM_TEXT),
      serverId: input.serverId,
      categoryId: input.categoryId,
      createdById: input.createdById,
      permissions: input.permissions,
      createdAt: this.clock.now(),
      order: input.serverId
        ? this.channelsForServer(input.serverId).length + 1
        : undefined,
    };
    this.channels.set(id, channel);
    if (input.serverId && input.emit !== false) {
      this.emit("channelCreated", { serverId: input.serverId, channel });
    }
    return channel;
  }

  updateChannel(channelId: string, updated: Partial<RawChannel>): void {
    const channel = this.channels.get(channelId);
    if (!channel) return;
    Object.assign(channel, updated);
    if (channel.serverId) {
      this.emit("channelUpdated", { serverId: channel.serverId, channelId, updated });
    }
  }

  deleteChannel(channelId: string): void {
    const channel = this.channels.get(channelId);
    if (!channel) return;
    this.channels.delete(channelId);
    if (channel.serverId) {
      this.emit("channelDeleted", { serverId: channel.serverId, channelId });
    }
  }

  channelsForServer(serverId: string): RawChannel[] {
    return [...this.channels.values()].filter((c) => c.serverId === serverId);
  }

  // ---- roles ---------------------------------------------------------------

  createRole(input: {
    serverId: string;
    name?: string;
    permissions?: number;
    hexColor?: string;
    createdById?: string;
    hideRole?: boolean;
    botRole?: boolean;
    id?: string;
    emit?: boolean;
  }): RawServerRole {
    const id = input.id ?? this.ids.next();
    const order = this.rolesForServer(input.serverId).length;
    const role: RawServerRole = {
      id,
      name: input.name ?? "New Role",
      order,
      hexColor: input.hexColor ?? "#ffffff",
      createdById: input.createdById ?? this.servers.get(input.serverId)?.createdById ?? "0",
      permissions: input.permissions ?? 0,
      serverId: input.serverId,
      hideRole: input.hideRole ?? false,
      botRole: input.botRole,
    };
    this.roles.set(id, role);
    if (input.emit !== false) this.emit("roleCreated", role);
    return role;
  }

  updateRole(roleId: string, updated: Partial<RawServerRole>): void {
    const role = this.roles.get(roleId);
    if (!role) return;
    Object.assign(role, updated);
    this.emit("roleUpdated", { serverId: role.serverId, roleId, updated });
  }

  deleteRole(roleId: string): void {
    const role = this.roles.get(roleId);
    if (!role) return;
    this.roles.delete(roleId);
    // strip from members
    for (const member of this.members.values()) {
      if (member.serverId === role.serverId) {
        member.roleIds = member.roleIds.filter((r) => r !== roleId);
      }
    }
    this.emit("roleDeleted", { serverId: role.serverId, roleId });
  }

  reorderRoles(serverId: string, roleIds: string[]): void {
    roleIds.forEach((roleId, i) => {
      const role = this.roles.get(roleId);
      if (role) role.order = i + 1;
    });
    this.emit("roleOrderUpdated", { serverId, roleIds });
  }

  rolesForServer(serverId: string): RawServerRole[] {
    return [...this.roles.values()]
      .filter((r) => r.serverId === serverId)
      .sort((a, b) => a.order - b.order);
  }

  // ---- members -------------------------------------------------------------

  private addMemberRaw(
    serverId: string,
    userId: string,
    opts: { nickname?: string | null; roleIds?: string[]; joinedAt?: number },
  ): StoredMember {
    const member: StoredMember = {
      serverId,
      userId,
      nickname: opts.nickname ?? null,
      joinedAt: opts.joinedAt ?? this.clock.now(),
      roleIds: opts.roleIds ?? [],
    };
    this.members.set(memberKey(serverId, userId), member);
    return member;
  }

  addMember(
    serverId: string,
    userId: string,
    opts: { nickname?: string | null; roleIds?: string[]; emit?: boolean } = {},
  ): RawServerMember {
    this.addMemberRaw(serverId, userId, opts);
    const raw = this.serializeMember(serverId, userId)!;
    if (opts.emit !== false) this.emit("memberJoined", { serverId, member: raw });
    return raw;
  }

  removeMember(serverId: string, userId: string, emit = true): void {
    if (!this.members.delete(memberKey(serverId, userId))) return;
    if (emit) this.emit("memberLeft", { serverId, userId });
  }

  setMemberRoles(serverId: string, userId: string, roleIds: string[]): void {
    const member = this.members.get(memberKey(serverId, userId));
    if (!member) return;
    member.roleIds = roleIds;
    this.emit("memberUpdated", { serverId, userId, updated: { roleIds } });
  }

  getMember(serverId: string, userId: string): StoredMember | undefined {
    return this.members.get(memberKey(serverId, userId));
  }

  membersForServer(serverId: string): StoredMember[] {
    return [...this.members.values()].filter((m) => m.serverId === serverId);
  }

  // ---- permissions ---------------------------------------------------------

  /** Effective permission bitfield for a member (default role + assigned roles). */
  memberPermissions(serverId: string, userId: string): number {
    const server = this.servers.get(serverId);
    const member = this.getMember(serverId, userId);
    if (!server || !member) return 0;
    const defaultRole = this.roles.get(server.defaultRoleId);
    let perms = defaultRole?.permissions ?? 0;
    for (const roleId of member.roleIds) {
      const role = this.roles.get(roleId);
      if (role) perms = addBit(perms, role.permissions);
    }
    return perms;
  }

  memberHasPermission(
    serverId: string,
    userId: string,
    bit: number,
    { ignoreAdmin = false, ignoreCreator = false } = {},
  ): boolean {
    const server = this.servers.get(serverId);
    if (!server) return false;
    if (!ignoreCreator && server.createdById === userId) return true;
    const perms = this.memberPermissions(serverId, userId);
    if (!ignoreAdmin && hasBit(perms, RolePermissions.ADMIN)) return true;
    return hasBit(perms, bit);
  }

  // ---- bans ----------------------------------------------------------------

  banMember(serverId: string, userId: string, reason?: string): void {
    this.bans.set(memberKey(serverId, userId), {
      serverId,
      userId,
      reason,
      bannedAt: this.clock.now(),
    });
    this.banHistory.add(memberKey(serverId, userId));
    this.removeMember(serverId, userId);
  }

  unbanMember(serverId: string, userId: string): void {
    this.bans.delete(memberKey(serverId, userId));
  }

  isBanned(serverId: string, userId: string): boolean {
    return this.bans.has(memberKey(serverId, userId));
  }

  kickMember(serverId: string, userId: string): void {
    this.kickHistory.add(memberKey(serverId, userId));
    this.removeMember(serverId, userId);
  }

  /** True if the user was ever kicked (from `serverId`, or any server if omitted). */
  wasKicked(userId: string, serverId?: string): boolean {
    if (serverId) return this.kickHistory.has(memberKey(serverId, userId));
    return [...this.kickHistory].some((k) => k.endsWith(`:${userId}`));
  }

  /** True if the user was ever banned (from `serverId`, or any server if omitted). */
  wasBanned(userId: string, serverId?: string): boolean {
    if (serverId) return this.banHistory.has(memberKey(serverId, userId));
    return [...this.banHistory].some((k) => k.endsWith(`:${userId}`));
  }

  // ---- messages ------------------------------------------------------------

  createMessage(input: CreateMessageInput): RawMessage {
    const id = input.id ?? this.ids.next();
    const author = this.users.get(input.createdById);
    if (!author) throw new Error(`createMessage: unknown user ${input.createdById}`);

    const replyMessages =
      input.replyToMessageIds
        ?.map((mid) => this.messages.get(mid))
        .filter((m): m is RawMessage => !!m)
        .map((m) => ({ replyToMessage: m })) ?? [];

    const message: RawMessage = {
      id,
      channelId: input.channelId,
      content: input.content,
      createdBy: { ...author },
      type: input.type ?? MessageType.CONTENT,
      createdAt: input.createdAt ?? this.clock.now(),
      silent: input.silent,
      mentions: this.resolveMentions(input.content),
      attachments: input.attachments ?? [],
      quotedMessages: [],
      reactions: [],
      htmlEmbed: input.htmlEmbed,
      embed: input.embed ?? null,
      mentionReplies: input.mentionReplies,
      replyMessages,
      buttons: input.buttons ?? [],
      roleMentions: [],
      webhookId: input.webhookId,
    };

    this.messages.set(id, message);
    const channel = this.channels.get(input.channelId);
    if (channel) channel.lastMessagedAt = message.createdAt;
    this.emit("messageCreated", { message });
    return message;
  }

  editMessage(
    channelId: string,
    messageId: string,
    updated: { content?: string; htmlEmbed?: string; buttons?: RawMessageButton[] },
  ): RawMessage | undefined {
    const message = this.messages.get(messageId);
    if (!message) return undefined;
    if (updated.content !== undefined) message.content = updated.content;
    if (updated.htmlEmbed !== undefined) message.htmlEmbed = updated.htmlEmbed;
    if (updated.buttons !== undefined) message.buttons = updated.buttons;
    message.editedAt = this.clock.now();
    message.mentions = this.resolveMentions(message.content);
    this.emit("messageUpdated", {
      channelId,
      messageId,
      updated: {
        content: message.content,
        htmlEmbed: message.htmlEmbed,
        buttons: message.buttons,
        editedAt: message.editedAt,
      },
    });
    return message;
  }

  deleteMessage(channelId: string, messageId: string): boolean {
    const message = this.messages.get(messageId);
    if (!message) return false;
    const deletedAttachmentCount = message.attachments?.length ?? 0;
    this.messages.delete(messageId);
    this.reactionUsers.delete(messageId);
    this.emit("messageDeleted", { channelId, messageId, deletedAttachmentCount });
    return true;
  }

  messagesForChannel(channelId: string): RawMessage[] {
    return [...this.messages.values()]
      .filter((m) => m.channelId === channelId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  private resolveMentions(content?: string): RawUser[] {
    if (!content) return [];
    const ids = [...content.matchAll(USER_MENTION_RE)].map((m) => m[1]);
    return ids
      .map((id) => this.users.get(id))
      .filter((u): u is RawUser => !!u)
      .map((u) => ({ ...u }));
  }

  // ---- reactions -----------------------------------------------------------

  private reactionKey(name: string, emojiId?: string | null): string {
    return emojiId ? `id:${emojiId}` : `name:${name}`;
  }

  addReaction(
    channelId: string,
    messageId: string,
    userId: string,
    emoji: { name: string; emojiId?: string | null; gif?: boolean },
  ): void {
    const message = this.messages.get(messageId);
    if (!message) return;
    let byEmoji = this.reactionUsers.get(messageId);
    if (!byEmoji) {
      byEmoji = new Map();
      this.reactionUsers.set(messageId, byEmoji);
    }
    const key = this.reactionKey(emoji.name, emoji.emojiId);
    let users = byEmoji.get(key);
    if (!users) {
      users = new Set();
      byEmoji.set(key, users);
    }
    if (users.has(userId)) return;
    users.add(userId);

    const existing = message.reactions.find(
      (r) => this.reactionKey(r.name, r.emojiId) === key,
    );
    if (existing) existing.count = users.size;
    else
      message.reactions.push({
        name: emoji.name,
        emojiId: emoji.emojiId ?? undefined,
        gif: emoji.gif,
        reacted: false,
        count: users.size,
      });

    this.emit("reactionAdded", {
      messageId,
      channelId,
      count: users.size,
      reactedByUserId: userId,
      emojiId: emoji.emojiId ?? undefined,
      name: emoji.name,
      gif: emoji.gif,
    });
  }

  removeReaction(
    channelId: string,
    messageId: string,
    userId: string,
    emoji: { name: string; emojiId?: string | null; gif?: boolean },
  ): void {
    const message = this.messages.get(messageId);
    if (!message) return;
    const byEmoji = this.reactionUsers.get(messageId);
    const key = this.reactionKey(emoji.name, emoji.emojiId);
    const users = byEmoji?.get(key);
    if (!users || !users.has(userId)) return;
    users.delete(userId);
    const count = users.size;

    const idx = message.reactions.findIndex(
      (r) => this.reactionKey(r.name, r.emojiId) === key,
    );
    if (idx >= 0) {
      if (count === 0) message.reactions.splice(idx, 1);
      else message.reactions[idx].count = count;
    }

    this.emit("reactionRemoved", {
      messageId,
      channelId,
      count,
      reactionRemovedByUserId: userId,
      emojiId: emoji.emojiId ?? undefined,
      name: emoji.name,
      gif: emoji.gif,
    });
  }

  // ---- typing / presence / buttons ----------------------------------------

  startTyping(channelId: string, userId: string): void {
    this.emit("typingStart", { channelId, userId });
  }

  setPresence(presence: RawPresence): void {
    this.presences.set(presence.userId, presence);
    this.emit("presenceUpdate", presence);
  }

  clickButton(input: {
    messageId: string;
    channelId: string;
    buttonId: string;
    userId: string;
    type?: "button_click" | "modal_click";
    data?: Record<string, string>;
  }): void {
    this.emit("buttonClicked", {
      messageId: input.messageId,
      channelId: input.channelId,
      buttonId: input.buttonId,
      userId: input.userId,
      type: input.type ?? "button_click",
      data: input.data,
    });
  }

  addCustomEmoji(serverId: string, emoji: RawCustomEmoji): void {
    const server = this.servers.get(serverId);
    if (!server) return;
    server.customEmojis.push(emoji);
  }

  // ---- server join/leave for the bot --------------------------------------

  emitServerJoined(serverId: string): void {
    const server = this.servers.get(serverId);
    if (!server) return;
    this.emit("serverJoined", {
      server: { ...server },
      members: this.membersForServer(serverId).map((m) => this.serializeMember(m.serverId, m.userId)!),
      channels: this.channelsForServer(serverId),
      roles: this.rolesForServer(serverId),
    });
  }

  emitServerLeft(serverId: string): void {
    this.emit("serverLeft", { serverId });
  }

  // ---- serialization -------------------------------------------------------

  serializeMember(serverId: string, userId: string): RawServerMember | undefined {
    const member = this.members.get(memberKey(serverId, userId));
    const user = this.users.get(userId);
    if (!member || !user) return undefined;
    return {
      serverId,
      user: { ...user },
      nickname: member.nickname,
      joinedAt: member.joinedAt,
      roleIds: [...member.roleIds],
    };
  }

  /** Everything a given user (the bot) should receive in `user:authenticated`. */
  authPayloadFor(userId: string): {
    user: RawUser;
    servers: RawServer[];
    serverMembers: RawServerMember[];
    channels: RawChannel[];
    serverRoles: RawServerRole[];
    presences: RawPresence[];
  } {
    const user = this.users.get(userId)!;
    const memberServerIds = new Set(
      [...this.members.values()].filter((m) => m.userId === userId).map((m) => m.serverId),
    );
    const servers = [...this.servers.values()].filter((s) => memberServerIds.has(s.id));
    const serverMembers: RawServerMember[] = [];
    const serverRoles: RawServerRole[] = [];
    const channels: RawChannel[] = [];
    for (const server of servers) {
      for (const m of this.membersForServer(server.id)) {
        const raw = this.serializeMember(m.serverId, m.userId);
        if (raw) serverMembers.push(raw);
      }
      serverRoles.push(...this.rolesForServer(server.id));
      channels.push(...this.channelsForServer(server.id));
    }
    return {
      user: { ...user },
      servers: servers.map((s) => ({ ...s })),
      serverMembers,
      channels,
      serverRoles,
      presences: [...this.presences.values()],
    };
  }
}

function memberKey(serverId: string, userId: string): string {
  return `${serverId}:${userId}`;
}

function randomTag(): string {
  return Math.floor(1000 + Math.random() * 8999).toString();
}
