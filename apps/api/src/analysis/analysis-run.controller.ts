import {
  Body,
  Controller,
  BadRequestException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { analysisStageKeySchema, createRunRequestSchema } from '@finsentinel/shared';
import type { CreateRunRequest } from '@finsentinel/shared';
import { AnalysisRunService } from './analysis-run.service';
import { AnalysisRunProducer } from '../queue/analysis-run.producer';
import { ContextJournalService } from './context-journal.service';

@Controller('analysis/runs')
@UseGuards(JwtGuard)
export class AnalysisRunController {
  constructor(
    private readonly runs: AnalysisRunService,
    private readonly producer: AnalysisRunProducer,
    private readonly contextJournal: ContextJournalService,
  ) {}

  @Post()
  async create(@Body() body: CreateRunRequest, @CurrentUser() user: CurrentUserPayload): Promise<unknown> {
    const req = createRunRequestSchema.parse(body);
    const row = await this.runs.createQueued(user.userId, req);
    await this.producer.enqueuePreflight({ runId: row.id, userId: user.userId });
    return row;
  }

  @Get()
  async list(@CurrentUser() user: CurrentUserPayload): Promise<unknown[]> {
    return this.runs.listByUser(user.userId);
  }

  @Get(':id')
  async getOne(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<unknown> {
    const row = await this.runs.getForUser(user.userId, id);
    if (!row) throw new NotFoundException(`Run ${id} not found`);
    return row;
  }

  @Get(':id/stages')
  async listStages(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const run = await this.runs.getForUser(user.userId, id);
    if (!run) throw new NotFoundException(`Run ${id} not found`);
    return this.runs.listStagesForRun(id);
  }

  @Get(':id/artifacts')
  async listArtifacts(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const run = await this.runs.getForUser(user.userId, id);
    if (!run) throw new NotFoundException(`Run ${id} not found`);
    return this.runs.listArtifactsForRun(id);
  }

  @Get(':id/approvals')
  async listApprovals(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const run = await this.runs.getForUser(user.userId, id);
    if (!run) throw new NotFoundException(`Run ${id} not found`);
    return this.runs.listApprovalsForRun(id);
  }

  @Post(':id/pause')
  async pause(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    await this.runs.pause(user.userId, id);
    return { ok: true };
  }

  @Post(':id/resume')
  async resume(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    await this.runs.resume(user.userId, id);
    return { ok: true };
  }

  @Post(':id/cancel')
  async cancel(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    await this.runs.cancel(user.userId, id);
    return { ok: true };
  }

  @Get(':id/context')
  async getContext(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const run = await this.runs.getForUser(user.userId, id);
    if (!run) throw new NotFoundException(`Run ${id} not found`);
    return this.contextJournal.getRunContext(user.userId, id);
  }

  @Get(':id/stages/:stageKey/input')
  async getStageInput(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('stageKey') stageKey: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const parsedStageKey = analysisStageKeySchema.safeParse(stageKey);
    if (!parsedStageKey.success) {
      throw new BadRequestException(`Invalid stage key: ${stageKey}`);
    }

    const run = await this.runs.getForUser(user.userId, id);
    if (!run) throw new NotFoundException(`Run ${id} not found`);

    const snapshot = await this.contextJournal.getStageInput(user.userId, id, parsedStageKey.data);
    if (!snapshot) {
      throw new NotFoundException(`Stage input for run ${id} and stage ${parsedStageKey.data} not found`);
    }

    return snapshot;
  }
}
