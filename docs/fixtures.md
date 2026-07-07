# Fixtures

A fixture is a function that takes a sandbox, populates it, and returns handles to what it
created. Use a builtin by name or ship your own.

## Builtins

```ts
const { server, general, owner, members } = sandbox.loadFixture("basic");
const mod = sandbox.loadFixture("moderation");
//   mod.adminRole, mod.modRole, mod.admin, mod.troublemaker, ...
const big = sandbox.loadFixture("large-server");
//   big.server, big.users (200), big.channels (25), big.roles (15), ~1000 messages
```

| Name | What you get |
| --- | --- |
| `basic` | one server, one channel, an owner, three plain members |
| `moderation` | `basic` + admin/mod roles, an admin user, a troublemaker |
| `large-server` | a stress fixture: many users, channels, roles, and messages |

## Custom fixtures

Any function `(sandbox) => T` works:

```ts
function guildWithTiers(sandbox: Sandbox) {
  const owner = sandbox.createUser({ username: "Owner" });
  const server = sandbox.createServer({ name: "Tiered", owner });
  const tiers = ["bronze", "silver", "gold"].map((name) =>
    server.createRole({ name, permissions: permissions("SEND_MESSAGE") }),
  );
  const vip = sandbox.createUser({ username: "VIP" });
  server.addMember(vip, { roles: [tiers[2]] });
  return { server, tiers, vip };
}

const { server, tiers, vip } = sandbox.loadFixture(guildWithTiers);
```

Tune the large-server fixture by wrapping it:

```ts
import { fixtures } from "neritest-js";
const big = sandbox.loadFixture((s) =>
  fixtures.largeServer(s, { users: 1000, channels: 50, messagesPerChannel: 100 }),
);
```

## Tips

- Build fixtures **before** the bot connects so their state lands in the auth payload.
- Fixtures are plain functions - compose them (`moderation` calls `basic` internally).
- Returned facade objects are live views on the store; reading them always reflects current
  state.
