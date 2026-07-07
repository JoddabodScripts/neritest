# Examples

Each bot in [`bots/`](bots) is written the way you'd write it for production: an `attach(client)`
factory that wires handlers to a real nerimity.js `Client`. The same code runs in the sandbox
(`attach(await sandbox.createClient())`) and against a live server (`attach(new Client())`).

| File | Pattern |
| --- | --- |
| [`bots/ping-pong.ts`](bots/ping-pong.ts) | reply + edit, latency |
| [`bots/welcome.ts`](bots/welcome.ts) | `serverMemberJoined`, HTML greeting |
| [`bots/moderation.ts`](bots/moderation.ts) | permission checks, ban/kick, error handling |
| [`bots/automod.ts`](bots/automod.ts) | delete + warn on banned words |
| [`bots/reaction-roles.ts`](bots/reaction-roles.ts) | `messageReactionAdded` → assign role |
| [`bots/economy.ts`](bots/economy.ts) | cooldowns via an injected clock (virtual time) |
| [`bots/reminder.ts`](bots/reminder.ts) | scheduled jobs via an injected scheduler |
| [`bots/slash-commands.ts`](bots/slash-commands.ts) | `message.command`, command registration |
| [`bots/logging.ts`](bots/logging.ts) | `messageUpdate` / `messageDelete` mirroring |

[`standalone/vanilla-bot.cjs`](standalone/vanilla-bot.cjs) is a completely unmodified bot with
no NeriTest imports, run via `sandbox.loadBot(...)`.

[`bots.test.ts`](bots.test.ts) exercises all of the above in the sandbox - read it as a worked
cookbook. Run everything with:

```bash
npm test
```
