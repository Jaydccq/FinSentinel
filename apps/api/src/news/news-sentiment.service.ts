import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DEFAULT_OPENROUTER_BASE_URL,
  DEFAULT_OPENROUTER_TEXT_MODEL,
} from '@finsentinel/ai-runtime';

/**
 * Sentiment classification result.
 */
export type Sentiment = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';

const VALID_SENTIMENTS = new Set<string>(['POSITIVE', 'NEGATIVE', 'NEUTRAL']);

const SENTIMENT_PROMPT =
  'Classify the financial sentiment of this article as POSITIVE, NEGATIVE, or NEUTRAL. Respond with only one word.';

function normalizeOpenAIBaseUrl(value: string): string {
  const trimmed = value.replace(/\/$/, '');
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

/**
 * Uses an LLM via the configured OpenAI-compatible API to classify
 * the financial sentiment of a news article.
 *
 * Input: title + summary
 * Output: "POSITIVE" | "NEGATIVE" | "NEUTRAL"
 */
@Injectable()
export class NewsSentimentService {
  private readonly logger = new Logger(NewsSentimentService.name);
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(configService: ConfigService) {
    this.apiKey =
      configService.get<string>('ai.apiKey') || configService.get<string>('OPENROUTER_API_KEY', '');
    this.model =
      configService.get<string>('ai.model') ||
      configService.get<string>('AI_MODEL', DEFAULT_OPENROUTER_TEXT_MODEL);
    this.baseUrl = normalizeOpenAIBaseUrl(
      configService.get<string>('ai.baseUrl') ||
        configService.get<string>('OPENROUTER_BASE_URL', DEFAULT_OPENROUTER_BASE_URL),
    );
  }

  /**
   * Classify the financial sentiment of an article.
   *
   * @param title   - Article headline
   * @param summary - Article summary / description
   * @returns "POSITIVE" | "NEGATIVE" | "NEUTRAL"
   */
  async classify(title: string, summary: string | null): Promise<Sentiment> {
    const content = summary ? `Title: ${title}\nSummary: ${summary}` : `Title: ${title}`;

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: SENTIMENT_PROMPT },
            { role: 'user', content },
          ],
          max_tokens: 10,
          temperature: 0,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        this.logger.error(`Sentiment API error: ${response.status} — ${text}`);
        return 'NEUTRAL';
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };

      const rawAnswer = data.choices?.[0]?.message?.content?.trim().toUpperCase() ?? '';

      if (VALID_SENTIMENTS.has(rawAnswer)) {
        return rawAnswer as Sentiment;
      }

      this.logger.warn(`Unexpected sentiment response: "${rawAnswer}", defaulting to NEUTRAL`);
      return 'NEUTRAL';
    } catch (err) {
      this.logger.error(
        `Sentiment classification failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 'NEUTRAL';
    }
  }
}
