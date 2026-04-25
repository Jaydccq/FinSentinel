import { registerAs } from '@nestjs/config';

export const chatConfig = registerAs('chat', () => ({
  compaction: {
    enabled: process.env['CHAT_COMPACTION_ENABLED'] !== 'false',
    threshold: Number(process.env['CHAT_COMPACTION_THRESHOLD']) || 24,
    recentWindow: Number(process.env['CHAT_COMPACTION_RECENT_WINDOW']) || 10,
    maxSummaryChars: Number(process.env['CHAT_COMPACTION_MAX_SUMMARY_CHARS']) || 1200,
  },
  confirmation: {
    tradeThreshold: process.env['CONFIRMATION_TRADE_THRESHOLD'] || '10000',
    blockLive: process.env['CONFIRMATION_BLOCK_LIVE'] !== 'false',
  },
}));
