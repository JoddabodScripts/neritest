/**
 * NeriTest - a local sandbox that emulates the Nerimity runtime so you can
 * develop and test `@nerimity/nerimity.js` bots without touching production.
 *
 * ```ts
 * import { createSandbox, expect } from "neritest";
 *
 * const sandbox = createSandbox();
 * const server = sandbox.createServer({ name: "Development" });
 * const channel = server.createChannel({ name: "general" });
 * const alice = sandbox.createUser({ username: "Alice" });
 *
 * const client = await sandbox.createClient();
 * // ... attach your bot's handlers to `client` ...
 *
 * channel.send(alice, "!ping");
 * // assert the bot replied:
 * // expect(channel.lastMessage?.content).toBe("Pong!");
 * ```
 */

// Core
export { createSandbox, Sandbox } from "./sandbox";
export type {
  SandboxOptions,
  CreateServerOptions,
  Recording,
} from "./sandbox";

// Fluent world API
export {
  SandboxServer,
  SandboxChannel,
  SandboxUser,
  SandboxRole,
  SandboxMember,
  SandboxMessage,
} from "./facade";
export type {
  SendOptions,
  SendInput,
  CreateChannelOptions,
  CreateRoleOptions,
  AddMemberOptions,
} from "./facade";

// Assertions
export { expect, AssertionError } from "./assertions/expect";
export type { Expectation, Matchers, AsyncMatchers } from "./assertions/expect";

// Model: enums, permissions, wire types
export { MessageType, ChannelType } from "./model/enums";
export type { AttachmentProvider } from "./model/enums";
export {
  RolePermissions,
  permissions,
  hasBit,
  addBit,
  removeBit,
} from "./model/permissions";
export type { PermissionName, PermissionBit } from "./model/permissions";
export type * from "./model/rawTypes";

// Gateway event names (for advanced/manual use)
export { ServerToClient, ClientToServer } from "./gateway/events";
export type { ServerToClientEvent } from "./gateway/events";
export type { FaultConfig } from "./gateway/gateway";

// Recorder
export { Recorder } from "./recorder/recorder";
export type { Session, RecordEntry, Direction } from "./recorder/recorder";

// Logging & debugging
export { Logger } from "./logging/logger";
export type { LogEntry, LogCategory, LogLevel, LoggerOptions } from "./logging/logger";
export { Debugger } from "./debugger/debugger";
export type { DebuggerSnapshot } from "./debugger/debugger";

// Time
export { Clock, parseDuration } from "./time/clock";
export type { TimeInput } from "./time/clock";

// Bot loader types
export type { NerimityClientLike, NerimityModule } from "./bot/loader";

// Fixtures (also available at "neritest/fixtures")
export * as fixtures from "./fixtures/index";
