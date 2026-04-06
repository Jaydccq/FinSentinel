import { describe, it, expect } from 'vitest';
import { chatRequestSchema } from '../schemas/chat';

describe('chatRequestSchema', () => {
  it('accepts message with portfolioId', () => {
    const result = chatRequestSchema.safeParse({
      message: 'Analyze my portfolio',
      portfolioId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.portfolioId).toBe('550e8400-e29b-41d4-a716-446655440000');
    }
  });

  it('accepts message without portfolioId', () => {
    const result = chatRequestSchema.safeParse({ message: 'Hello' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.portfolioId).toBeUndefined();
    }
  });

  it('rejects non-uuid portfolioId', () => {
    const result = chatRequestSchema.safeParse({
      message: 'Hello',
      portfolioId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });
});
