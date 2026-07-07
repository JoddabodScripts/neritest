/**
 * Error payloads mirrored from nerimity-server's `generateError`.
 *
 * The SDK's `request()` throws `new Error(JSON.stringify(body))` on any non-2xx
 * response, so the shape here is what ends up in the bot's caught error.
 */
export interface NerimityError {
  message: string;
  path?: string;
  code?: string;
  retryAfter?: number;
}

export function generateError(
  message: string,
  path?: string,
  code?: string,
): NerimityError {
  const err: NerimityError = { message };
  if (path !== undefined) err.path = path;
  if (code !== undefined) err.code = code;
  return err;
}
