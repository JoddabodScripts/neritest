import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createSandbox, type Sandbox } from "../src/index";
import { waitFor, waitReady } from "../test/helpers";

import { attach as attachPingPong } from "./bots/ping-pong";
import { attach as attachWelcome } from "./bots/welcome";
import { attach as attachAutomod } from "./bots/automod";
import { attach as attachEconomy } from "./bots/economy";
import { attach as attachReminder } from "./bots/reminder";

describe("example bots run in the sandbox", () => {
  let sandbox: Sandbox;
  let client: any;
  const syncServer = (id: string) => waitFor(() => client.servers.cache.get(id));

  before(async () => {
    sandbox = createSandbox();
    await sandbox.ready();
    client = await sandbox.createClient();
    await waitReady(client);
    // Attach every example bot; each guards on its own command/channel.
    attachPingPong(client);
    attachWelcome(client);
    attachAutomod(client);
  });
  after(async () => {
    await sandbox.close();
  });

  test("ping-pong replies and edits with latency", async () => {
    const server = sandbox.createServer({ name: "PP" });
    const channel = server.createChannel({ name: "general" });
    const alice = sandbox.createUser({ username: "Alice" });
    server.addMember(alice);
    await syncServer(server.id);

    channel.send(alice, "!ping");
    const reply = await waitFor(() =>
      channel.lastMessage?.content?.startsWith("Pong!") ? channel.lastMessage : undefined,
    );
    assert.match(reply.content!, /Pong! \(\d+ms\)/);
  });

  test("welcome bot greets new members", async () => {
    const server = sandbox.createServer({ name: "Welcoming" });
    await syncServer(server.id);
    const newbie = sandbox.createUser({ username: "Newbie" });

    server.addMember(newbie);
    const greeting = await waitFor(() => {
      const last = server.defaultChannel.lastMessage;
      // Content carries a mention token (`[@:id]`); the username lives in the HTML.
      return last?.content?.includes("Welcome") ? last : undefined;
    });
    assert.match(greeting.content!, /Welcome to \*\*Welcoming\*\*/);
    assert.equal(greeting.htmlEmbed, "<h3>Welcome Newbie!</h3><p>Glad to have you.</p>");
  });

  test("automod deletes banned words", async () => {
    const server = sandbox.createServer({ name: "Clean" });
    const channel = server.createChannel({ name: "chat" });
    const spammer = sandbox.createUser({ username: "Spammer" });
    server.addMember(spammer);
    await syncServer(server.id);

    const bad = channel.send(spammer, "this contains badword yikes");
    await waitFor(() => (bad.deleted ? true : undefined));
    assert.equal(bad.deleted, true);
    const warn = await waitFor(() =>
      channel.lastMessage?.content?.includes("wasn't allowed") ? channel.lastMessage : undefined,
    );
    assert.match(warn.content!, /wasn't allowed/);
  });
});

describe("virtual time drives cooldowns and scheduled jobs", () => {
  let sandbox: Sandbox;
  let client: any;
  const syncServer = (id: string) => waitFor(() => client.servers.cache.get(id));

  before(async () => {
    sandbox = createSandbox({ startTime: 1_700_000_000_000 });
    await sandbox.ready();
    client = await sandbox.createClient();
    await waitReady(client);
    // Inject the sandbox's virtual clock into the time-based bots.
    attachEconomy(client, { now: () => sandbox.now() });
    attachReminder(client, { schedule: (cb, ms) => sandbox.clock.setTimeout(cb, ms) });
  });
  after(async () => {
    await sandbox.close();
  });

  test("economy !daily enforces a 24h cooldown via advanceTime", async () => {
    const server = sandbox.createServer({ name: "Bank" });
    const channel = server.createChannel({ name: "econ" });
    const user = sandbox.createUser({ username: "Saver" });
    server.addMember(user);
    await syncServer(server.id);

    channel.send(user, "!daily");
    await waitFor(() =>
      channel.lastMessage?.content?.includes("claimed 100") ? true : undefined,
    );

    channel.send(user, "!daily");
    await waitFor(() =>
      channel.lastMessage?.content?.includes("Already claimed") ? true : undefined,
    );

    sandbox.advanceTime("24h");
    channel.send(user, "!daily");
    await waitFor(() => {
      const c = channel.lastMessage?.content;
      return c?.includes("Balance: 200") ? true : undefined;
    });
    assert.match(channel.lastMessage!.content!, /Balance: 200/);
  });

  test("reminder fires only after advanceTime", async () => {
    const server = sandbox.createServer({ name: "Remind" });
    const channel = server.createChannel({ name: "reminders" });
    const user = sandbox.createUser({ username: "Forgetful" });
    server.addMember(user);
    await syncServer(server.id);

    channel.send(user, "!remind 60 water the plants");
    await waitFor(() =>
      channel.lastMessage?.content?.includes("remind you in 60s") ? true : undefined,
    );

    // Not yet fired.
    assert.equal(sandbox.clock.pending, 1);

    sandbox.advanceTime("60s");
    await waitFor(() =>
      channel.lastMessage?.content?.includes("water the plants") ? true : undefined,
    );
    assert.match(channel.lastMessage!.content!, /reminder: water the plants/);
  });
});

describe("zero-modification bot via loadBot", () => {
  test("a vanilla require('@nerimity/nerimity.js') bot connects unchanged", async () => {
    const sandbox = createSandbox();
    await sandbox.ready();

    const server = sandbox.createServer({ name: "Vanilla" });
    const channel = server.createChannel({ name: "general" });
    const user = sandbox.createUser({ username: "Human" });
    server.addMember(user);

    const botPath = fileURLToPath(new URL("./standalone/vanilla-bot.cjs", import.meta.url));
    await sandbox.loadBot(botPath);

    // Give the vanilla bot a moment to connect (it has no ready hook we can await).
    await waitFor(() => (sandbox.gateway.connectionCount > 0 ? true : undefined));
    await new Promise((r) => setTimeout(r, 150));

    channel.send(user, "!hello");
    const reply = await waitFor(() =>
      channel.lastMessage?.content === "Hi from the vanilla bot!" ? channel.lastMessage : undefined,
    );
    assert.equal(reply.content, "Hi from the vanilla bot!");

    await sandbox.close();
  });
});
