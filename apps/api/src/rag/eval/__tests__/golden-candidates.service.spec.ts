import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs/promises';
import { aiConfig } from '../../../config/ai.config';
import {
  GoldenCandidatesService,
  GOLDEN_LLM_CLIENT,
  type LlmTextClient,
} from '../golden-candidates.service';

// ── FS mocks (must be hoisted) ───────────────────────────────────────────────

vi.mock('node:fs/promises', () => ({
  access: vi.fn(),
  writeFile: vi.fn(),
  rename: vi.fn(),
}));

const mockAccess = fs.access as Mock;
const mockWriteFile = fs.writeFile as Mock;
const mockRename = fs.rename as Mock;

// ── Helpers ──────────────────────────────────────────────────────────────────

const mockAiConfig = {
  openrouterApiKey: 'test-key',
  openrouterBaseUrl: 'https://openrouter.ai/api/v1',
  model: 'google/gemini-3-flash-preview',
  embeddingModel: 'text-embedding-3-small',
};

function makeDb() {
  return {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    execute: vi.fn().mockResolvedValue([]),
  };
}

function makeLlm(response = 'What is the revenue of AAPL?\nfactoid'): LlmTextClient {
  return { generate: vi.fn().mockResolvedValue(response) };
}

async function buildService(
  db: ReturnType<typeof makeDb>,
  llm: LlmTextClient,
  configOverrides: Record<string, unknown> = {},
) {
  const module = await Test.createTestingModule({
    providers: [
      GoldenCandidatesService,
      { provide: 'DRIZZLE_DB', useValue: db },
      { provide: aiConfig.KEY, useValue: mockAiConfig },
      { provide: GOLDEN_LLM_CLIENT, useValue: llm },
      {
        provide: ConfigService,
        useValue: {
          get: (key: string, def: unknown) => configOverrides[key] ?? def,
        },
      },
    ],
  }).compile();

  return module.get(GoldenCandidatesService);
}

// ── Tests: fromChatMessages ───────────────────────────────────────────────────

describe('GoldenCandidatesService.fromChatMessages', () => {
  it('returns up to limit entries from user-role messages', async () => {
    const db = makeDb();
    db.limit.mockResolvedValueOnce([
      { id: 'msg-1', content: 'What is the AAPL price today?', role: 'user' },
      { id: 'msg-2', content: 'Explain Apple revenue breakdown', role: 'user' },
      { id: 'msg-3', content: 'Another question about stocks', role: 'user' },
    ]);

    const svc = await buildService(db, makeLlm());
    const results = await svc.fromChatMessages(2);

    expect(results).toHaveLength(2);
    expect(results[0]!.source_provenance.source).toBe('chat_messages');
  });

  it('deduplicates on query text', async () => {
    const db = makeDb();
    db.limit.mockResolvedValueOnce([
      { id: 'msg-1', content: 'What is the AAPL price today?', role: 'user' },
      { id: 'msg-2', content: 'What is the AAPL price today?', role: 'user' },
      { id: 'msg-3', content: 'Different question here for stocks', role: 'user' },
    ]);

    const svc = await buildService(db, makeLlm());
    const results = await svc.fromChatMessages(5);

    expect(results).toHaveLength(2);
    const queries = results.map((r) => r.query);
    expect(new Set(queries).size).toBe(2);
  });

  it('filters out queries shorter than 5 characters', async () => {
    const db = makeDb();
    db.limit.mockResolvedValueOnce([
      { id: 'msg-1', content: 'Hi', role: 'user' },
      { id: 'msg-2', content: 'What is the Apple revenue today?', role: 'user' },
    ]);

    const svc = await buildService(db, makeLlm());
    const results = await svc.fromChatMessages(5);

    expect(results).toHaveLength(1);
    expect(results[0]!.query).toBe('What is the Apple revenue today?');
  });

  it('filters out queries longer than 200 characters', async () => {
    const db = makeDb();
    const longQuery = 'A'.repeat(201);
    db.limit.mockResolvedValueOnce([
      { id: 'msg-1', content: longQuery, role: 'user' },
      { id: 'msg-2', content: 'Short valid query about revenue', role: 'user' },
    ]);

    const svc = await buildService(db, makeLlm());
    const results = await svc.fromChatMessages(5);

    expect(results).toHaveLength(1);
    expect(results[0]!.query).toBe('Short valid query about revenue');
  });

  it('sets query_class to unknown for chat messages', async () => {
    const db = makeDb();
    db.limit.mockResolvedValueOnce([
      { id: 'msg-1', content: 'What is the AAPL price today?', role: 'user' },
    ]);

    const svc = await buildService(db, makeLlm());
    const results = await svc.fromChatMessages(5);

    expect(results[0]!.query_class).toBe('unknown');
  });

  it('assigns IDs with the draft-chat- prefix', async () => {
    const db = makeDb();
    db.limit.mockResolvedValueOnce([
      { id: 'msg-1', content: 'What is the Apple revenue today?', role: 'user' },
    ]);

    const svc = await buildService(db, makeLlm());
    const results = await svc.fromChatMessages(5);

    expect(results[0]!.id).toMatch(/^draft-chat-/);
  });
});

// ── Tests: fromAgentEvents ────────────────────────────────────────────────────

describe('GoldenCandidatesService.fromAgentEvents', () => {
  it('extracts payload_json.query from CHAT_SESSION events', async () => {
    const db = makeDb();
    db.limit.mockResolvedValueOnce([
      { id: 'ev-1', payloadJson: { query: 'What is the Bitcoin price today?' } },
      { id: 'ev-2', payloadJson: { query: 'Explain Ethereum staking returns' } },
    ]);

    const svc = await buildService(db, makeLlm());
    const results = await svc.fromAgentEvents(5);

    expect(results).toHaveLength(2);
    expect(results[0]!.source_provenance.source).toBe('agent_events');
    expect(results[0]!.query).toBe('What is the Bitcoin price today?');
  });

  it('skips entries where payload_json has no query field', async () => {
    const db = makeDb();
    db.limit.mockResolvedValueOnce([
      { id: 'ev-1', payloadJson: { tool: 'news_search', args: {} } },
      { id: 'ev-2', payloadJson: { query: 'What is the Apple revenue today?' } },
    ]);

    const svc = await buildService(db, makeLlm());
    const results = await svc.fromAgentEvents(5);

    expect(results).toHaveLength(1);
    expect(results[0]!.query).toBe('What is the Apple revenue today?');
  });

  it('skips entries where payload_json is null', async () => {
    const db = makeDb();
    db.limit.mockResolvedValueOnce([
      { id: 'ev-1', payloadJson: null },
    ]);

    const svc = await buildService(db, makeLlm());
    const results = await svc.fromAgentEvents(5);

    expect(results).toHaveLength(0);
  });

  it('does not throw when zero events have a query field', async () => {
    const db = makeDb();
    db.limit.mockResolvedValueOnce([
      { id: 'ev-1', payloadJson: { action: 'heartbeat' } },
      { id: 'ev-2', payloadJson: { data: 123 } },
    ]);

    const svc = await buildService(db, makeLlm());
    await expect(svc.fromAgentEvents(5)).resolves.toHaveLength(0);
  });

  it('sets query_class to unknown for agent_events entries', async () => {
    const db = makeDb();
    db.limit.mockResolvedValueOnce([
      { id: 'ev-1', payloadJson: { query: 'How does TSLA compare to AAPL revenue?' } },
    ]);

    const svc = await buildService(db, makeLlm());
    const results = await svc.fromAgentEvents(5);

    expect(results[0]!.query_class).toBe('unknown');
  });
});

// ── Tests: fromChunkReverse ───────────────────────────────────────────────────

describe('GoldenCandidatesService.fromChunkReverse', () => {
  it('returns candidates with reverse_from_chunk provenance', async () => {
    const db = makeDb();
    // First execute() returns strata
    db.execute
      .mockResolvedValueOnce([
        { doc_type: 'SEC_FILING', sector: 'Technology', cnt: '10' },
      ])
      // Second execute() returns sampled chunks from that stratum
      .mockResolvedValueOnce([
        { id: 'chunk-abc', content: 'Apple reported Q1 revenue of $120B for fiscal 2024.' },
      ]);

    const svc = await buildService(db, makeLlm('What was Apple Q1 2024 revenue?\nfactoid'));
    const results = await svc.fromChunkReverse(5);

    expect(results).toHaveLength(1);
    expect(results[0]!.source_provenance.source).toBe('reverse_from_chunk');
    expect(results[0]!.source_provenance.source_chunk_id).toBe('chunk-abc');
    expect(results[0]!.query_class).toBe('factoid');
  });

  it('stratifies by doc_type x sector distributing quota evenly', async () => {
    const db = makeDb();
    db.execute
      .mockResolvedValueOnce([
        { doc_type: 'SEC_FILING', sector: 'Technology', cnt: '20' },
        { doc_type: 'RESEARCH_REPORT', sector: 'Finance', cnt: '15' },
      ])
      .mockResolvedValueOnce([
        { id: 'chunk-1', content: 'Apple revenue for Q1 2024 technology filing.' },
      ])
      .mockResolvedValueOnce([
        { id: 'chunk-2', content: 'Bank earnings report for Q2 2024 finance sector.' },
      ]);

    const svc = await buildService(db, makeLlm('What is the sector performance this quarter?\nrelational'));
    const results = await svc.fromChunkReverse(4);

    // With 2 strata and limit 4: each gets 2
    expect(db.execute).toHaveBeenCalledTimes(3); // 1 strata + 2 chunk samples
  });

  it('skips a chunk when LLM returns empty question but continues with others', async () => {
    const db = makeDb();
    db.execute
      .mockResolvedValueOnce([
        { doc_type: 'SEC_FILING', sector: 'Technology', cnt: '10' },
      ])
      .mockResolvedValueOnce([
        { id: 'chunk-1', content: 'First chunk content about technology revenue.' },
        { id: 'chunk-2', content: 'Second chunk content about market risk factors.' },
      ]);

    const llm = makeLlm();
    // First chunk: LLM returns an empty string (no question extracted, should skip)
    // Second chunk: LLM returns valid two-line response
    (llm.generate as Mock)
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('What are the key market risk factors here?\nrelational');

    const svc = await buildService(db, llm);
    const results = await svc.fromChunkReverse(5);

    expect(results).toHaveLength(1);
    expect(results[0]!.query_class).toBe('relational');
  });

  it('skips a chunk when LLM throws but continues with others', async () => {
    const db = makeDb();
    db.execute
      .mockResolvedValueOnce([
        { doc_type: 'SEC_FILING', sector: 'Technology', cnt: '10' },
      ])
      .mockResolvedValueOnce([
        { id: 'chunk-fail', content: 'Failing chunk technology content here.' },
        { id: 'chunk-ok', content: 'Successful chunk about quarterly earnings data.' },
      ]);

    const llm = makeLlm();
    (llm.generate as Mock)
      .mockRejectedValueOnce(new Error('LLM timeout'))
      .mockResolvedValueOnce('What are the quarterly earnings results?\nfactoid');

    const svc = await buildService(db, llm);
    const results = await svc.fromChunkReverse(5);

    expect(results).toHaveLength(1);
    expect(results[0]!.query).toBe('What are the quarterly earnings results?');
  });

  it('falls back to unknown class when LLM returns unrecognised class label', async () => {
    const db = makeDb();
    db.execute
      .mockResolvedValueOnce([
        { doc_type: 'SEC_FILING', sector: 'Technology', cnt: '5' },
      ])
      .mockResolvedValueOnce([
        { id: 'chunk-1', content: 'Some chunk about technology investment.' },
      ]);

    const svc = await buildService(db, makeLlm('What is the investment outlook here?\nweird_class'));
    const results = await svc.fromChunkReverse(5);

    expect(results[0]!.query_class).toBe('unknown');
  });

  it('returns empty list with a warning when no chunks exist', async () => {
    const db = makeDb();
    db.execute.mockResolvedValueOnce([]); // no strata

    const svc = await buildService(db, makeLlm());
    const results = await svc.fromChunkReverse(5);

    expect(results).toHaveLength(0);
  });

  it('caps limit at 30 regardless of argument', async () => {
    const db = makeDb();
    // Single stratum, limit=100 → effectiveLimit=30, quota=30, overshoot=60
    db.execute
      .mockResolvedValueOnce([
        { doc_type: 'SEC_FILING', sector: 'Technology', cnt: '100' },
      ])
      // Return 60 chunks so we can verify at most 30 are processed
      .mockResolvedValueOnce(
        Array.from({ length: 60 }, (_, i) => ({
          id: `chunk-${i}`,
          content: `Chunk content number ${i} about financial markets here.`,
        })),
      );

    const llm = makeLlm('What is the revenue?\nfactoid');
    const svc = await buildService(db, llm);
    const results = await svc.fromChunkReverse(100);

    // Hard cap: at most 30 entries even though 60 chunks were fetched
    expect(results.length).toBeLessThanOrEqual(30);
  });

  it('stratification fills from other strata when a stratum is short', async () => {
    // 3 strata; limit=12 → quota=ceil(12/3)=4
    // Stratum A: has 8 rows (≥ quota*2=8, so ample)
    // Stratum B: has 8 rows (ample)
    // Stratum C: has only 1 row (short)
    // First pass: A contributes 4, B contributes 4, C contributes 1 → total 9
    // Fill pass: A and B each have reserve rows → round-robin fills 3 more → total 12
    const db = makeDb();

    const makeChunks = (prefix: string, count: number) =>
      Array.from({ length: count }, (_, i) => ({
        id: `${prefix}-${i}`,
        content: `Content from stratum ${prefix} chunk ${i} about financial markets.`,
      }));

    db.execute
      .mockResolvedValueOnce([
        { doc_type: 'SEC_FILING', sector: 'Technology', cnt: '50' },
        { doc_type: 'RESEARCH_REPORT', sector: 'Finance', cnt: '40' },
        { doc_type: 'NEWS', sector: 'Energy', cnt: '30' },
      ])
      // Stratum A: 8 rows returned (quota*2 = 4*2 = 8) — ample
      .mockResolvedValueOnce(makeChunks('A', 8))
      // Stratum B: 8 rows returned — ample
      .mockResolvedValueOnce(makeChunks('B', 8))
      // Stratum C: only 1 row returned — short
      .mockResolvedValueOnce(makeChunks('C', 1));

    const llm = makeLlm('What does this passage describe?\nfactoid');
    const svc = await buildService(db, llm);
    const results = await svc.fromChunkReverse(12);

    // Total must reach 12 (fill-from-others worked)
    expect(results).toHaveLength(12);

    // Stratum C contributes exactly 1
    const cCount = results.filter((r) =>
      r.source_provenance.source_chunk_id?.startsWith('C-'),
    ).length;
    expect(cCount).toBe(1);
  });

  it('fromChunkReverse dry-run path does NOT call the LLM client', async () => {
    const db = makeDb();
    db.execute
      .mockResolvedValueOnce([
        { doc_type: 'SEC_FILING', sector: 'Technology', cnt: '10' },
      ])
      .mockResolvedValueOnce([
        { id: 'chunk-1', content: 'Apple reported strong Q1 2024 earnings results.' },
        { id: 'chunk-2', content: 'The Fed raised interest rates by 25 basis points.' },
      ]);

    const llm = makeLlm();
    const svc = await buildService(db, llm);
    const results = await svc.fromChunkReverse(5, { dryRun: true });

    // LLM must never have been called
    expect(llm.generate).not.toHaveBeenCalled();

    // Placeholder queries must appear
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.query).toBe('[dry-run] What does this passage describe?');
      expect(r.query_class).toBe('unknown');
      expect(r.source_provenance.source).toBe('reverse_from_chunk');
    }
  });
});

// ── Tests: buildDraft ─────────────────────────────────────────────────────────

describe('GoldenCandidatesService.buildDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccess.mockRejectedValue(new Error('ENOENT'));
    mockWriteFile.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);
  });

  it('writes to the specified output path when file does not exist', async () => {
    const db = makeDb();
    db.limit.mockResolvedValue([]);
    db.execute.mockResolvedValue([]);

    const svc = await buildService(db, makeLlm());
    await svc.buildDraft({ outputPath: '/tmp/golden-candidates-draft.json' });

    expect(mockWriteFile).toHaveBeenCalledWith(
      '/tmp/golden-candidates-draft.json',
      expect.any(String),
      'utf8',
    );
    expect(mockRename).not.toHaveBeenCalled();
  });

  it('moves an existing draft to a .prev-<timestamp>.json file before writing', async () => {
    mockAccess.mockResolvedValueOnce(undefined); // file exists

    const db = makeDb();
    db.limit.mockResolvedValue([]);
    db.execute.mockResolvedValue([]);

    const svc = await buildService(db, makeLlm());
    await svc.buildDraft({ outputPath: '/tmp/golden-candidates-draft.json' });

    expect(mockRename).toHaveBeenCalledTimes(1);
    const [, prevPath] = (mockRename as Mock).mock.calls[0]!;
    expect(prevPath).toMatch(/golden-candidates-draft\.prev-\d+\.json$/);
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
  });

  it('does not write anything when dryRun=true', async () => {
    const db = makeDb();
    db.limit.mockResolvedValue([]);
    db.execute.mockResolvedValue([]);

    const svc = await buildService(db, makeLlm());
    await svc.buildDraft({ outputPath: '/tmp/golden-candidates-draft.json', dryRun: true });

    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockRename).not.toHaveBeenCalled();
  });

  it('rejects outputPath equal to golden.json', async () => {
    const db = makeDb();
    const svc = await buildService(db, makeLlm());

    await expect(
      svc.buildDraft({ outputPath: '/some/path/golden.json' }),
    ).rejects.toThrow('Refusing to write to golden.json');
  });

  it('written JSON is a valid array of candidate objects', async () => {
    const db = makeDb();
    db.limit.mockResolvedValueOnce([
      { id: 'msg-1', content: 'What is the AAPL PE ratio right now?', role: 'user' },
    ]);
    db.limit.mockResolvedValue([]);
    db.execute.mockResolvedValue([]);

    const svc = await buildService(db, makeLlm());
    await svc.buildDraft({ outputPath: '/tmp/golden-candidates-draft.json' });

    const writtenArg = (mockWriteFile as Mock).mock.calls[0]![1] as string;
    const parsed = JSON.parse(writtenArg) as unknown[];

    expect(Array.isArray(parsed)).toBe(true);
    const first = parsed[0] as Record<string, unknown>;
    expect(first).toHaveProperty('id');
    expect(first).toHaveProperty('query');
    expect(first).toHaveProperty('query_class');
    expect(first).toHaveProperty('expected_chunk_ids');
    expect(first).toHaveProperty('source_provenance');
  });
});
