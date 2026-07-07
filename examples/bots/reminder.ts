/**
 * Reminder / scheduled-jobs bot: `!remind <seconds> <text>`.
 *
 * Demonstrates scheduled work. The bot takes a `schedule()` function; pass
 * `sandbox.clock.setTimeout` in tests to fire reminders via `advanceTime`, or
 * the real `setTimeout` in production.
 */
export interface SchedulerDeps {
  schedule: (cb: () => void, delayMs: number) => unknown;
}

export function attach(
  client: any,
  deps: SchedulerDeps = { schedule: (cb, ms) => setTimeout(cb, ms) },
): void {
  client.on("messageCreate", async (message: any) => {
    if (message.user.id === client.user?.id) return;
    const m = (message.content ?? "").match(/^!remind (\d+) (.+)$/);
    if (!m) return;
    const seconds = Number(m[1]);
    const text = m[2];
    await message.reply(`Okay, I'll remind you in ${seconds}s.`);
    deps.schedule(() => {
      message.channel.send(`${message.user} reminder: ${text}`);
    }, seconds * 1000);
  });
}
