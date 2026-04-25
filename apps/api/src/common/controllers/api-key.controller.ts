import {
  Controller,
  Get,
  Put,
  Delete,
  Post,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtGuard } from '../../auth/jwt.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { ApiKeyService } from '../services/api-key.service';

/**
 * API key management controller — CRUD for user-scoped encrypted API keys.
 *
 * All endpoints require JWT authentication. Keys are stored encrypted
 * with AES-256-GCM and are never returned in plaintext after storage.
 */
@Controller('settings/api-keys')
@UseGuards(JwtGuard)
export class ApiKeyController {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  /** List configuration status of all known API keys. */
  @Get()
  async listStatus(@CurrentUser() user: CurrentUserPayload) {
    return this.apiKeyService.listStatus(user.userId);
  }

  /** Save (create or update) an API key. */
  @Put(':name')
  @HttpCode(HttpStatus.OK)
  async save(
    @CurrentUser() user: CurrentUserPayload,
    @Param('name') name: string,
    @Body() body: { value: string },
  ) {
    await this.apiKeyService.save(user.userId, name, body.value);
    return { message: `API key '${name}' saved` };
  }

  /** Delete an API key. */
  @Delete(':name')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@CurrentUser() user: CurrentUserPayload, @Param('name') name: string) {
    await this.apiKeyService.delete(user.userId, name);
  }

  /** Test API key connectivity (stub — always returns test_not_available). */
  @Post(':name/test')
  @HttpCode(HttpStatus.OK)
  async test(@CurrentUser() _user: CurrentUserPayload, @Param('name') _name: string) {
    return { success: false, message: 'API key connectivity test is not implemented yet.' };
  }
}
