# Testing cookbook

Recipes for common bot patterns. All of these are exercised by the runnable
[`examples/bots.test.ts`](../examples/bots.test.ts) and
[`test/integration`](../test/integration) suites.

A small helper used throughout:

```ts
const waitFor = async (fn: () => unknown, timeout = 3000) => {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};
const ready = (c: any) => new Promise((r) => c.on("ready", r));
const syncServer = (c: any, id: string) => waitFor(() => c.servers.cache.get(id));
```

## Ping / pong and edits

```ts
channel.send(alice, "!ping");
await waitFor(() => channel.lastMessage?.content?.startsWith("Pong!"));
```

## HTML content

Nerimity's HTML support is the message's `htmlEmbed` field, distinct from plain `content`.

```ts
channel.send(bob, { content: "hi", html: "<b>Hello!</b>" });
client.on("messageCreate", (m: any) => {
  m.content;         // "hi"
  m.raw.htmlEmbed;   // "<b>Hello!</b>"
});
// assert with the HTML matcher:
expect(channel.lastMessage?.htmlEmbed).toContainHtml("<b>");
```

## Reactions

```ts
const msg = channel.send(alice, "vote!");
msg.react(bob, "thumbsup");
client.on("messageReactionAdded", (reaction, user) => {
  reaction.name; // "thumbsup"
  user?.id;      // bob.id
});
```

## Buttons and modals

```ts
const msg = channel.send(alice, { content: "click", buttons: [{ id: "hi", label: "Hi" }] });
msg.clickButton(alice, "hi");
client.on("messageButtonClick", async (button) => {
  if (button.id === "hi") await button.respond({ title: "Hey", content: `Hi ${button.user?.username}!` });
});
```

## Moderation with permission enforcement

```ts
const server = sandbox.createServer({ name: "Guild", owner, botPermissions: permissions("BAN") });
const sdkServer = await syncServer(client, server.id);
await sdkServer.banMember(troll.id, { reason: "spam" });
expect(server.isBanned(troll)).toBe(true);
expect(troll.wasBanned(server)).toBe(true);
```

Give the bot no permission and assert the failure path:

```ts
const server = sandbox.createServer({ name: "Locked", owner, botPermissions: 0 });
const sdkServer = await syncServer(client, server.id);
await expect(sdkServer.banMember(victim.id)).rejects.toThrow(/not allowed to ban/);
```

## Automod (delete + warn)

```ts
const bad = channel.send(spammer, "buy cheap followers at spamlink.example");
await waitFor(() => bad.deleted);
expect(bad.deleted).toBe(true);
```

## Reaction roles

```ts
attachReactionRoles(client, {
  messageId: pinned.id,
  map: { gamepad: gamerRoleId },
  onAssign: (userId, roleId) => server.giveRole(sandbox.user(userId)!, roleId),
});
pinned.react(alice, "gamepad");
await waitFor(() => server.member(alice)?.hasRole(gamerRoleId));
```

## Cooldowns and scheduled jobs (virtual time)

Inject the sandbox clock so you can fast-forward instead of waiting:

```ts
attachEconomy(client, { now: () => sandbox.now() });

channel.send(user, "!daily");
await waitFor(() => channel.lastMessage?.content?.includes("claimed 100"));
channel.send(user, "!daily");
await waitFor(() => channel.lastMessage?.content?.includes("Already claimed"));

sandbox.advanceTime("24h");          // no real waiting
channel.send(user, "!daily");
await waitFor(() => channel.lastMessage?.content?.includes("Balance: 200"));
```

```ts
attachReminder(client, { schedule: (cb, ms) => sandbox.clock.setTimeout(cb, ms) });
channel.send(user, "!remind 60 water the plants");
sandbox.advanceTime("60s");
await waitFor(() => channel.lastMessage?.content?.includes("water the plants"));
```

## Rate limits, failures, latency

```ts
sandbox.api.rateLimit({ requests: 1, retryAfterMs: 1000 });
await expect(sdkChannel.send("hi")).rejects.toThrow(/rate limited/i);
await sdkChannel.send("ok"); // succeeds - one-shot

sandbox.api.failNext(400, { message: "Custom validation error." });
await expect(sdkChannel.send("x")).rejects.toThrow(/Custom validation/);

sandbox.api.setLatency(200);   // every REST call now takes ≥200ms
sandbox.api.hangNext(5000);    // next call hangs 5s (test your timeouts)
```

## Gateway faults and reconnection

```ts
sandbox.gateway.setLatency(50);          // add ws latency
sandbox.gateway.setPacketLoss(0.1);      // drop 10% of packets
sandbox.gateway.setDuplication(0.05);    // duplicate 5%
sandbox.gateway.rejectNextAuth();        // fail the next authenticate
sandbox.gateway.disconnect();            // drop all sockets; the SDK reconnects
```

## Slash commands

```ts
await register(client, sandbox.token);   // POST /applications/bot/commands
// the SDK parses "/help:botId 2" into message.command = { name: "help", args: ["2"] }
```

## Performance / load

```ts
const { server, users, channels } = sandbox.loadFixture("large-server");
// 200 users, 25 channels, ~1000 messages by default - tune via a custom builder.
```
