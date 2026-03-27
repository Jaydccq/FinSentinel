import { z } from 'zod';

// --- LoginRequest ---
export const loginRequestSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

// --- RegisterRequest ---
export const registerRequestSchema = z.object({
  username: z.string().min(3).max(50),
  email: z.string().email(),
  password: z
    .string()
    .min(8)
    .max(100)
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/,
      'Password must contain at least one uppercase letter, one lowercase letter, and one digit',
    ),
  displayName: z.string().optional(),
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

// --- AuthResponse ---
export const authResponseSchema = z.object({
  token: z.string(),
  username: z.string(),
  email: z.string(),
});
export type AuthResponse = z.infer<typeof authResponseSchema>;
