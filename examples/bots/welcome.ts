/**
 * Welcome bot: greets new members in the server's default channel.
 *
 * Demonstrates the `serverMemberJoined` event and posting an HTML greeting.
 */
export function attach(client: any): void {
  client.on("serverMemberJoined", async (member: any) => {
    const server = member.server;
    if (!server) return;
    // Find a text channel for this server from the client's channel cache. This
    // is more robust than `server.channels` because the SDK only populates that
    // collection on initial auth, not on a runtime `server:joined`.
    const channel = [...client.channels.cache.values()].find(
      (c: any) => c.serverId === server.id && c.type === 1,
    );
    if (!channel) return;
    await channel.send(`Welcome to **${server.name}**, ${member.user}!`, {
      htmlEmbed: `<h3>Welcome ${member.user.username}!</h3><p>Glad to have you.</p>`,
    });
  });
}
