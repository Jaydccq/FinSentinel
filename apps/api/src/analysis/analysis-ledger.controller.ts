import { Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { ExecutionReviewLedgerService } from './execution-review-ledger.service';

@Controller('analysis/ledgers')
@UseGuards(JwtGuard)
export class AnalysisLedgerController {
  constructor(private readonly ledger: ExecutionReviewLedgerService) {}

  @Post(':id/commit')
  async commit(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ ok: true }> {
    await this.ledger.commitManual(user.userId, id);
    return { ok: true };
  }

  @Post(':id/dispatch')
  async dispatch(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ ok: true }> {
    await this.ledger.dispatchManual(user.userId, id);
    return { ok: true };
  }
}
