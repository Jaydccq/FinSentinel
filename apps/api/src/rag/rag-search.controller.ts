import {
  Body,
  Controller,
  ForbiddenException,
  Inject,
  Logger,
  Optional,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RagRetrievalService, type RagSearchResult } from './rag-retrieval.service';

/**
 * Minimal HTTP endpoint for driving RagRetrievalService from the
 * evaluation runner (services/evaluation-runner/run_evaluation.py).
 *
 * The existing retrieval service is only reachable programmatically
 * via chat + analysis; wave2-buckets.yaml has long specified an
 * `api_base_url: "http://localhost:3001"` / `endpoint: "/api/rag/search"`
 * contract that no controller actually implemented. This fills the gap
 * so the P1.6 live-API baseline (and P5 live A/B) can run against a
 * localhost apps/api.
 *
 * Safety: gated by `RAG_EVAL_ENDPOINT_ENABLED=true`. When the flag is
 * unset (production default), POST returns 403. This keeps the endpoint
 * out of production unless an operator explicitly opts in.
 *
 * No authentication guard on purpose: the eval runner is a CI/local
 * tool, and auth setup would slow the feedback loop. Gate the FLAG,
 * not the request.
 */

export interface RagSearchRequest {
  query: string;
  topK?: number;
  queryClass?: string;
  docType?: string;
  sector?: string;
  regionId?: string;
  afterDate?: string;
}

export interface RagSearchApiResponse {
  results: RagSearchResult[];
}

@Controller('rag')
export class RagSearchController {
  private readonly logger = new Logger(RagSearchController.name);
  private readonly enabled: boolean;

  constructor(
    private readonly retrievalService: RagRetrievalService,
    @Optional() configService?: ConfigService,
  ) {
    this.enabled =
      configService?.get<string>('RAG_EVAL_ENDPOINT_ENABLED', 'false') === 'true';
    if (this.enabled) {
      this.logger.warn(
        'RAG_EVAL_ENDPOINT_ENABLED=true — /api/rag/search is open for ' +
        'evaluation use. Do NOT enable in production environments.',
      );
    }
  }

  @Post('search')
  async search(@Body() body: RagSearchRequest): Promise<RagSearchApiResponse> {
    if (!this.enabled) {
      throw new ForbiddenException(
        'RAG eval endpoint disabled. Set RAG_EVAL_ENDPOINT_ENABLED=true to enable.',
      );
    }
    const query = (body?.query ?? '').trim();
    if (!query) {
      return { results: [] };
    }
    const results = await this.retrievalService.search({
      query,
      topK: body.topK,
      queryClass: body.queryClass,
      docType: body.docType,
      sector: body.sector,
      regionId: body.regionId,
      afterDate: body.afterDate,
    });
    return { results };
  }
}
