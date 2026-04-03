import { Injectable } from '@nestjs/common';
import { TwitterDataService } from '../twitter/twitter-data.service';

const DEFAULT_SEARCH_USERS = [
  'lookonchain',
  'WatcherGuru',
  'whale_alert',
  'CryptoCapo_',
];

interface TweetRecord {
  id?: string;
  text?: string;
  created_at?: string;
  public_metrics?: {
    like_count?: number;
    retweet_count?: number;
    reply_count?: number;
  };
}

interface TweetResponse {
  data?: TweetRecord[];
}

@Injectable()
export class TwitterToolsService {
  constructor(private readonly twitterDataService: TwitterDataService) {}

  async getTwitterProfile(username: string): Promise<string> {
    const profile = await this.twitterDataService.getUserInfo(this.normalizeHandle(username));
    return JSON.stringify(profile, null, 2);
  }

  async searchTweets(
    keywords: string,
    fromUser?: string,
    hashtag?: string,
    minLikes = 0,
    limit = 10,
  ): Promise<string> {
    const users = fromUser ? [this.normalizeHandle(fromUser)] : DEFAULT_SEARCH_USERS;
    const needle = keywords.toLowerCase();
    const hashtagNeedle = hashtag ? `#${hashtag.toLowerCase()}` : null;
    const matches: Array<Record<string, unknown>> = [];

    for (const user of users) {
      const response = (await this.twitterDataService.getUserTweets(
        user,
        Math.max(limit * 2, 10),
        true,
        true,
      )) as TweetResponse;

      for (const tweet of response.data ?? []) {
        const text = tweet.text ?? '';
        const likes = tweet.public_metrics?.like_count ?? 0;
        if (!text.toLowerCase().includes(needle)) continue;
        if (hashtagNeedle && !text.toLowerCase().includes(hashtagNeedle)) continue;
        if (likes < minLikes) continue;

        matches.push({
          author: user,
          id: tweet.id ?? null,
          createdAt: tweet.created_at ?? null,
          likes,
          retweets: tweet.public_metrics?.retweet_count ?? 0,
          replies: tweet.public_metrics?.reply_count ?? 0,
          text,
        });

        if (matches.length >= limit) {
          return JSON.stringify(matches, null, 2);
        }
      }
    }

    if (matches.length === 0) {
      return `No tweet matches found for "${keywords}". Search currently scans configured crypto-finance accounts rather than the full X firehose.`;
    }

    return JSON.stringify(matches, null, 2);
  }

  async getUserTweets(username: string, limit: number): Promise<string> {
    const tweets = await this.twitterDataService.getUserTweets(
      this.normalizeHandle(username),
      limit,
      true,
      true,
    );
    return JSON.stringify(tweets, null, 2);
  }

  async getKolFollowers(username: string): Promise<string> {
    const followers = await this.twitterDataService.getUserFollowers(
      this.normalizeHandle(username),
      20,
    );
    return JSON.stringify(followers, null, 2);
  }

  private normalizeHandle(username: string): string {
    return username.replace(/^@/, '').trim();
  }
}
