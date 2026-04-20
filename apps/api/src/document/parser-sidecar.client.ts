// apps/api/src/document/parser-sidecar.client.ts
import { Injectable, Inject, Logger } from '@nestjs/common';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const ParserSidecarResponse = z.object({
  markdown: z.string().min(1),
  metadata: z.object({
    pageCount: z.number().int().min(0),
    headings: z.array(
      z.object({
        level: z.number().int().min(1).max(6),
        text: z.string(),
        pageStart: z.number().nullable(),
      }),
    ),
    tableCount: z.number().int().min(0),
    parserVersion: z.string().min(1),
    sourceMimeType: z.string().min(1),
  }),
});

export type ParserSidecarResponse = z.infer<typeof ParserSidecarResponse>;

// ---------------------------------------------------------------------------
// Config interface
// ---------------------------------------------------------------------------

export interface ParserSidecarConfig {
  url: string;
  timeoutMs: number;
  minMarkdownChars: number;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_OPEN_DURATION_MS = 30_000;

@Injectable()
export class ParserSidecarClient {
  private readonly logger = new Logger(ParserSidecarClient.name);

  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;

  constructor(
    @Inject('PARSER_SIDECAR_CONFIG')
    private readonly config: ParserSidecarConfig,
  ) {}

  async parse(
    buffer: Buffer,
    mimeType: string,
    fileName: string,
  ): Promise<ParserSidecarResponse> {
    // Circuit-breaker check
    if (Date.now() < this.circuitOpenUntil) {
      throw new Error('PARSER_CIRCUIT_OPEN');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const form = new FormData();
      const arrayBuf = buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ) as ArrayBuffer;
      form.append('file', new Blob([arrayBuf], { type: mimeType }), fileName);

      const response = await fetch(`${this.config.url}/parse`, {
        method: 'POST',
        body: form,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`PARSER_HTTP_${response.status}`);
      }

      const json = await response.json();
      const parsed = ParserSidecarResponse.parse(json);

      if (parsed.markdown.length < this.config.minMarkdownChars) {
        throw new Error('PARSER_EMPTY_OUTPUT');
      }

      // Success — reset circuit
      this.consecutiveFailures = 0;
      return parsed;
    } catch (err: unknown) {
      this.consecutiveFailures++;
      if (this.consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD) {
        this.circuitOpenUntil = Date.now() + CIRCUIT_OPEN_DURATION_MS;
        this.logger.warn(
          `Parser sidecar circuit breaker opened after ${this.consecutiveFailures} consecutive failures`,
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
