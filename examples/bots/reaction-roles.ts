/**
 * Reaction-roles bot: react to a designated message to self-assign a role.
 *
 * Demonstrates the `messageReactionAdded` event and mapping emoji -> role.
 * (Applying the role would be a REST call in production; here we surface the
 * intent via a callback so it's easy to test and adapt.)
 */
export interface ReactionRoleConfig {
  messageId: string;
  map: Record<string, string>; // emoji name -> roleId
  onAssign: (userId: string, roleId: string) => void | Promise<void>;
}

export function attach(client: any, config: ReactionRoleConfig): void {
  client.on("messageReactionAdded", async (reaction: any, user: any) => {
    if (reaction.messageId !== config.messageId) return;
    if (!user || user.id === client.user?.id) return;
    const roleId = config.map[reaction.name];
    if (!roleId) return;
    await config.onAssign(user.id, roleId);
  });
}
