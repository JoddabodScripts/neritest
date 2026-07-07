import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { createSandbox, type Sandbox, RolePermissions, permissions } from "../../src/index";
import { waitFor, waitReady } from "../helpers";

describe("moderation, permissions and fault injection", () => {
  let sandbox: Sandbox;
  let client: any;

  before(async () => {
    sandbox = createSandbox();
    await sandbox.ready();
    client = await sandbox.createClient();
    await waitReady(client);
  });

  after(async () => {
    await sandbox.close();
  });

  // Wait until the bot's SDK cache has received a server/channel via the gateway.
  const syncServer = (id: string) => waitFor(() => client.servers.cache.get(id));
  const syncChannel = (id: string) => waitFor(() => client.channels.cache.get(id));

  test("bot with BAN permission can ban a member", async () => {
    const owner = sandbox.createUser({ username: "Owner" });
    const server = sandbox.createServer({ name: "Mod Server", owner, botPermissions: permissions("BAN") });
    const troublemaker = sandbox.createUser({ username: "Troublemaker" });
    server.addMember(troublemaker);

    const sdkServer = await syncServer(server.id);
    await sdkServer.banMember(troublemaker.id, { reason: "spam" });

    await waitFor(() => (server.isBanned(troublemaker) ? true : undefined));
    assert.equal(server.isBanned(troublemaker), true);
    assert.equal(troublemaker.wasBanned(server), true);
  });

  test("bot WITHOUT permission gets a 403 that throws in the SDK", async () => {
    const owner = sandbox.createUser({ username: "Owner2" });
    const server = sandbox.createServer({ name: "Locked Server", owner, botPermissions: 0 });
    const victim = sandbox.createUser({ username: "Victim" });
    server.addMember(victim);

    const sdkServer = await syncServer(server.id);
    await assert.rejects(
      () => sdkServer.banMember(victim.id),
      (err: Error) => {
        assert.match(err.message, /not allowed to ban/);
        return true;
      },
    );
    assert.equal(server.isBanned(victim), false);
  });

  test("kick removes the member and records history", async () => {
    const owner = sandbox.createUser({ username: "Owner3" });
    const server = sandbox.createServer({ name: "Kick Server", owner, botPermissions: permissions("KICK") });
    const target = sandbox.createUser({ username: "Target" });
    server.addMember(target);

    const sdkServer = await syncServer(server.id);
    await sdkServer.kickMember(target.id);
    await waitFor(() => (server.member(target) ? undefined : true));
    assert.equal(server.member(target), undefined);
    assert.equal(target.wasKicked(server), true);
  });

  test("permission math matches the SDK (default role + assigned roles + admin bypass)", () => {
    const server = sandbox.createServer({ name: "Perm Server" });
    const user = sandbox.createUser({ username: "Perms" });
    const modRole = server.createRole({ name: "Mod", permissions: permissions("KICK", "BAN") });
    server.addMember(user, { roles: [modRole] });

    const member = server.member(user)!;
    assert.equal(member.hasPermission(RolePermissions.KICK), true);
    assert.equal(member.hasPermission(RolePermissions.BAN), true);
    assert.equal(member.hasPermission(RolePermissions.MANAGE_ROLES), false);

    const adminRole = server.createRole({ name: "Admin", permissions: permissions("ADMIN") });
    server.giveRole(user, adminRole);
    assert.equal(member.hasPermission(RolePermissions.MANAGE_ROLES), true);
    assert.equal(member.roles.some((r) => r.name === "Admin"), true);
  });

  test("rate limit makes the next REST call reject with 429", async () => {
    const server = sandbox.createServer({ name: "RL Server" });
    const channel = server.createChannel({ name: "spam" });
    const sdkChannel = await syncChannel(channel.id);

    sandbox.api.rateLimit({ requests: 1, retryAfterMs: 1000 });
    await assert.rejects(
      () => sdkChannel.send("hello"),
      (err: Error) => {
        assert.match(err.message, /rate limited/i);
        return true;
      },
    );

    const ok = await sdkChannel.send("second try");
    assert.equal(ok.content, "second try");
  });

  test("forced failure surfaces the exact error body to the bot", async () => {
    const server = sandbox.createServer({ name: "Fail Server" });
    const channel = server.createChannel({ name: "fail" });
    const sdkChannel = await syncChannel(channel.id);

    sandbox.api.failNext(400, { message: "Custom validation error." });
    await assert.rejects(
      () => sdkChannel.send("nope"),
      (err: Error) => {
        assert.match(err.message, /Custom validation error/);
        return true;
      },
    );
  });
});
