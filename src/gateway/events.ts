/**
 * Gateway event-name constants.
 *
 * `ServerToClient` mirrors nerimity-server's `ClientEventNames.ts` - these are
 * the socket.io event strings the SDK listens for. `ClientToServer` mirrors the
 * SDK's `SocketClientEvents` - what the bot emits back.
 *
 * Not every server event is surfaced by the SDK today (e.g. the SDK ignores
 * `channel:typing`, `user:presence_update`, `voice:*`). NeriTest can still emit
 * them for forward-compatibility and inspection; see the notes below.
 */

export const ClientToServer = {
  AUTHENTICATE: "user:authenticate",
  NOTIFICATION_DISMISS: "notification:dismiss",
  UPDATE_ACTIVITY: "user:update_activity",
} as const;

export const ServerToClient = {
  // connection / auth
  CONNECT: "connect",
  AUTHENTICATED: "user:authenticated",
  AUTHENTICATE_ERROR: "user:authenticate_error",
  AUTH_QUEUE_POSITION: "user:auth_queue_position",

  // user
  USER_UPDATED: "user:updated",
  USER_UPDATED_SELF: "user:updatedSelf",
  USER_PRESENCE_UPDATE: "user:presence_update",
  USER_BLOCKED: "user:blocked",
  USER_UNBLOCKED: "user:unblocked",
  USER_NOTICE_CREATED: "user:notice_created",

  // reminders / notifications
  USER_REMINDER_ADD: "user:reminder_add",
  USER_REMINDER_UPDATE: "user:reminder_update",
  USER_REMINDER_REMOVE: "user:reminder_remove",
  NOTIFICATION_DISMISSED: "notification:dismissed",

  // friends / inbox
  FRIEND_REQUEST_SENT: "friend:request_sent",
  FRIEND_REQUEST_PENDING: "friend:request_pending",
  FRIEND_REQUEST_ACCEPTED: "friend:request_accepted",
  FRIEND_REMOVED: "friend:removed",
  INBOX_OPENED: "inbox:opened",
  INBOX_CLOSED: "inbox:closed",

  // servers
  SERVER_JOINED: "server:joined",
  SERVER_LEFT: "server:left",
  SERVER_UPDATED: "server:updated",
  SERVER_ORDER_UPDATED: "server:order_updated",
  SERVER_EMOJI_ADD: "server:emoji_add",
  SERVER_EMOJI_REMOVE: "server:emoji_remove",
  SERVER_EMOJI_UPDATE: "server:emoji_update",

  // roles
  SERVER_ROLE_CREATED: "server:role_created",
  SERVER_ROLE_UPDATED: "server:role_updated",
  SERVER_ROLE_DELETED: "server:role_deleted",
  SERVER_ROLE_ORDER_UPDATED: "server:role_order_updated",

  // channels
  SERVER_CHANNEL_CREATED: "server:channel_created",
  SERVER_CHANNEL_UPDATED: "server:channel_updated",
  SERVER_CHANNEL_DELETED: "server:channel_deleted",
  SERVER_CHANNEL_ORDER_UPDATED: "server:channel_order_updated",
  SERVER_CHANNEL_PERMISSIONS_UPDATED: "server:channel_permissions_updated",

  // members
  SERVER_MEMBER_JOINED: "server:member_joined",
  SERVER_MEMBER_LEFT: "server:member_left",
  SERVER_MEMBER_UPDATED: "server:member_updated",

  // messages
  MESSAGE_CREATED: "message:created",
  MESSAGE_UPDATED: "message:updated",
  MESSAGE_DELETED: "message:deleted",
  MESSAGE_DELETED_BATCH: "message:deleted_batch",
  MESSAGE_REACTION_ADDED: "message:reaction_added",
  MESSAGE_REACTION_REMOVED: "message:reaction_removed",
  MESSAGE_BUTTON_CLICKED: "message:button_clicked",
  MESSAGE_BUTTON_CLICKED_CALLBACK: "message:button_clicked_callback",
  CHANNEL_TYPING: "channel:typing",

  // voice
  VOICE_USER_JOINED: "voice:user_joined",
  VOICE_USER_LEFT: "voice:user_left",
  VOICE_SIGNAL_RECEIVED: "voice:signal_received",
} as const;

export type ServerToClientEvent =
  (typeof ServerToClient)[keyof typeof ServerToClient];
