# Debugging

## Live logs

Every subsystem logs through one structured, filterable stream. Turn it on:

```ts
const sandbox = createSandbox({ logging: { console: true } });
```

Categories: `api`, `ws`, `gateway`, `event`, `permission`, `timing`, `system`. Filter to
just what you care about:

```ts
const sandbox = createSandbox({
  logging: { console: true, categories: ["api", "permission"], level: "info" },
});
```

Or subscribe programmatically (this is how the debugger and recorder work):

```ts
const off = sandbox.logs.onLog((entry) => {
  if (entry.category === "permission") console.log("PERM:", entry.message, entry.data);
});
// ...later
off();
```

Snapshot retained entries after the fact:

```ts
const perm403s = sandbox.logs.entries({ category: "permission" });
```

## The live debugger

```ts
sandbox.debug.attach();              // stream all activity to the console
sandbox.debug.attach({ filter: ["ws", "api"] });

sandbox.debug.renderState();         // print the whole world as a tree
const snap = sandbox.debug.snapshot(); // structured state for a custom UI
```

`renderState()` prints users (bots marked ◆), servers, their roles, members, and per-channel
message counts. `snapshot()` returns the same data as `DebuggerSnapshot` so you can render it
however you like - a web dashboard, a TUI, a CI artifact.

## Record & replay

Capture a session and turn a bug into a regression test:

```ts
const rec = sandbox.record();
// ...drive the scenario...
rec.save("session.json");
```

Replay the exact server→client packet sequence into a fresh bot:

```ts
const sandbox = createSandbox();
const client = await sandbox.createClient();
await new Promise((r) => client.on("ready", r));
await sandbox.replay("session.json");            // back-to-back
await sandbox.replay("session.json", { realtime: true, speed: 2 }); // honour timing, 2× faster
```

## Inspecting raw state

`sandbox.store` is the escape hatch to canonical state when you need to assert on something
the facade doesn't surface:

```ts
sandbox.store.messagesForChannel(channel.id);   // RawMessage[]
sandbox.store.memberPermissions(serverId, userId);
sandbox.store.commands;                          // registered bot commands by token
```

## Known SDK bug: patched automatically

`@nerimity/nerimity.js` (through at least v1.20.1) has a real bug in `Message._update()`:
it updates `message.content`/`message.editedAt` but never syncs `message.raw`, and
`htmlEmbed` has no top-level getter at all - it only ever lives on `.raw`. The upshot,
unpatched: after any edit, a cached `Message` object's `raw.htmlEmbed`/`raw.content` stay
stale forever, even though the `messageUpdate` event fires at the right time with the
right data underneath.

NeriTest patches this - it's the one deliberate exception to "never monkeypatch the SDK,"
since it fixes an upstream bug rather than faking sandbox behavior. It's applied
automatically the first time you call `sandbox.createClient()`, `sandbox.mount()`, or
`sandbox.loadBot()` (see `BotLoader.patchKnownSdkBugs` in `src/bot/loader.ts`). You don't
need to do anything; `message.raw.htmlEmbed` and `message.raw.content` will reflect the
latest edit inside a `messageUpdate` handler, same as they would if the SDK didn't have
the bug.

## When a bot doesn't react

1. Did the bot connect and authenticate? `sandbox.gateway.connectionCount` > 0 and a
   `ready` event.
2. Was it created after the server? Wait for the SDK cache
   (`waitFor(() => client.servers.cache.get(serverId))`).
3. Is the bot a member of that server? Only members receive server events.
4. Turn on `logging: { console: true }` and watch the `ws` and `event` categories.
