import { z } from 'zod';

// --- ApiKeySaveRequest ---
export const apiKeySaveRequestSchema = z.object({
  value: z.string().min(1),
});
export type ApiKeySaveRequest = z.infer<typeof apiKeySaveRequestSchema>;

// --- ApiKeyStatusResponse ---
export const apiKeyStatusResponseSchema = z.object({
  name: z.string(),
  label: z.string(),
  configured: z.boolean(),
  maskedPreview: z.string().nullable(),
  category: z.string(),
});
export type ApiKeyStatusResponse = z.infer<typeof apiKeyStatusResponseSchema>;
