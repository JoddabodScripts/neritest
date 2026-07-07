/**
 * Automod bot: deletes messages containing banned words and warns the author.
 *
 * Demonstrates `message.delete()` and reacting to `messageCreate` in real time.
 */
const BANNED = ["badword", "spamlink.example"];

export function attach(client: any, opts: { banned?: string[] } = {}): void {
  const banned = opts.banned ?? BANNED;
  client.on("messageCreate", async (message: any) => {
    if (message.user.id === client.user?.id) return;
    const content: string = (message.content ?? "").toLowerCase();
    if (banned.some((w) => content.includes(w))) {
      await message.delete();
      await message.channel.send(`${message.user}, that message wasn't allowed.`);
    }
  });
}
