/**
 * Reusable fixtures.
 *
 * A fixture is just a function that takes a sandbox and populates it, returning
 * a handle to the things it created. Ship your own, or use a builtin by name via
 * `sandbox.loadFixture("large-server")`. Builtins are intentionally simple and
 * composable so they double as worked examples.
 */
import type { Sandbox } from "../sandbox";
import type { SandboxServer, SandboxChannel, SandboxUser, SandboxRole } from "../facade";
import { permissions } from "../model/permissions";

export interface BasicFixture {
  server: SandboxServer;
  general: SandboxChannel;
  owner: SandboxUser;
  members: SandboxUser[];
}

export interface ModerationFixture extends BasicFixture {
  adminRole: SandboxRole;
  modRole: SandboxRole;
  admin: SandboxUser;
  troublemaker: SandboxUser;
}

export interface LargeServerFixture {
  server: SandboxServer;
  channels: SandboxChannel[];
  roles: SandboxRole[];
  users: SandboxUser[];
}

/** A single server with one channel, an owner, and a few plain members. */
export function basic(sandbox: Sandbox): BasicFixture {
  const owner = sandbox.createUser({ username: "Owner" });
  const server = sandbox.createServer({ name: "Test Server", owner });
  const members = ["Alice", "Bob", "Carol"].map((username) => {
    const u = sandbox.createUser({ username });
    server.addMember(u);
    return u;
  });
  return { server, general: server.defaultChannel, owner, members };
}

/** A server set up for moderation-bot testing: admin/mod roles and a troublemaker. */
export function moderation(sandbox: Sandbox): ModerationFixture {
  const base = basic(sandbox);
  const adminRole = base.server.createRole({
    name: "Admin",
    permissions: permissions("ADMIN"),
    hexColor: "#ff8c00",
  });
  const modRole = base.server.createRole({
    name: "Moderator",
    permissions: permissions("KICK", "BAN"),
    hexColor: "#57f287",
  });
  const admin = sandbox.createUser({ username: "AdminUser" });
  base.server.addMember(admin, { roles: [adminRole] });
  const troublemaker = sandbox.createUser({ username: "Troublemaker" });
  base.server.addMember(troublemaker);
  return { ...base, adminRole, modRole, admin, troublemaker };
}

/**
 * A stress fixture: a server with many channels, roles, users and messages.
 * Tune with the options; defaults are chosen to be big but fast.
 */
export function largeServer(
  sandbox: Sandbox,
  opts: { users?: number; channels?: number; roles?: number; messagesPerChannel?: number } = {},
): LargeServerFixture {
  const userCount = opts.users ?? 200;
  const channelCount = opts.channels ?? 25;
  const roleCount = opts.roles ?? 15;
  const messagesPer = opts.messagesPerChannel ?? 40;

  const owner = sandbox.createUser({ username: "BigOwner" });
  const server = sandbox.createServer({ name: "Large Server", owner });

  const roles: SandboxRole[] = [];
  for (let i = 0; i < roleCount; i++) {
    roles.push(server.createRole({ name: `Role ${i}`, permissions: i % 2 ? 2 : 0 }));
  }

  const users: SandboxUser[] = [];
  for (let i = 0; i < userCount; i++) {
    const u = sandbox.createUser({ username: `User${i}` });
    server.addMember(u, { roles: i % 3 === 0 ? [roles[i % roles.length]] : [] });
    users.push(u);
  }

  const channels: SandboxChannel[] = [server.defaultChannel];
  for (let i = 1; i < channelCount; i++) {
    channels.push(server.createChannel({ name: `channel-${i}` }));
  }

  for (const channel of channels) {
    for (let m = 0; m < messagesPer; m++) {
      const author = users[(m + channels.indexOf(channel)) % users.length];
      channel.send(author, `message ${m} in ${channel.name}`);
    }
  }

  return { server, channels, roles, users };
}

export const builtinFixtures: Record<string, (sandbox: Sandbox) => unknown> = {
  basic,
  moderation,
  "large-server": largeServer,
};
