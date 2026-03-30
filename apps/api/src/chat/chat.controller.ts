import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { chatRequestSchema } from '@finsentinel/shared';
import type { ChatRequest, ChatSessionSummary, ChatMessageResponse } from '@finsentinel/shared';
import { JwtGuard } from '../auth/jwt.guard';
import { RateLimitGuard } from '../common/guards/rate-limit.guard';
import { RateLimit } from '../common/decorators/rate-limit.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AgentService } from '../agent/agent.service';
import { randomUUID } from 'crypto';

/**
 * Chat controller — SSE streaming + structured risk assessment.
 *
 * POST /chat/stream     — streams AI response via SSE
 * POST /chat/assess     — returns structured RiskReport JSON (stub)
 * GET  /chat/sessions   — list user's chat sessions (stub — future phase)
 * GET  /chat/sessions/:sessionId — get messages for a session (stub)
 */
@Controller('chat')
@UseGuards(JwtGuard)
export class ChatController {
  constructor(private readonly agentService: AgentService) {}

  // ── POST /chat/stream ──────────────────────────────────────────────────

  @Post('stream')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 10, windowSecs: 60 })
  @UseGuards(RateLimitGuard)
  async stream(
    @Body(new ZodValidationPipe(chatRequestSchema)) body: ChatRequest,
    @CurrentUser() user: CurrentUserPayload,
    @Res() res: Response,
  ) {
    const sessionId = body.sessionId ?? randomUUID();

    const sseStream = await this.agentService.streamChat(
      body.message,
      user.userId,
      [{ role: 'user', content: body.message }],
      sessionId,
    );

    // Set SSE headers and status (must set status explicitly with @Res())
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Nginx buffering off

    // Pipe the ReadableStream to the response
    const reader = sseStream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    } finally {
      res.end();
    }
  }

  // ── POST /chat/assess ─────────────────────────────────────────────────

  @Post('assess')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 5, windowSecs: 60 })
  @UseGuards(RateLimitGuard)
  async assess(
    @Body(new ZodValidationPipe(chatRequestSchema)) body: ChatRequest,
    @CurrentUser() _user: CurrentUserPayload,
  ) {
    // Stub — actual structured RiskReport generation is a future phase.
    // Will use generateText with Output.object({ schema: riskReportSchema })
    return {
      riskScore: 0,
      riskLevel: 'UNKNOWN',
      summary: 'Risk assessment not yet implemented.',
      factors: [],
      actionableAdvice: [],
    };
  }

  // ── GET /chat/sessions ────────────────────────────────────────────────

  @Get('sessions')
  async listSessions(
    @CurrentUser() _user: CurrentUserPayload,
  ): Promise<ChatSessionSummary[]> {
    // Stub — actual ChatService with DB persistence is a future phase.
    return [];
  }

  // ── GET /chat/sessions/:sessionId ──────────────────────────────────────

  @Get('sessions/:sessionId')
  async getSessionMessages(
    @CurrentUser() _user: CurrentUserPayload,
    @Param('sessionId') _sessionId: string,
  ): Promise<ChatMessageResponse[]> {
    // Stub — actual ChatService with DB persistence is a future phase.
    return [];
  }
}
