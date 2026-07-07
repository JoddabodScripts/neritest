import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { createSandbox, type Sandbox, RolePermissions } from "../../src/index";
import { waitFor, waitReady } from "../helpers";

// A single sandbox + real nerimity.js client shared across the suite.
let sandbox: Sandbox;
let client: any;

describe("real nerimity.js bot against the sandbox", () => {
  before(async () => {
    sandbox = createSandbox();
    await sandbox.ready();
    client = await sandbox.createClient();
    await waitReady(client);
  });

  after(async () => {
    await sandbox.close();
  });

  test("ready fires and identifies as the sandbox bot", () => {
    assert.equal(client.user.username, "TestBot");
    assert.equal(client.user.id, sandbox.bot.id);
  });

  test("messageCreate delivers a plain-text message and reply round-trips", async () => {
    const server = sandbox.createServer({ name: "Ping Server" });
    const channel = server.createChannel({ name: "general" });
    const alice = sandbox.createUser({ username: "Alice" });
    server.addMember(alice);

    const handler = async (message: any) => {
      if (message.user.id === client.user.id) return;
      if (message.channelId !== channel.id) return;
      if (message.content === "!ping") await message.reply("Pong!");
    };
    client.on("messageCreate", handler);

    channel.send(alice, "!ping");
    const reply = await waitFor(() =>
      channel.lastMessage?.content === "Pong!" ? channel.lastMessage : undefined,
    );
    assert.equal(reply.content, "Pong!");
    assert.equal(reply.authorId, client.user.id);
    client.off("messageCreate", handler);
  });

  test("HTML content is preserved distinctly from plain text", async () => {
    const server = sandbox.createServer({ name: "HTML Server" });
    const channel = server.createChannel({ name: "html" });
    const bob = sandbox.createUser({ username: "Bob" });
    server.addMember(bob);

    let seenHtml: string | undefined;
    let seenContent: string | undefined;
    const handler = (message: any) => {
      if (message.channelId !== channel.id) return;
      seenHtml = message.raw.htmlEmbed;
      seenContent = message.content;
    };
    client.on("messageCreate", handler);

    channel.send(bob, { content: "hello", html: "<b>Hello!</b>" });
    await waitFor(() => seenHtml);
    assert.equal(seenHtml, "<b>Hello!</b>");
    assert.equal(seenContent, "hello");
    client.off("messageCreate", handler);
  });

  test("reactions fire messageReactionAdded with the reacting user", async () => {
    const server = sandbox.createServer({ name: "React Server" });
    const channel = server.createChannel({ name: "react" });
    const carol = sandbox.createUser({ username: "Carol" });
    server.addMember(carol);

    // First get a message into the bot's cache by having the bot send one.
    const posted = await sandbox.api.post(`/api/channels/${channel.id}/messages`, {
      content: "react to me",
    });
    const messageId = (posted.body as any).id;

    let reactionName: string | undefined;
    let reactorId: string | undefined;
    const handler = (reaction: any, user: any) => {
      reactionName = reaction.name;
      reactorId = user?.id;
    };
    client.on("messageReactionAdded", handler);

    // Carol reacts.
    sandbox.store.addReaction(channel.id, messageId, carol.id, { name: "👍" });
    await waitFor(() => reactionName);
    assert.equal(reactionName, "👍");
    assert.equal(reactorId, carol.id);
    client.off("messageReactionAdded", handler);
  });

  test("button clicks fire messageButtonClick", async () => {
    const server = sandbox.createServer({ name: "Button Server" });
    const channel = server.createChannel({ name: "buttons" });
    const dave = sandbox.createUser({ username: "Dave" });
    server.addMember(dave);

    const msg = channel.send(dave, { content: "click", buttons: [{ id: "hello", label: "Hello!" }] });

    let clickedId: string | undefined;
    let clickerName: string | undefined;
    const handler = (button: any) => {
      clickedId = button.id;
      clickerName = button.user?.username;
    };
    client.on("messageButtonClick", handler);

    msg.clickButton(dave, "hello");
    await waitFor(() => clickedId);
    assert.equal(clickedId, "hello");
    // Dave is in the user cache because he authored a message the bot saw.
    assert.equal(clickerName, "Dave");
    client.off("messageButtonClick", handler);
  });
});
