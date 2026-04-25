import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { agentScheduleRequestSchema } from '@finsentinel/shared';
import type { AgentScheduleRequest } from '@finsentinel/shared';
import { JwtGuard } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ScheduleService } from './schedule.service';

/**
 * Schedule controller — CRUD for user cron schedules.
 *
 * POST   /schedules            — create schedule
 * GET    /schedules            — list user schedules
 * PUT    /schedules/:id        — update schedule
 * POST   /schedules/:id/pause  — pause schedule
 * POST   /schedules/:id/resume — resume schedule
 * DELETE /schedules/:id        — delete schedule
 */
@Controller('schedules')
@UseGuards(JwtGuard)
export class ScheduleController {
  constructor(private readonly scheduleService: ScheduleService) {}

  @Get()
  async list(@CurrentUser() user: CurrentUserPayload) {
    return this.scheduleService.listByUser(user.userId);
  }

  @Post()
  async create(
    @CurrentUser() user: CurrentUserPayload,
    @Body(new ZodValidationPipe(agentScheduleRequestSchema)) body: AgentScheduleRequest,
  ) {
    return this.scheduleService.create(
      user.userId,
      body.name,
      body.cronExpression,
      body.taskType,
      body.payload ?? {},
      body.enabled ?? true,
    );
  }

  @Put(':id')
  async update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(agentScheduleRequestSchema)) body: AgentScheduleRequest,
  ) {
    return this.scheduleService.update(user.userId, id, {
      name: body.name,
      cronExpression: body.cronExpression,
      taskType: body.taskType,
      taskPayload: body.payload ?? {},
      enabled: body.enabled ?? true,
    });
  }

  @Post(':id/pause')
  @HttpCode(HttpStatus.OK)
  async pause(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.scheduleService.pause(user.userId, id);
  }

  @Post(':id/resume')
  @HttpCode(HttpStatus.OK)
  async resume(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.scheduleService.resume(user.userId, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    await this.scheduleService.delete(user.userId, id);
  }
}
