import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * REST client for the 6551 Twitter API.
 *
 * All endpoints are POST with JSON body and Bearer token auth.
 * Gated by `APP_TWITTER_6551_ENABLED=true`.
 */
@Injectable()
export class TwitterDataService {
  private readonly logger = new Logger(TwitterDataService.name);
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(configService: ConfigService) {
    this.baseUrl = configService.get<string>('TWITTER_6551_BASE_URL', 'https://api.6551.io');
    this.token = configService.get<string>('TWITTER_6551_TOKEN', '');
  }

  /**
   * Get user profile information by username.
   */
  async getUserInfo(username: string): Promise<unknown> {
    return this.post('/open/twitter/user_info', { username });
  }

  /**
   * Get user profile information by numeric user ID.
   */
  async getUserById(userId: string): Promise<unknown> {
    return this.post('/open/twitter/user_by_id', { user_id: userId });
  }

  /**
   * Get a user's recent tweets.
   *
   * @param username       - Twitter handle (without @)
   * @param maxResults     - Maximum tweets to return (default 20)
   * @param includeReplies - Include reply tweets (default false)
   * @param includeRetweets - Include retweets (default false)
   */
  async getUserTweets(
    username: string,
    maxResults = 20,
    includeReplies = false,
    includeRetweets = false,
  ): Promise<unknown> {
    return this.post('/open/twitter/user_tweets', {
      username,
      max_results: maxResults,
      include_replies: includeReplies,
      include_retweets: includeRetweets,
    });
  }

  /**
   * Get a user's followers list.
   *
   * @param username   - Twitter handle (without @)
   * @param maxResults - Maximum followers to return (default 20)
   */
  async getUserFollowers(username: string, maxResults = 20): Promise<unknown> {
    return this.post('/open/twitter/user_followers', {
      username,
      max_results: maxResults,
    });
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private async post(path: string, body: Record<string, unknown>): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      this.logger.error(
        `6551 Twitter API error: ${response.status} ${response.statusText} — ${text}`,
      );
      throw new Error(`6551 Twitter API returned ${response.status}: ${text}`);
    }

    return response.json();
  }
}
