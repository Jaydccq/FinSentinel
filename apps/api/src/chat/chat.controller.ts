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
import { ChatService } from './chat.service';

/**
 * Chat controller — SSE streaming + structured risk assessment.
 *
 * POST /chat/stream     — streams AI response via SSE
 * POST /chat/assess     — returns structured RiskReport JSON
 * GET  /chat/sessions   — list user's chat sessions
 * GET  /chat/sessions/:sessionId — get messages for a session
 */
@Controller('chat')
@UseGuards(JwtGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

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
    const result = await this.chatService.streamChat(
      body.message,
      user.userId,
      body.sessionId,
    );

    // Set SSE headers and status (must set status explicitly with @Res())
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Nginx buffering off

    // Pipe the ReadableStream to the response
    const reader = result.stream.getReader();
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
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.chatService.assess(body.message, user.userId, body.sessionId);
  }

  // ── GET /chat/sessions ────────────────────────────────────────────────

  @Get('sessions')
  async listSessions(
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<ChatSessionSummary[]> {
    return this.chatService.listSessions(user.userId);
  }

  // ── GET /chat/sessions/:sessionId ──────────────────────────────────────

  @Get('sessions/:sessionId')
  async getSessionMessages(
    @CurrentUser() user: CurrentUserPayload,
    @Param('sessionId') sessionId: string,
  ): Promise<ChatMessageResponse[]> {
    return this.chatService.getSessionMessages(user.userId, sessionId);
  }
}
