import {
  Controller,
  Get,
  Put,
  Body,
  UseGuards,
} from '@nestjs/common';
import { heartbeatConfigRequestSchema } from '@finsentinel/shared';
import type { HeartbeatConfigRequest } from '@finsentinel/shared';
import { JwtGuard } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { HeartbeatService } from './heartbeat.service';

/**
 * Heartbeat controller — manages per-user heartbeat configuration.
 *
 * GET /heartbeat — get heartbeat config
 * PUT /heartbeat — update heartbeat config
 */
@Controller('heartbeat')
@UseGuards(JwtGuard)
export class HeartbeatController {
  constructor(private readonly heartbeatService: HeartbeatService) {}

  @Get()
  async getStatus(@CurrentUser() user: CurrentUserPayload) {
    return this.heartbeatService.getOrCreateConfig(user.userId);
  }

  @Put()
  async updateConfig(
    @CurrentUser() user: CurrentUserPayload,
    @Body(new ZodValidationPipe(heartbeatConfigRequestSchema)) body: HeartbeatConfigRequest,
  ) {
    return this.heartbeatService.updateConfig(user.userId, {
      enabled: body.enabled,
      intervalSeconds: body.intervalSeconds,
      drawdownAlertPct: body.drawdownAlertPct,
    });
  }
}
