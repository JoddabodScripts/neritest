# NeriTest

[![npm version](https://img.shields.io/npm/v/neritest-js.svg)](https://www.npmjs.com/package/neritest-js)
[![license](https://img.shields.io/npm/l/neritest-js.svg)](LICENSE)

A local sandbox that emulates the [Nerimity](https://nerimity.com) runtime so you can
develop and test [`@nerimity/nerimity.js`](https://github.com/Nerimity/nerimity.js) bots
without ever touching production.

NeriTest runs a **real socket.io gateway** and a **real HTTP API** in-process and points
your bot's real `Client` at them. Your bot connects for real, authenticates for real, and
sends real REST requests. At the wire level there is nothing to distinguish the sandbox
from `wss://nerimity.com`, so behaviour you observe here matches a live server closely.

> If it works in NeriTest, it should behave the same way on Nerimity.

---

## Why this approach

nerimity.js talks to the outside world two ways, both redirectable:

- **Gateway** - `socket.io-client` → overridable via `new Client({ wsUrlOverride })`
- **REST** - `fetch` → overridable via `apiUrlOverride`

Rather than monkeypatch the SDK (fragile, drifts from reality), NeriTest stands up real
servers speaking the exact protocol and lets the unmodified SDK connect. Three hosts the
SDK hardcodes (`cdn.nerimity.com`, `nerimity.com/api/webhooks`, RPC) are handled by a
narrow global `fetch` shim.

---

## Install

```bash
npm install --save-dev neritest-js
# your bot brings its own SDK:
npm install @nerimity/nerimity.js
```

Requires Node 18+. Ships ESM + CommonJS + TypeScript types.

---

## Quickstart

```ts
import { createSandbox, expect } from "neritest-js";

const sandbox = createSandbox();

const server = sandbox.createServer({ name: "Development" });
const channel = server.createChannel({ name: "general" });
const alice = sandbox.createUser({ username: "Alice" });

// A real nerimity.js Client, wired to the sandbox:
const client = await sandbox.createClient();

client.on("messageCreate", async (message) => {
  if (message.user.id === client.user.id) return;
  if (message.content === "!ping") await message.reply("Pong!");
});

// Wait for the bot to connect, then have Alice send a message:
await new Promise((r) => client.on("ready", r));
channel.send(alice, "!ping");

// ...the bot replies over the real REST API; assert on the result:
// expect(channel.lastMessage?.content).toBe("Pong!");

await sandbox.close();
```

## Three ways to run your bot

| Method | Bot changes | Use when |
| --- | --- | --- |
| `await sandbox.createClient()` | one line (`new Client()` → this) | most tests |
| `await sandbox.mount(client)` | none, you pass the client | you already built a client |
| `await sandbox.loadBot("./bot.ts")` | **zero** | run an entire unmodified bot file |

`loadBot` patches the SDK's endpoints before importing your bot, so a vanilla
`new Client(); client.login("token")` connects straight to the sandbox.

---

## What's emulated

- **Every client event**: `ready`, `messageCreate`/`Update`/`Delete`,
  `messageReactionAdded`/`Removed`, `serverMemberJoined`/`Left`/`Updated`,
  `serverJoined`/`Left`, `messageButtonClick`, `serverChannelCreated`/`Updated`/`Deleted`,
  `serverRoleCreated`/`Updated`/`Deleted`/`OrderUpdated`.
- **The gateway handshake** - `user:authenticate` → `user:authenticated` with the exact
  payload shape the SDK parses.
- **The REST API** - send/edit/delete messages, ban/kick, posts, bot commands, button
  callbacks, webhooks. Faithful success **and** error/permission responses.
- **Message content** - plain text, **HTML** (`htmlEmbed`), embeds, attachments, buttons,
  reactions, mentions (`[@:id]`), replies/quotes, silent, edits, deletes, system messages.
- **Permissions** - the same 9-bit field and the same `hasPermission` math (admin + creator
  bypass) the SDK uses, so a `403` here lines up with a `403` in production.
- **Fault injection** - latency, packet loss, duplicate packets, forced disconnects,
  rate limits, forced failures, request hangs.
- **Virtual time** - fast-forward cooldowns, reminders and scheduled jobs with
  `sandbox.advanceTime("24h")`; no real waiting.
- **Record / replay**, **fixtures**, **structured logging**, and a **live debugger**.

See [docs/architecture.md](docs/architecture.md) for the full audit of what was mirrored.

---

## Documentation

- [Getting started](docs/getting-started.md)
- [API reference](docs/api-reference.md)
- [Testing cookbook](docs/cookbook.md) - recipes for moderation, automod, welcome,
  economy, reaction-roles, scheduled jobs, permissions, fault injection
- [Fixtures guide](docs/fixtures.md)
- [Debugging guide](docs/debugging.md)
- [Architecture](docs/architecture.md)
- [Migration guide](docs/migration.md)
- Runnable [examples](examples/) - real bots plus their tests

---

## A moderation test, end to end

```ts
import { createSandbox, permissions, RolePermissions } from "neritest-js";

const sandbox = createSandbox();
const owner = sandbox.createUser({ username: "Owner" });
const server = sandbox.createServer({ name: "Guild", owner, botPermissions: permissions("BAN") });
const troll = sandbox.createUser({ username: "Troll" });
server.addMember(troll);

const client = await sandbox.createClient();
await new Promise((r) => client.on("ready", r));

// wait for the bot to receive the server, then ban via the SDK:
const sdkServer = client.servers.cache.get(server.id);
await sdkServer.banMember(troll.id, { reason: "spam" });

console.log(server.isBanned(troll)); // true
console.log(troll.wasBanned(server)); // true
await sandbox.close();
```

Take away the bot's `BAN` permission (`botPermissions: 0`) and the same call rejects with
the real "You are not allowed to ban members." error.

---

## Status

The core - gateway, REST API, data model, event emulation, permissions, HTML, fault
injection, virtual time, record/replay, fixtures, assertions, logging, debugger - is
implemented and covered by a passing test suite that drives the **real** nerimity.js SDK.
See [docs/architecture.md](docs/architecture.md#known-limitations) for known limitations.

## License

MIT
