# Getting started

## Install

```bash
npm install --save-dev neritest-js
npm install @nerimity/nerimity.js
```

Node 18+. Works with any test runner (or none - the bundled `expect` throws on failure).

## Your first test

NeriTest doesn't care which runner you use. Here it is with Node's built-in `node:test`:

```ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createSandbox } from "neritest-js";

test("bot replies to !ping", async () => {
  const sandbox = createSandbox();
  const server = sandbox.createServer({ name: "Dev" });
  const channel = server.createChannel({ name: "general" });
  const alice = sandbox.createUser({ username: "Alice" });
  server.addMember(alice);

  const client = await sandbox.createClient();
  client.on("messageCreate", async (m: any) => {
    if (m.user.id === client.user.id) return;
    if (m.content === "!ping") await m.reply("Pong!");
  });
  await new Promise((r) => client.on("ready", r));

  channel.send(alice, "!ping");

  // poll until the reply lands (it round-trips through the real REST API)
  await waitFor(() => channel.lastMessage?.content === "Pong!");
  assert.equal(channel.lastMessage?.content, "Pong!");

  await sandbox.close();
});

function waitFor(fn: () => unknown, timeout = 3000) {
  return new Promise<void>((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (fn()) return resolve();
      if (Date.now() - start > timeout) return reject(new Error("timed out"));
      setTimeout(tick, 10);
    };
    tick();
  });
}
```

## Mental model

There are two sides:

- **The world** - you, the test author, driving `sandbox.*` and the facade objects
  (`SandboxServer`, `SandboxChannel`, `SandboxUser`, `SandboxMessage`). When Alice sends a
  message, that's the world.
- **The bot** - the real nerimity.js `Client`. It receives gateway events and makes REST
  calls, exactly as it would against production.

Because the two sides communicate over real sockets/HTTP, things are **asynchronous**. After
a world action, `await` or poll for the bot's reaction rather than asserting synchronously.

## Things to remember

- **`await sandbox.ready()`** (or `await sandbox.createClient()`, which awaits it) before a
  bot connects. World-building (`createServer`, `channel.send`) works immediately.
- **Create servers/channels before the bot connects** when you can - they arrive in the auth
  payload and are cached. If you create them after, wait for the SDK cache to populate
  (`waitFor(() => client.servers.cache.get(id))`) before using SDK objects.
- **Guard the bot's own messages** with `if (message.user.id === client.user.id) return;` -
  the bot receives its own sends over the gateway, just like production.
- **Always `await sandbox.close()`** so ports are freed and the bot's socket stops
  reconnecting.

Next: the [cookbook](cookbook.md) for recipes, or the [API reference](api-reference.md).
