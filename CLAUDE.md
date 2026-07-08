# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`neritest-js` (npm) - a local sandbox that emulates the Nerimity runtime so bots built with
`@nerimity/nerimity.js` can be tested without touching production. It does not mock or monkeypatch
the SDK: it runs a real socket.io gateway and a real Express HTTP API in-process, then points an
unmodified SDK `Client` at them via its own `wsUrlOverride`/`apiUrlOverride` hooks. The bot connects,
authenticates, and calls REST endpoints for real; the wire protocol matches production.

## Commands

```bash
npm run build            # tsup -> dist/ (ESM + CJS + .d.ts), two entry points: index and fixtures/index
npm run dev              # tsup --watch
npm run typecheck        # tsc --noEmit
npm test                 # runs test/**/*.test.ts and examples/**/*.test.ts via node's built-in test runner (tsx loader)
npm run test:integration # only test/integration/**/*.test.ts
```

Run a single test file directly, e.g.:
```bash
node --import tsx --test test/integration/moderation.test.ts
```

There is no lint script. `prepublishOnly` runs typecheck -> test -> build, in that order.

The docs site (`frontend/*.html`) is statically generated from the markdown in `docs/` and the root
`README.md`/`examples/README.md`. After editing any of those markdown files, regenerate with:
```bash
node frontend/build.mjs
```
Do not hand-edit the generated `.html` files in `frontend/` - edit the source markdown and rebuild.

## Architecture

Everything is one package, but strictly layered. The `Sandbox` (`src/sandbox.ts`) is the
orchestrator wiring all of it together: virtual clock, id generation, the store, gateway, API
server, recorder, debugger, and the bot loader. Construction is synchronous; the gateway/API bind
to ports asynchronously, but world-side operations (creating servers/users, sending messages) work
against the store immediately without waiting for the servers to be up. Anything that must connect
a bot (`createClient`/`mount`/`loadBot`) awaits readiness internally.

```
Sandbox (orchestrator)
   |-- Facade objects (SandboxServer/Channel/User/Message/...) <- test author drives this ("world" side)
   |-- Store (single source of truth: Raw* payloads, mutations emit domain events)
   |-- Gateway (socket.io server) <---> real nerimity.js Client
   |-- ApiServer (express)        <---> real nerimity.js Client
   `-- BotLoader (createClient / mount / loadBot)              <- real SDK connects here ("bot" side)
```

Data flow is bidirectional through the `Store`:
- **World -> bot**: a facade call (e.g. `channel.send(alice, "!ping")`) mutates the `Store`, which
  emits a domain event (e.g. `messageCreated`). The `Gateway` forwards it as the real
  `message:created` socket.io packet to whichever sockets should see it (server members / DM
  participants). The SDK parses it and fires `messageCreate`.
- **Bot -> world**: the bot calls the SDK (e.g. `message.reply(...)`), which does a real `fetch` to
  the `ApiServer`. The handler checks permissions, mutates the `Store`, and returns the exact `Raw*`
  body the SDK expects. That mutation also emits a domain event, which the gateway delivers back to
  the bot's own socket - the SDK does not dedupe its own messages, faithfully matching production
  (hence bots must guard with `if (message.user.id === client.user.id) return`).

Module map (see `docs/architecture.md` for the full version):

| Module | Responsibility |
| --- | --- |
| `src/model/store.ts` | Single source of truth; all state as `Raw*` payloads; mutations emit typed domain events |
| `src/model/rawTypes.ts` | Wire payload shapes mirrored 1:1 from the SDK's `RawData.ts` |
| `src/model/enums.ts`, `permissions.ts` | `MessageType`, `ChannelType`, the 9-bit permission field mirrored from the SDK |
| `src/gateway/` | Real socket.io server: auth handshake, event routing, fault injection |
| `src/api/` | Real express server: every REST endpoint used by the SDK, faithful success/error bodies, fault injection |
| `src/facade.ts` | Fluent "world" API (`SandboxServer`/`Channel`/`User`/`Message`/...) |
| `src/bot/` | `createClient`/`mount`/`loadBot`, plus the CDN/webhook `fetch` shim |
| `src/time/clock.ts` | Virtual clock/timers backing `sandbox.advanceTime(...)` |
| `src/recorder/` | Record/replay of gateway + API traffic |
| `src/logging/`, `src/debugger/` | Structured filterable logs and a live debugger |
| `src/fixtures/` | Reusable state builders (separate `neritest-js/fixtures` entry point) |
| `src/assertions/` | A small Jest-shaped `expect` |

### Three ways to attach a bot (`src/bot/loader.ts`)

- `sandbox.createClient()` - constructs `new Client({ wsUrlOverride, apiUrlOverride })` and logs in.
- `sandbox.mount(client)` - repoints an already-constructed client the caller built.
- `sandbox.loadBot("./bot.ts")` - patches the SDK's *module-level* endpoints (via its own
  `updateWsPath`/`updatePath` from its internal `serviceEndpoints` module - exactly how the SDK
  itself repoints in its constructor) before dynamically importing the bot file, so a vanilla
  `new Client(); client.login("token")` inside that file connects to the sandbox with zero source
  changes.

`@nerimity/nerimity.js` is only a peer dependency (optional) - `src/bot/loader.ts` types against it
loosely (`NerimityClientLike`/`NerimityModule`) rather than importing it directly, so the package
doesn't force a hard build-time dependency for non-bot use of the sandbox (e.g. just using fixtures
or the store).

### Fidelity, not mocking

The SDK talks to the outside world two ways, both of which have first-class overrides: the gateway
via `socket.io-client` (`wsUrlOverride`) and REST via `fetch` (`apiUrlOverride`). Three additional
hosts the SDK hardcodes (`cdn.nerimity.com`, `nerimity.com/api/webhooks`, RPC) are not overridable
by the SDK's constructor, so `src/bot/fetchShim.ts` installs a narrow global `fetch` shim to catch
just those. Everything mirrored (client/gateway events, REST endpoints, raw model shapes, enums,
permission bits) was discovered by reading the actual `nerimity.js` SDK and verified against the
real Nerimity server - see `docs/architecture.md#the-audit-this-was-built-from` for the exact
inventory and `docs/architecture.md#known-limitations` for gaps (voice/typing/presence exist at the
gateway level but aren't yet surfaced by the SDK; virtual time only affects code that reads the
sandbox's clock, not bare `Date.now()`/`setTimeout`; CDN uploads get a synthetic file id with no
real storage).

When adding or changing emulated behavior, the source of truth is what the installed SDK version
actually parses/sends, not the full real-server protocol - fields the SDK ignores are populated
best-effort only.
