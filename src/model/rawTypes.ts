/**
 * Wire payload shapes mirrored 1:1 from nerimity.js (`src/RawData.ts`).
 *
 * Every object NeriTest sends over the fake gateway or REST API is built to
 * match these shapes exactly, because these are the shapes the SDK's classes
 * (`Message`, `User`, `Server`, ...) parse. If a field is optional here it is
 * optional on the wire.
 */
import type { MessageType, ChannelType, AttachmentProvider } from "./enums";

export interface RawUser {
  id: string;
  avatar?: string;
  banner?: string;
  username: string;
  bot?: boolean;
  hexColor: string;
  tag: string;
  badges: number;
  joinedAt?: number;
}

export interface RawServer {
  id: string;
  name: string;
  hexColor: string;
  defaultChannelId: string;
  systemChannelId?: string;
  avatar?: string;
  banner?: string;
  defaultRoleId: string;
  createdById: string;
  createdAt: number;
  verified: boolean;
  customEmojis: RawCustomEmoji[];
  _count?: { welcomeQuestions: number };
}

export interface RawCustomEmoji {
  id: string;
  name: string;
  gif?: boolean;
}

export interface RawServerRole {
  id: string;
  name: string;
  icon?: string;
  order: number;
  hexColor: string;
  createdById: string;
  permissions: number;
  serverId: string;
  hideRole: boolean;
  botRole?: boolean;
  applyOnJoin?: boolean;
}

export interface RawServerMember {
  serverId: string;
  user: RawUser;
  nickname?: string | null;
  joinedAt: number;
  roleIds: string[];
}

export interface RawChannel {
  id: string;
  categoryId?: string;
  name: string;
  createdById?: string;
  serverId?: string;
  type: ChannelType;
  permissions?: number;
  createdAt: number;
  lastMessagedAt?: number;
  order?: number;
  _count?: { attachments: number };
}

export interface RawAttachment {
  id: string;
  provider?: AttachmentProvider;
  fileId?: string;
  mime?: string;
  messageId?: string;
  duration?: number;
  path?: string;
  width?: number;
  height?: number;
  createdAt?: number;
  filesize?: number;
  expireAt?: number;
}

export interface RawEmbed {
  title?: string;
  type?: string;
  description?: string;
  url: string;
  origUrl?: string;
  imageUrl?: string;
  imageWidth?: number;
  imageHeight?: number;
  imageMime?: string;
  video?: boolean;
  largeImage?: boolean;
  uploadDate?: string;
  channelName?: string;
  domain?: string;
}

export interface RawMessageButton {
  id: string;
  label: string;
  alert?: boolean;
}

export interface RawMessageReaction {
  name: string;
  emojiId?: string | null;
  gif?: boolean;
  reacted: boolean;
  count: number;
}

export interface RawMessage {
  id: string;
  channelId: string;
  silent?: boolean;
  content?: string;
  createdBy: RawUser & { avatarUrl?: string };
  type: MessageType;
  createdAt: number;
  pinned?: boolean;
  editedAt?: number;
  mentions?: RawUser[];
  attachments?: RawAttachment[];
  quotedMessages: Partial<RawMessage>[];
  reactions: RawMessageReaction[];
  htmlEmbed?: string;
  embed?: RawEmbed | null;
  mentionReplies?: boolean;
  replyMessages: { replyToMessage?: RawMessage }[];
  buttons: RawMessageButton[];
  roleMentions: RawServerRole[];
  webhookId?: string;
}

export interface RawBotCommand {
  name: string;
  description: string;
  args: string;
  botUserId: string;
  permissions?: number;
}

/** The payload the client reads from `user:authenticated`. */
export interface AuthenticatedPayload {
  user: RawUser;
  servers: RawServer[];
  serverMembers: RawServerMember[];
  messageMentions: unknown[];
  channels: RawChannel[];
  serverRoles: RawServerRole[];
  presences: RawPresence[];
  friends: unknown[];
  inbox: unknown[];
  lastSeenServerChannelIds: Record<string, number>;
}

export interface RawPresence {
  userId: string;
  status?: number;
  custom?: string;
  activity?: unknown;
}

export interface MessageButtonClickPayload {
  messageId: string;
  channelId: string;
  buttonId: string;
  userId: string;
  type: "modal_click" | "button_click";
  data?: Record<string, string>;
}

export interface ReactionAddedPayload {
  messageId: string;
  channelId: string;
  count: number;
  reactedByUserId: string;
  emojiId?: string;
  name: string;
  gif?: boolean;
}

export interface ReactionRemovedPayload {
  messageId: string;
  channelId: string;
  count: number;
  reactionRemovedByUserId: string;
  emojiId?: string;
  name: string;
  gif?: boolean;
}
