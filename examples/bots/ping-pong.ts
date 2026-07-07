/**
 * The canonical ping-pong bot, written exactly as it would be for production.
 *
 * `attach()` takes a real nerimity.js Client and wires handlers. In production
 * you'd do `attach(new Client()); client.login(token)`. In a test you do
 * `attach(await sandbox.createClient())`. Same code, no branching.
 */
export function attach(client: any): void {
  client.on("messageCreate", async (message: any) => {
    if (message.user.id === client.user?.id) return;
    if (message.content === "!ping") {
      const t0 = Date.now();
      const reply = await message.reply("Pong!");
      await reply.edit(`Pong! (${Date.now() - t0}ms)`);
    }
  });
}
