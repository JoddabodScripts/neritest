# Migration guide

## Running an existing bot under NeriTest

Your bot needs little or no change. Pick the option that fits.

### Option A - one-line change (recommended)

Wherever you build the client:

```diff
- const client = new Client();
- client.login(process.env.TOKEN);
+ const client = await sandbox.createClient();
```

`createClient()` returns a real `@nerimity/nerimity.js` `Client` already pointed at the
sandbox and logged in. Everything else - your event handlers, REST calls, command parsing -
is unchanged.

To keep one codebase for both, branch on an env var:

```ts
const client = process.env.NERITEST
  ? await sandbox.createClient()
  : (() => { const c = new Client(); c.login(process.env.TOKEN!); return c; })();
```

### Option B - mount an existing client

If your bot already constructs the client and you just want to point it at the sandbox:

```ts
const client = new Client();
attachHandlers(client);
await sandbox.mount(client); // repoints ws + REST and logs in as the sandbox bot
```

### Option C - zero changes (`loadBot`)

Run an entire unmodified bot file. NeriTest patches the SDK's endpoints before importing it,
so a vanilla `new Client(); client.login("token")` connects to the sandbox:

```ts
await sandbox.loadBot("./src/bot.ts"); // or .js / .cjs / .mjs
```

The bot's token can be anything - unknown tokens authenticate as the sandbox bot (disable
with `createSandbox({ acceptAnyToken: false })` if you want strict tokens).

## Making time-based logic testable

Bots that use bare `Date.now()` / `setTimeout` run in **real time** in the sandbox - the
virtual clock can't see them. To fast-forward cooldowns/reminders, inject the clock:

```diff
- const now = Date.now();
+ const now = deps.now();            // deps.now = () => sandbox.now() in tests, Date.now in prod

- setTimeout(fire, ms);
+ deps.schedule(fire, ms);           // deps.schedule = sandbox.clock.setTimeout in tests
```

This dependency-injection pattern (see the economy and reminder examples) keeps production
code unchanged while making `sandbox.advanceTime("24h")` drive your logic instantly.

## Gotchas when porting assertions

- **Async, not sync.** World actions reach the bot over real sockets/HTTP. Poll or `await`;
  don't assert immediately after `channel.send`.
- **The bot sees its own messages.** Keep your `if (message.user.id === client.user.id)`
  guards - production behaves the same.
- **Mentions are tokens.** Message `content` contains `[@:id]`, not usernames. Assert against
  the token or the `htmlEmbed`, or resolve via `message.mentions`.
- **Cache timing.** Servers/channels created before the bot connects arrive in the auth
  payload; created after, they arrive via events - wait for `client.*.cache` to populate.

## From a live server to the sandbox

Behaviour parity is the design goal, but two things are intentionally different:

- **No real network, no real CDN.** Attachment uploads are acknowledged with a synthetic id.
- **Only as faithful as your installed SDK.** Pin `@nerimity/nerimity.js`; NeriTest mirrors
  the shapes that version parses. See [architecture.md](architecture.md#known-limitations).
