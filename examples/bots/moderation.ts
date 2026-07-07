/**
 * Moderation bot: `!ban @user [reason]` and `!kick @user`, gated on permissions.
 *
 * Demonstrates permission checks (`member.hasPermission`), REST moderation calls
 * (`server.banMember` / `kickMember`), and graceful handling of API errors.
 */
import { RolePermissions } from "neritest-js";

const MENTION = /\[@:(\d+)\]/;

export function attach(client: any): void {
  client.on("messageCreate", async (message: any) => {
    if (message.user.id === client.user?.id) return;
    const content: string = message.content ?? "";
    const server = message.channel?.server;
    if (!server) return;

    const member = message.member; // the author's ServerMember
    const targetId = content.match(MENTION)?.[1];

    if (content.startsWith("!ban")) {
      if (!member?.hasPermission(RolePermissions.BAN)) {
        return void message.reply("You don't have permission to ban.");
      }
      if (!targetId) return void message.reply("Usage: !ban @user [reason]");
      const reason = content.split(" ").slice(2).join(" ") || undefined;
      try {
        await server.banMember(targetId, { reason });
        await message.reply("Banned.");
      } catch {
        await message.reply("I couldn't ban that user (missing permission?).");
      }
    }

    if (content.startsWith("!kick")) {
      if (!member?.hasPermission(RolePermissions.KICK)) {
        return void message.reply("You don't have permission to kick.");
      }
      if (!targetId) return void message.reply("Usage: !kick @user");
      try {
        await server.kickMember(targetId);
        await message.reply("Kicked.");
      } catch {
        await message.reply("I couldn't kick that user.");
      }
    }
  });
}
