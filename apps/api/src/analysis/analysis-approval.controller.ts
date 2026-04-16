import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import {
  approveExecutionRequestSchema,
  type ApproveExecutionRequest,
} from '@finsentinel/shared';
import { AnalysisApprovalService } from './analysis-approval.service';

@Controller('analysis/approvals')
@UseGuards(JwtGuard)
export class AnalysisApprovalController {
  constructor(private readonly approvals: AnalysisApprovalService) {}

  @Post(':id/resolve')
  async resolve(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ApproveExecutionRequest,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const parsed = approveExecutionRequestSchema.parse(body);
    await this.approvals.resolve({
      userId: user.userId,
      approvalId: id,
      decision: parsed.decision,
      note: parsed.note,
    });
    return { ok: true };
  }
}
