import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueryRewriteService } from './query-rewrite.service';

export interface RetrievalPlan {
  originalQuery: string;
  rewrittenQuery: string;
  lanes: Array<'dense' | 'sparse' | 'graph'>;
  topKPerLane: number;
}

const RELATION_CUES =
  /\b(competitor|supplier|partner|acquired|subsidiary|related|connected|supply chain|board member|invested in|CEO of)\b/i;

const GRAPH_QUERY_PATTERNS =
  /\b(who|which companies|what companies|competitors of|suppliers of|partners of|how .* connected|how .* related)\b/i;

@Injectable()
export class RetrievalPlannerService {
  private readonly logger = new Logger(RetrievalPlannerService.name);
  private readonly graphEnabled: boolean;

  constructor(
    private readonly queryRewrite: QueryRewriteService,
    configService: ConfigService,
  ) {
    // Graph lane is disabled by default until graph enrichment pipeline is implemented
    this.graphEnabled = configService.get<string>('RAG_GRAPH_ENABLED', 'false') === 'true';
  }

  async plan(query: string, topKPerLane = 20): Promise<RetrievalPlan> {
    const rewrittenQuery = await this.queryRewrite.rewrite(query);
    const lanes: Array<'dense' | 'sparse' | 'graph'> = ['dense', 'sparse'];

    if (this.graphEnabled && this.shouldActivateGraphLane(query)) {
      lanes.push('graph');
    }

    return { originalQuery: query, rewrittenQuery, lanes, topKPerLane };
  }

  private shouldActivateGraphLane(query: string): boolean {
    return RELATION_CUES.test(query) || GRAPH_QUERY_PATTERNS.test(query);
  }
}
