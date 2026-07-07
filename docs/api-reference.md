# API reference

Everything below is exported from `neritest`.

## `createSandbox(options?) → Sandbox`

```ts
interface SandboxOptions {
  logging?: LoggerOptions;   // { console?, categories?, level?, bufferSize? }
  startTime?: number;        // virtual clock start (ms since epoch). default: now
  botUsername?: string;      // default "TestBot"
  acceptAnyToken?: boolean;  // unknown tokens auth as the bot. default true
  fetchShim?: boolean;       // intercept hardcoded CDN/webhook hosts. default true
}
```

Construction is synchronous; the servers bind asynchronously.

## `Sandbox`

### Lifecycle
- `ready(): Promise<this>` - resolves when gateway + API are listening.
- `close(): Promise<void>` - stop servers, disconnect bots, remove the fetch shim.
- `wsUrl` / `apiUrl` - the sandbox URLs. `bot` - the default `SandboxUser`. `token`.

### World building
- `createUser({ username, ...RawUser }): SandboxUser`
- `createServer(opts): SandboxServer`
  ```ts
  interface CreateServerOptions {
    name: string;
    owner?: SandboxUser;      // default: the sandbox bot (bot gets creator perms)
    botJoins?: boolean;       // default true
    botPermissions?: number;  // bot's role perms when it joins. default ADMIN
    hexColor?: string;
  }
  ```
- `createDM(user): SandboxChannel` - a DM channel between the bot and `user`.
- `user(id): SandboxUser | undefined`

### Bot execution
- `createClient({ token?, messageCacheLimit? }): Promise<Client>` - a real SDK client, logged in.
- `mount(client, { token? }): Promise<Client>` - repoint an existing client.
- `loadBot(entryPath): Promise<module>` - import an unmodified bot; its `new Client()` connects here.

### Time
- `advanceTime(amount)` - `"5m"`, `"1h30m"`, `"24h"`, or ms. Fires virtual timers.
- `now(): number` - current virtual time. `clock: Clock` for `setTimeout`/`setInterval`.

### Fault injection
- `api` - the `ApiServer` (see below).
- `gateway` - the `Gateway` (see below).

### Record / replay / fixtures / debug
- `record(file?): Recording` - `{ stop(): Session, save(file?): Session }`.
- `replay(sessionOrFile, { realtime?, speed? }): Promise<void>`
- `loadFixture(nameOrFn)` - `"basic"`, `"moderation"`, `"large-server"`, or a builder.
- `debug` - the `Debugger`. `logs` - the `Logger`. `store` - the raw `Store` (escape hatch).

## Facade objects

### `SandboxServer`
`name`, `defaultRoleId`, `ownerId`, `defaultChannel`, `channels`, `roles`, `defaultRole`, `members`
- `createChannel({ name, type?, category?, permissions? }): SandboxChannel`
- `createCategory(name): SandboxChannel`
- `createRole({ name?, permissions?, hexColor?, hideRole? }): SandboxRole`
- `addMember(user, { nickname?, roles? })`
- `setMemberRoles(user, roles)` / `giveRole(user, role)`
- `member(user): SandboxMember | undefined` / `memberPermissions(user): number`
- `isBanned(user): boolean` / `removeMember(user)`
- `addCustomEmoji(name, { gif?, id? })` / `update({ name?, avatar?, banner?, hexColor? })`

### `SandboxChannel`
`id`, `name`, `type`, `serverId`, `messages`, `lastMessage`
- `send(user, input): SandboxMessage` - `input` is a string or:
  ```ts
  interface SendOptions {
    content?: string;
    html?: string;         // → message.htmlEmbed (Nerimity HTML support)
    htmlEmbed?: string;    // alias
    embed?: RawEmbed;
    buttons?: { id: string; label: string; alert?: boolean }[];
    attachments?: { mime?; path?; width?; height?; duration? }[];
    silent?: boolean;
    replyTo?: SandboxMessage | string;
    mentionReplies?: boolean;
    type?: MessageType;
  }
  ```
- `sendHtml(user, html): SandboxMessage`
- `startTyping(user)` - fires `channel:typing`
- `update({ name?, permissions?, categoryId? })` / `delete()`

### `SandboxMessage`
`id`, `content`, `htmlEmbed`, `authorId`, `channelId`, `reactions`, `buttons`, `editedAt`,
`deleted`, `toRaw()`
- `react(user, emoji)` / `removeReaction(user, emoji)` - emoji is a string or `{ name, emojiId?, gif? }`
- `clickButton(user, buttonId, { type?, data? })` - fires `messageButtonClick`
- `edit({ content?, html?, buttons? })` - fires `messageUpdate`
- `delete()` - fires `messageDelete`

### `SandboxUser`
`id`, `username`, `tag`, `isBot`, `toString()` (→ `[@:id]` mention)
- `setPresence({ status?, custom?, activity? })`
- `wasKicked(server?): boolean` / `wasBanned(server?): boolean`

### `SandboxMember`
`nickname`, `roles: SandboxRole[]`, `permissions: number`
- `hasRole(role)` / `hasPermission(bit)`

### `SandboxRole`
`id`, `name`, `permissions` - `update({...})` / `delete()`

## `ApiServer` (`sandbox.api`)
Fault injection: `rateLimit({ requests?, retryAfterMs? })`, `failNext(status, body)`,
`setLatency(ms)`, `hangNext(ms?)`.
Direct requests (as the bot): `get(path)`, `post(path, body)`, `patch(path, body)`,
`delete(path)`, `request(method, path, body?)` → `{ status, body }`.

## `Gateway` (`sandbox.gateway`)
`disconnect({ close? })`, `setLatency(ms)`, `setPacketLoss(rate)`, `setDuplication(rate)`,
`rejectNextAuth()`, `connectionCount`, `emitRaw(event, payload)`.

## `expect(value)`
`toBe`, `toEqual`, `toContain`, `toContainEqual`, `toHaveLength`, `toBeTruthy`, `toBeFalsy`,
`toBeDefined`, `toBeUndefined`, `toBeNull`, `toBeGreaterThan`, `toBeLessThan`, `toMatch`,
`toThrow`, `toContainHtml`, `.not`, `.resolves`, `.rejects`.

## Constants & helpers
`RolePermissions`, `permissions("KICK", "BAN")`, `hasBit`, `addBit`, `removeBit`,
`MessageType`, `ChannelType`, `ServerToClient`, `ClientToServer`, `Clock`, `parseDuration`,
`Recorder`, `Logger`, `Debugger`, and all `Raw*` types.
