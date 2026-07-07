/**
 * Economy bot: `!daily` grants coins once every 24h.
 *
 * Demonstrates cooldowns. The bot takes a `now()` function so tests can drive it
 * with the sandbox's virtual clock (`sandbox.now`) and fast-forward 24h with
 * `sandbox.advanceTime("24h")` instead of waiting. In production, pass
 * `Date.now`. This dependency-injection pattern is what makes time-based logic
 * testable without real waiting.
 */
export interface EconomyDeps {
  now: () => number;
}

export function attach(client: any, deps: EconomyDeps = { now: Date.now }): Map<string, number> {
  const balances = new Map<string, number>();
  const lastClaim = new Map<string, number>();
  const DAY = 24 * 60 * 60 * 1000;

  client.on("messageCreate", async (message: any) => {
    if (message.user.id === client.user?.id) return;
    if (message.content !== "!daily") return;

    const userId = message.user.id;
    const now = deps.now();
    const last = lastClaim.get(userId) ?? -Infinity;
    if (now - last < DAY) {
      const hours = Math.ceil((DAY - (now - last)) / 3_600_000);
      return void message.reply(`Already claimed. Try again in ~${hours}h.`);
    }
    lastClaim.set(userId, now);
    balances.set(userId, (balances.get(userId) ?? 0) + 100);
    await message.reply(`You claimed 100 coins! Balance: ${balances.get(userId)}`);
  });

  return balances;
}
