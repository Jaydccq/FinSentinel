import { defineZodTool as tool } from '@finsentinel/ai-runtime';
import { z } from 'zod';
import { NewsAnalysisService } from '../news-analysis.service';

/**
 * News analysis and RAG knowledge base search tools.
 *
 * News-analysis tool surface exposed to the agent.
 */
export function createNewsAnalysisTools(service: NewsAnalysisService) {
  return {
    getRecentNews: tool({
      description:
        'Fetch recent financial news articles for a stock ticker from Polygon.io. ' +
        'Returns article titles, descriptions, authors, and publish dates. ' +
        'Use this to understand current market sentiment and recent events for a stock.',
      inputSchema: z.object({
        ticker: z.string().describe('Stock ticker symbol, e.g. AAPL'),
        days: z.number().int().min(1).max(30).describe('Number of days back to search (1-30)'),
      }),
      execute: async ({ ticker, days }) => {
        try {
          return await service.getRecentNews(ticker, days);
        } catch (e) {
          return `Error fetching news for ${ticker}: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    searchKnowledgeBase: tool({
      description:
        'Search the RAG knowledge base for relevant financial documents. ' +
        'Searches through SEC filings, research reports, regulations, and news stored in the vector database. ' +
        'Use this to find in-depth analysis, regulatory context, or historical research on a topic.',
      inputSchema: z.object({
        query: z
          .string()
          .describe(
            "Search query, e.g. 'Apple revenue trends' or 'SEC insider trading regulations'",
          ),
        docType: z
          .string()
          .optional()
          .describe(
            'Document type filter: SEC_FILING, RESEARCH_REPORT, NEWS, REGULATION, or omit for all',
          ),
        afterDate: z
          .string()
          .optional()
          .describe(
            'Only return documents from after this date (YYYY-MM-DD format), or omit for all dates',
          ),
      }),
      execute: async ({ query, docType, afterDate }) => {
        try {
          return await service.searchKnowledgeBase(query, docType, afterDate);
        } catch (e) {
          return `Error searching knowledge base: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),
  };
}
