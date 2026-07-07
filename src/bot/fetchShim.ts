/**
 * Global `fetch` shim for the three hosts nerimity.js hardcodes and does NOT let
 * you override:
 *
 *   - `https://cdn.nerimity.com/...`      (AttachmentBuilder upload/save)
 *   - `https://nerimity.com/api/webhooks/...` (WebhookBuilder.send)
 *
 * Everything else the SDK does is already redirected via `wsUrlOverride` /
 * `apiUrlOverride`, so this shim is intentionally narrow: it only intercepts
 * those hardcoded hosts and passes every other request straight through to the
 * real `fetch`. It is installed while the sandbox runs and removed on teardown.
 */
import type { Store } from "../model/store";
import type { Logger } from "../logging/logger";

export interface FetchShimTarget {
  /** Base URL of the fake API server, e.g. http://localhost:1234 */
  apiUrl: string;
}

export class FetchShim {
  private original?: typeof fetch;
  private installed = false;

  constructor(
    private store: Store,
    private logger: Logger,
    private target: FetchShimTarget,
  ) {}

  install(): void {
    if (this.installed) return;
    this.original = globalThis.fetch;
    const original = this.original;
    const self = this;

    type FetchInput = Parameters<typeof fetch>[0];
    globalThis.fetch = async function patchedFetch(
      input: FetchInput,
      init?: RequestInit,
    ): Promise<Response> {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url;

      // CDN uploads
      if (url.startsWith("https://cdn.nerimity.com")) {
        return self.handleCdn(url, init);
      }
      // Hardcoded webhook host -> route to the fake API
      if (url.startsWith("https://nerimity.com/api/webhooks/")) {
        const rewritten = url.replace("https://nerimity.com", self.target.apiUrl);
        self.logger.debug("api", `fetch shim: webhook -> ${rewritten}`);
        return original(rewritten, init);
      }
      return original(input, init);
    };
    this.installed = true;
  }

  uninstall(): void {
    if (!this.installed || !this.original) return;
    globalThis.fetch = this.original;
    this.installed = false;
  }

  private handleCdn(url: string, _init?: RequestInit): Promise<Response> {
    // POST /upload -> { fileId }
    if (url.includes("/upload")) {
      const fileId = `cdn_${this.store.ids.next()}`;
      this.logger.debug("api", `fetch shim: cdn upload -> ${fileId}`);
      return Promise.resolve(json({ fileId }));
    }
    // POST /attachments/:channelId/:fileId -> ok
    this.logger.debug("api", `fetch shim: cdn save -> ok`);
    return Promise.resolve(json({ success: true }));
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
