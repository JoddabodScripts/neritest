/**
 * Slash-commands bot.
 *
 * Nerimity parses `/name:botId args` client-side and exposes it as
 * `message.command = { name, args }`. This bot registers a `help` command and
 * responds to it. (Command registration is a one-off REST call; in the sandbox
 * it's recorded and can be asserted via `sandbox.store.commands`.)
 */
export function attach(client: any): void {
  client.on("messageCreate", async (message: any) => {
    if (!message.command) return;
    if (message.command.name === "help") {
      const page = message.command.args[0] || "1";
      await message.reply(`Help page ${page}`);
    }
  });
}

/** Register the bot's command list. Run once, not on every startup. */
export async function register(client: any, token: string): Promise<void> {
  await client.updateCommands(token, [
    { name: "help", description: "Shows the help list", args: "<page number>" },
  ]);
}
