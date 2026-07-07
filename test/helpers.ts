/** Poll `fn` until it returns truthy or the timeout elapses. */
export async function waitFor<T>(
  fn: () => T | undefined | false,
  { timeout = 3000, interval = 10 }: { timeout?: number; interval?: number } = {},
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v as T;
    if (Date.now() - start > timeout) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, interval));
  }
}

/** Resolve when the client fires `ready`, or reject after `timeout`. */
export function waitReady(client: { on(e: string, l: () => void): unknown }, timeout = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("bot never became ready")), timeout);
    client.on("ready", () => {
      clearTimeout(t);
      resolve();
    });
  });
}
