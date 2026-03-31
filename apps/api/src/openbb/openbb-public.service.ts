import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { openbbConfig } from '../config/openbb.config';

/**
 * Generic query handler for the OpenBB Platform v4 REST API.
 *
 * Makes GET requests to `{baseUrl}{apiPrefix}/{path}?provider={provider}&{params}`.
 * Auth via optional Bearer token. All path inputs are validated for traversal safety.
 */
@Injectable()
export class OpenbbPublicDataService {
  private readonly logger = new Logger(OpenbbPublicDataService.name);

  constructor(
    @Inject(openbbConfig.KEY)
    private readonly config: ConfigType<typeof openbbConfig>,
  ) {}

  /**
   * Query the OpenBB Platform REST API.
   *
   * @param path      - relative API path (e.g. "equity/price/quote", "economy/cpi")
   * @param provider  - optional data provider override (e.g. "polygon", "fred")
   * @param params    - optional query parameters (e.g. { symbol: "AAPL" })
   * @returns parsed JSON response body
   */
  async queryPublicData(
    path: string,
    provider?: string,
    params?: Record<string, string>,
  ): Promise<unknown> {
    if (!this.config.enabled) {
      throw new Error(
        'OpenBB integration is disabled. Set OPENBB_ENABLED=true first.',
      );
    }

    const normalizedPath = this.normalizePath(path);
    const normalizedProvider = this.normalizeProvider(provider);
    const url = this.buildUrl(normalizedPath, normalizedProvider, params);

    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
      headers['X-API-Key'] = this.config.apiKey;
    }

    try {
      const response = await fetch(url, { method: 'GET', headers });

      if (!response.ok) {
        const body = await response.text();
        this.logger.warn(
          `OpenBB request failed for path=${normalizedPath} provider=${normalizedProvider} status=${response.status}: ${body}`,
        );
        throw new Error(
          `OpenBB request failed (HTTP ${response.status}). Check the path and provider, then try again.`,
        );
      }

      return await response.json();
    } catch (err) {
      // Re-throw our own errors
      if (err instanceof Error && err.message.startsWith('OpenBB request failed')) {
        throw err;
      }
      this.logger.error(
        `OpenBB request error for path=${normalizedPath} provider=${normalizedProvider}`,
        err instanceof Error ? err.stack : String(err),
      );
      throw new Error(
        `Failed to call OpenBB: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ── Internal ────────────────────────────────────────────────────────────

  private buildUrl(
    path: string,
    provider: string | undefined,
    params?: Record<string, string>,
  ): string {
    const baseUrl = this.removeTrailingSlash(this.config.baseUrl);
    const prefix = this.normalizePrefix(this.config.apiPrefix);

    const url = new URL(`${baseUrl}${prefix}/${path}`);

    if (provider) {
      url.searchParams.set('provider', provider);
    }

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (key && value) {
          url.searchParams.set(key, value);
        }
      }
    }

    return url.toString();
  }

  private normalizePath(path: string): string {
    if (!path || !path.trim()) {
      throw new Error('Query path is required. Example: economy/cpi');
    }

    let normalized = path.trim().replace(/^\/+/, '');

    // Decode percent-encoded chars before safety checks
    try {
      normalized = decodeURIComponent(normalized);
    } catch {
      throw new Error(`Invalid query path encoding: ${path}`);
    }

    if (!normalized || normalized.includes('..')) {
      throw new Error(`Invalid query path: ${path}`);
    }

    if (normalized.includes('?')) {
      throw new Error(
        'Path must not include query string. Pass query params separately.',
      );
    }

    if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
      throw new Error('Path must be relative, not a full URL.');
    }

    return normalized;
  }

  private normalizeProvider(provider?: string): string | undefined {
    if (!provider || !provider.trim()) {
      return undefined;
    }
    return provider.trim().toLowerCase().replace(/-/g, '_');
  }

  private normalizePrefix(prefix: string): string {
    if (!prefix || !prefix.trim()) {
      return '';
    }
    let normalized = prefix.trim();
    if (!normalized.startsWith('/')) {
      normalized = '/' + normalized;
    }
    return this.removeTrailingSlash(normalized);
  }

  private removeTrailingSlash(value: string): string {
    if (!value || !value.trim()) {
      return '';
    }
    let normalized = value.trim();
    while (normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  }
}
