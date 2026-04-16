import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  orderDraftSchema,
  orderDraftsPayloadSchema,
  type OrderDraftsPayload,
} from '@finsentinel/shared';

// Strict payload schema — rejects any extra keys on individual drafts
const orderDraftsPayloadStrictSchema = z.object({
  orderDrafts: z.array(orderDraftSchema.strict()),
});

@Injectable()
export class OrderDraftValidator {
  validate(raw: unknown): OrderDraftsPayload {
    // Parse strictly first to catch broker-specific leakage / extra fields
    orderDraftsPayloadStrictSchema.parse(raw);
    // Then parse with the canonical shared schema to get the typed return value
    return orderDraftsPayloadSchema.parse(raw);
  }
}
