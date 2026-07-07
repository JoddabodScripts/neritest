/**
 * Enums mirrored 1:1 from nerimity.js (`src/RawData.ts`).
 *
 * These values are wire-level: the numbers are what the real Nerimity gateway
 * and REST API send, so bots that compare against them keep working unchanged.
 */

export enum MessageType {
  CONTENT = 0,
  JOIN_SERVER = 1,
  LEAVE_SERVER = 2,
  KICK_USER = 3,
  BAN_USER = 4,
}

export enum ChannelType {
  DM_TEXT = 0,
  SERVER_TEXT = 1,
  CATEGORY = 2,
}

export type AttachmentProvider = "local" | "google_drive";
