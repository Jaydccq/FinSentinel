/**
 * golden-candidates.cli.ts
 *
 * NestJS application-context CLI for exporting golden-set candidate entries
 * from three production data sources.
 *
 * Usage (from apps/api/):
 *   pnpm rag:golden:export [--limit-chat N] [--limit-events N] [--limit-reverse N] [--dry-run]
 *
 * Output:
 *   services/evaluation-runner/datasets/golden-candidates-draft.json
 *
 * Never overwrites golden.json.
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOpenRouterModel, generateAgentText } from '@finsentinel/ai-runtime';
import { AppConfigModule, DatabaseModule } from '../../config';
import { GoldenCandidatesService, GOLDEN_LLM_CLIENT } from './golden-candidates.service';
import type { LlmTextClient } from './golden-candidates.service';

// Derive repo root relative to this file so the output path resolves correctly
// regardless of where pnpm runs from.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '../../../../..');
const DEFAULT_OUTPUT = resolve(
  REPO_ROOT,
  'services/evaluation-runner/datasets/golden-candidates-draft.json',
);

// ── GOLDEN_LLM_CLIENT factory (exported for unit testing) ────────────────────

export function makeGoldenLlmClientFactory(argv: string[]): LlmTextClient {
  const isDryRun = argv.includes('--dry-run');

  if (isDryRun) {
    const stub: LlmTextClient = {
      generate(_systemPrompt: string, _userPrompt: string): Promise<string> {
        return Promise.reject(new Error('stub called in dry-run — should not happen'));
      },
    };
    return stub;
  }

  const apiKey = process.env['OPENROUTER_API_KEY'];
  if (!apiKey) {
    throw new Error(
      'Missing OPENROUTER_API_KEY. Set it or pass --dry-run to exercise without LLM.',
    );
  }

  const model = createOpenRouterModel({
    modelId: process.env['AI_MODEL'] || 'google/gemini-3-flash-preview',
    baseUrl: process.env['OPENROUTER_BASE_URL'] || 'https://openrouter.ai/api/v1',
  });

  const client: LlmTextClient = {
    async generate(systemPrompt: string, userPrompt: string): Promise<string> {
      return generateAgentText({
        model,
        systemPrompt,
        prompt: userPrompt,
        tools: {},
      });
    },
  };

  return client;
}

// ── Minimal bootstrap module ──────────────────────────────────────────────────

@Module({
  imports: [AppConfigModule, DatabaseModule],
  providers: [
    GoldenCandidatesService,
    {
      provide: GOLDEN_LLM_CLIENT,
      useFactory: () => makeGoldenLlmClientFactory(process.argv),
    },
  ],
})
class GoldenCandidatesCliModule {}

// ── CLI argument parsing ───────────────────────────────────────────────────────

function parseArgs(argv: string[]) {
  const args = {
    limitChat: 30,
    limitEvents: 20,
    limitReverse: 25,
    dryRun: false,
    outputPath: DEFAULT_OUTPUT,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--limit-chat' && argv[i + 1]) {
      args.limitChat = parseInt(argv[++i]!, 10);
    } else if (arg === '--limit-events' && argv[i + 1]) {
      args.limitEvents = parseInt(argv[++i]!, 10);
    } else if (arg === '--limit-reverse' && argv[i + 1]) {
      args.limitReverse = parseInt(argv[++i]!, 10);
    } else if (arg === '--output' && argv[i + 1]) {
      args.outputPath = argv[++i]!;
    }
  }

  return args;
}

// ── Entrypoint ────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env['DATABASE_URL']) {
    console.error(
      'Error: DATABASE_URL environment variable is not set.\n' +
      'Set it to your local Postgres connection string, e.g.:\n' +
      '  DATABASE_URL=postgresql://user:pass@localhost:5432/finsentinel',
    );
    process.exit(1);
  }

  const cliArgs = parseArgs(process.argv.slice(2));

  const app = await NestFactory.createApplicationContext(GoldenCandidatesCliModule, {
    logger: ['error', 'warn', 'log'],
  });

  const service = app.get(GoldenCandidatesService);

  try {
    const candidates = await service.buildDraft({
      limitChat: cliArgs.limitChat,
      limitEvents: cliArgs.limitEvents,
      limitReverse: cliArgs.limitReverse,
      outputPath: cliArgs.outputPath,
      dryRun: cliArgs.dryRun,
    });

    if (cliArgs.dryRun) {
      const chatCount = candidates.filter(
        (c) => c.source_provenance.source === 'chat_messages',
      ).length;
      const eventsCount = candidates.filter(
        (c) => c.source_provenance.source === 'agent_events',
      ).length;
      const chunkCount = candidates.filter(
        (c) => c.source_provenance.source === 'reverse_from_chunk',
      ).length;

      console.log(
        `[dry-run] LLM not called; placeholder queries emitted.\n` +
        `[dry-run] Would emit ${candidates.length} candidates:\n` +
        `  chat_messages:      ${chatCount}\n` +
        `  agent_events:       ${eventsCount}\n` +
        `  reverse_from_chunk: ${chunkCount}`,
      );
    } else {
      console.log(
        `Wrote ${candidates.length} candidates to:\n  ${cliArgs.outputPath}`,
      );
    }
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('golden-candidates CLI failed:', err);
  process.exit(1);
});
