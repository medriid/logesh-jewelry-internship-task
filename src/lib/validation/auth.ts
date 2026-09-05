import { z } from 'zod';

/**
 * Auth input schemas. Shared by the API route and the admin login form, so the
 * two cannot disagree about what a valid credential looks like.
 */

export const loginSchema = z
  .object({
    email: z.email().max(320).trim().toLowerCase(),
    /**
     * Length only. No composition rules — NIST dropped them because they push
     * people toward `Password1!` and away from length, which is what actually
     * matters. Capped at 256 so a megabyte "password" cannot be used to make
     * the server burn Argon2 time on request.
     */
    password: z.string().min(12, 'Use at least 12 characters').max(256),
  })
  .strict();

export type LoginInput = z.infer<typeof loginSchema>;
