import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Sentiment classification result.
 */
export type Sentiment = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';

const VALID_SENTIMENTS = new Set<string>(['POSITIVE', 'NEGATIVE', 'NEUTRAL']);

const SENTIMENT_PROMPT =
  'Classify the financial sentiment of this article as POSITIVE, NEGATIVE, or NEUTRAL. Respond with only one word.';

/**
 * Uses an LLM (via OpenRouter / OpenAI-compatible API) to classify
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
    this.apiKey = configService.get<string>('OPENROUTER_API_KEY', '');
    this.model = configService.get<string>(
      'AI_MODEL',
      'google/gemini-3-flash-preview',
    );
    this.baseUrl = configService.get<string>(
      'OPENROUTER_BASE_URL',
      'https://openrouter.ai/api',
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
    const content = summary
      ? `Title: ${title}\nSummary: ${summary}`
      : `Title: ${title}`;

    try {
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
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
        this.logger.error(
          `Sentiment API error: ${response.status} — ${text}`,
        );
        return 'NEUTRAL';
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };

      const rawAnswer =
        data.choices?.[0]?.message?.content?.trim().toUpperCase() ?? '';

      if (VALID_SENTIMENTS.has(rawAnswer)) {
        return rawAnswer as Sentiment;
      }

      this.logger.warn(
        `Unexpected sentiment response: "${rawAnswer}", defaulting to NEUTRAL`,
      );
      return 'NEUTRAL';
    } catch (err) {
      this.logger.error(
        `Sentiment classification failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 'NEUTRAL';
    }
  }
}
