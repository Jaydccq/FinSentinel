import { Injectable, BadRequestException } from '@nestjs/common';
import type { OrderDraft, UnifiedStageRequest } from '@finsentinel/shared';

@Injectable()
export class OrderDraftMapper {
  toUnifiedStageRequest(draft: OrderDraft): UnifiedStageRequest {
    const base: UnifiedStageRequest = {
      action: draft.side,
      symbol: draft.symbol,
    };

    switch (draft.quantity.mode) {
      case 'SHARES':
      case 'CONTRACTS':
        return { ...base, qty: String(draft.quantity.value) };
      case 'NOTIONAL_USD':
        return { ...base, amount: String(draft.quantity.value) };
      case 'PERCENT_NAV':
        throw new BadRequestException(
          'PERCENT_NAV quantity mode is not supported in v1 — resubmit with SHARES or NOTIONAL_USD',
        );
    }
  }
}
