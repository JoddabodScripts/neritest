/**
 * Logging bot: mirrors message edits and deletions into a log channel.
 *
 * Demonstrates `messageUpdate` and `messageDelete`. Because `messageDelete` only
 * carries ids, the bot relies on the SDK's message cache to recover content -
 * which the sandbox populates exactly like production.
 */
export function attach(client: any, logChannelId: string): void {
  client.on("messageUpdate", async (message: any) => {
    const log = client.channels.cache.get(logChannelId);
    if (!log || message.channelId === logChannelId) return;
    await log.send(`[edit] Message ${message.id} edited to: ${message.content}`);
  });

  client.on("messageDelete", async (data: { messageId: string; channelId: string }) => {
    const log = client.channels.cache.get(logChannelId);
    if (!log || data.channelId === logChannelId) return;
    await log.send(`[delete] Message ${data.messageId} was deleted in ${data.channelId}.`);
  });
}
