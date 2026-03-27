import { z } from 'zod';

// --- ChatRequest ---
export const chatRequestSchema = z.object({
  message: z.string().min(1),
  sessionId: z.string().uuid().optional(),
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;

// --- ChatMessageResponse ---
export const chatMessageResponseSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  role: z.string(),
  content: z.string(),
  createdAt: z.string().datetime(),
});
export type ChatMessageResponse = z.infer<typeof chatMessageResponseSchema>;

// --- ChatSessionSummary ---
export const chatSessionSummarySchema = z.object({
  sessionId: z.string().uuid(),
  firstMessage: z.string(),
  messageCount: z.number().int(),
  createdAt: z.string().datetime(),
  lastMessageAt: z.string().datetime(),
});
export type ChatSessionSummary = z.infer<typeof chatSessionSummarySchema>;
