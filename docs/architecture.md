# Architecture

NeriTest is one package, internally modular. It does not fake the SDK; it stands up real
servers and lets the real SDK connect.

```
                    ┌──────────────────────────────────────────────┐
                    │                  Sandbox                     │
                    │  (orchestrator: clock, ids, wiring, teardown) │
                    └──────────────────────────────────────────────┘
                        │              │                 │
        world-side ─────┤              │                 ├───── bot-side
   (test author drives) │              │                 │  (real nerimity.js)
                        ▼              ▼                 ▼
                 ┌───────────┐   ┌───────────┐    ┌──────────────┐
                 │  Facade   │   │   Store   │    │  BotLoader   │
                 │ Sandbox*  │──▶│  (state,  │◀───│ createClient │
                 │ objects   │   │  events)  │    │ mount/loadBot│
                 └───────────┘   └─────┬─────┘    └──────┬───────┘
                                       │ domain events   │ wires overrides
                          ┌────────────┴───────────┐     │
                          ▼                        ▼     ▼
                   ┌─────────────┐          ┌──────────────────┐
                   │  Gateway    │          │    ApiServer     │
                   │ (socket.io) │          │   (express)      │
                   └──────┬──────┘          └────────┬─────────┘
                          │ ws packets               │ HTTP
                          └───────────┬──────────────┘
                                      ▼
                          ┌────────────────────────┐
                          │  real @nerimity/*.js    │
                          │        Client           │
                          └────────────────────────┘
```

## Modules

| Module | Responsibility |
| --- | --- |
| `src/model/store.ts` | Single source of truth. Holds all state as `Raw*` payloads; mutations emit typed domain events. |
| `src/model/rawTypes.ts` | Wire payload shapes mirrored 1:1 from the SDK's `RawData.ts`. |
| `src/model/enums.ts`, `permissions.ts` | `MessageType`, `ChannelType`, and the permission bitfield, mirrored from the SDK. |
| `src/gateway/` | Real socket.io server: auth handshake, event routing, fault injection. |
| `src/api/` | Real express server: every REST endpoint, faithful success/error bodies, fault injection. |
| `src/facade.ts` | Fluent "world" API (`SandboxServer`/`Channel`/`User`/`Message`/…). |
| `src/bot/` | `createClient` / `mount` / `loadBot`, plus the CDN/webhook fetch shim. |
| `src/time/clock.ts` | Virtual clock and timers for `advanceTime`. |
| `src/recorder/` | Record / replay of gateway + API traffic. |
| `src/logging/`, `src/debugger/` | Structured filterable logs and a live debugger. |
| `src/fixtures/` | Reusable state builders. |
| `src/assertions/` | A small Jest-shaped `expect`. |

## Data flow

**World → bot.** The test author calls a facade method (e.g. `channel.send(alice, "!ping")`).
The facade mutates the `Store`, which emits a domain event (`messageCreated`). The `Gateway`
forwards it to the sockets that should see it (server members / DM participants) as the real
`message:created` packet. The SDK parses it and fires `messageCreate`.

**Bot → world.** The bot calls the SDK (e.g. `message.reply("Pong!")`), which does a real
`fetch` to the `ApiServer`. The handler checks permissions, mutates the `Store`, and returns
the exact `Raw*` body the SDK expects. The store mutation also emits `messageCreated`, which
the gateway delivers back to the bot (the SDK does not dedupe its own messages - faithful to
production, which is why bots guard with `if (message.user.id === client.user.id) return`).

## The audit this was built from

Everything mirrored was discovered by reading `~/nrepos/nerimity.js` (the SDK) and verified
against `~/nrepos/nerimity-server` (the real server). Highlights:

- **Client events** (`ClientEventMap`): `ready`, `messageCreate`, `messageUpdate`,
  `messageDelete`, `messageReactionAdded`, `messageReactionRemoved`, `serverMemberLeft`,
  `serverMemberJoined`, `serverMemberUpdated`, `serverJoined`, `serverLeft`,
  `messageButtonClick`, `serverChannelCreated`, `serverChannelUpdated`,
  `serverChannelDeleted`, `serverRoleCreated`, `serverRoleDeleted`, `serverRoleUpdated`,
  `serverRoleOrderUpdated`.
- **Gateway events** (server→client): the full set from the server's `ClientEventNames.ts`,
  including ones the current SDK does not yet surface (`channel:typing`,
  `user:presence_update`, `voice:*`) - NeriTest can emit them for forward compatibility.
- **Client→server**: `user:authenticate`, `user:update_activity`, `notification:dismiss`.
- **REST endpoints** used by the SDK: `GET/POST /channels/:id/messages`,
  `GET/PATCH/DELETE /channels/:id/messages/:mid`, button callback,
  `POST/DELETE /servers/:id/bans/:uid`, `DELETE /servers/:id/members/:uid/kick`,
  `GET/POST/PATCH/DELETE /posts`, `POST /applications/bot/commands`, `POST /webhooks/:id/:token`.
- **Models**: `RawUser`, `RawServer`, `RawServerRole`, `RawServerMember`, `RawChannel`,
  `RawMessage` (incl. `htmlEmbed`, `embed`, `buttons`, `reactions`, `mentions`,
  `replyMessages`, `quotedMessages`), `RawAttachment`, `RawEmbed`, `RawMessageButton`,
  `RawMessageReaction`, `RawBotCommand`.
- **Enums**: `MessageType` (CONTENT=0, JOIN_SERVER=1, LEAVE_SERVER=2, KICK_USER=3,
  BAN_USER=4), `ChannelType` (DM_TEXT=0, SERVER_TEXT=1, CATEGORY=2).
- **Permissions**: ADMIN=1, SEND_MESSAGE=2, MANAGE_ROLES=4, MANAGE_CHANNELS=8, KICK=16,
  BAN=32, MENTION_EVERYONE=64, NICKNAME_MEMBER=128, MENTION_ROLES=256.
- **Interactions**: buttons and modal-style callbacks with `text` / `dropdown` / `input`
  components.

## Known limitations

- **Only faithful to the SDK you install.** The emulation targets the shapes nerimity.js
  actually parses. Fields the SDK ignores are populated best-effort. Pin your SDK version.
- **Voice, typing, presence, friends** exist at the gateway/event-name level but are not
  surfaced by the current SDK, so there is little bot-observable behaviour to assert on yet.
  They are wired so that when the SDK adds support, NeriTest already emits them.
- **`server.channels` after a runtime `server:joined`.** The SDK populates the global channel
  cache but not `Server.channels` on a runtime join (only on initial auth). NeriTest
  reproduces this faithfully - see the welcome-bot example, which reads `client.channels.cache`.
- **Virtual time is opt-in.** Network I/O runs on the real event loop. Time-based bot logic is
  only virtualised if the bot reads the sandbox clock (inject `sandbox.now` /
  `sandbox.clock.setTimeout`). Bots using bare `Date.now()`/`setTimeout` run in real time.
- **CDN uploads** are acknowledged with a synthetic file id; no real file storage happens.
