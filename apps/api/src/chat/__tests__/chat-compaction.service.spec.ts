import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ChatCompactionService } from '../chat-compaction.service';

// ── Constants ──────────────────────────────────────────────────────────────
const USER_ID = '11111111-1111-1111-1111-111111111111';
const SESSION_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

// ── Mock Drizzle DB ────────────────────────────────────────────────────────
function createMockDb() {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  };
  const insertChain = {
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
  };

  return {
    select: vi.fn().mockReturnValue(selectChain),
    insert: vi.fn().mockReturnValue(insertChain),
    _selectChain: selectChain,
    _insertChain: insertChain,
  };
}

// ── Config factory ────────────────────────────────────────────────────────
function createConfigService(overrides: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {
    'chat.compaction.enabled': true,
    'chat.compaction.threshold': 24,
    'chat.compaction.recentWindow': 10,
    'chat.compaction.maxSummaryChars': 1200,
    ...overrides,
  };
  return {
    get: (key: string, defaultVal: unknown) => defaults[key] ?? defaultVal,
  };
}

describe('ChatCompactionService', () => {
  let service: ChatCompactionService;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(async () => {
    mockDb = createMockDb();

    const module = await Test.createTestingModule({
      providers: [
        ChatCompactionService,
        { provide: 'DRIZZLE_DB', useValue: mockDb },
        { provide: ConfigService, useValue: createConfigService() },
      ],
    }).compile();

    service = module.get(ChatCompactionService);
  });

  // ── augmentPrompt: below threshold ──────────────────────────────────────

  it('returns original message when count is below threshold', async () => {
    // Count query returns 10 messages (below default threshold of 24)
    mockDb._selectChain.where.mockResolvedValueOnce([{ count: 10 }]);

    const result = await service.augmentPrompt(USER_ID, SESSION_ID, 'Hello');

    expect(result).toBe('Hello');
    // No insert for summary
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  // ── augmentPrompt: at threshold ─────────────────────────────────────────

  it('compacts and prepends summary when count >= threshold', async () => {
    // Count = 30 (above threshold of 24), so compact 30 - 10 = 20 messages
    mockDb._selectChain.where.mockResolvedValueOnce([{ count: 30 }]);

    // Return old messages for summarization
    const oldMessages = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i}`,
    }));
    mockDb._selectChain.limit.mockResolvedValueOnce(oldMessages);

    const result = await service.augmentPrompt(USER_ID, SESSION_ID, 'What is AAPL?');

    expect(result).toContain('[Previous context summary:');
    expect(result).toContain('What is AAPL?');
    // Summary should be stored
    expect(mockDb.insert).toHaveBeenCalled();
  });

  // ── augmentPrompt: disabled ─────────────────────────────────────────────

  it('returns original message when compaction is disabled', async () => {
    const module = await Test.createTestingModule({
      providers: [
        ChatCompactionService,
        { provide: 'DRIZZLE_DB', useValue: mockDb },
        {
          provide: ConfigService,
          useValue: createConfigService({ 'chat.compaction.enabled': false }),
        },
      ],
    }).compile();

    const disabledService = module.get(ChatCompactionService);
    const result = await disabledService.augmentPrompt(USER_ID, SESSION_ID, 'Hello');

    expect(result).toBe('Hello');
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  // ── generateSummary ─────────────────────────────────────────────────────

  it('generateSummary concatenates messages', async () => {
    const messages = [
      { role: 'user', content: 'What is AAPL?' },
      { role: 'assistant', content: 'AAPL is Apple Inc.' },
    ];

    const summary = await service.generateSummary(messages);

    expect(summary).toContain('user: What is AAPL?');
    expect(summary).toContain('assistant: AAPL is Apple Inc.');
  });

  // ── generateSummary: truncation ─────────────────────────────────────────

  it('generateSummary truncates to maxSummaryChars', async () => {
    // Create service with tiny maxSummaryChars
    const module = await Test.createTestingModule({
      providers: [
        ChatCompactionService,
        { provide: 'DRIZZLE_DB', useValue: mockDb },
        {
          provide: ConfigService,
          useValue: createConfigService({ 'chat.compaction.maxSummaryChars': 20 }),
        },
      ],
    }).compile();

    const shortService = module.get(ChatCompactionService);
    const messages = [
      { role: 'user', content: 'This is a very long message that should be truncated' },
    ];

    const summary = await shortService.generateSummary(messages);
    expect(summary.length).toBeLessThanOrEqual(20);
  });

  // ── isEnabled / getThreshold ────────────────────────────────────────────

  it('isEnabled returns configured value', () => {
    expect(service.isEnabled()).toBe(true);
  });

  it('getThreshold returns configured value', () => {
    expect(service.getThreshold()).toBe(24);
  });

  // ── augmentPrompt: no old messages found ────────────────────────────────

  it('returns original message when no old messages found', async () => {
    // Count = 30 (above threshold)
    mockDb._selectChain.where.mockResolvedValueOnce([{ count: 30 }]);
    // But no old messages returned
    mockDb._selectChain.limit.mockResolvedValueOnce([]);

    const result = await service.augmentPrompt(USER_ID, SESSION_ID, 'Hello');

    expect(result).toBe('Hello');
    expect(mockDb.insert).not.toHaveBeenCalled();
  });
});
