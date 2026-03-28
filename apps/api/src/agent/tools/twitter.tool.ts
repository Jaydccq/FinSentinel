import { tool } from 'ai';
import { z } from 'zod';

// TODO: wire when service exists
interface TwitterServiceStub {
  getTwitterProfile(username: string): Promise<string>;
  searchTweets(
    keywords: string,
    fromUser?: string,
    hashtag?: string,
    minLikes?: number,
    limit?: number,
  ): Promise<string>;
  getUserTweets(username: string, limit: number): Promise<string>;
  getKolFollowers(username: string): Promise<string>;
}

/**
 * Twitter/X social intelligence tools via 6551 API.
 *
 * Gated by APP_TWITTER_6551_ENABLED=true.
 *
 * Maps to Java TwitterTool (4 methods).
 */
export function createTwitterTools(service: TwitterServiceStub) {
  return {
    getTwitterProfile: tool({
      description:
        'Get a Twitter/X user profile including follower count, bio, verification status, ' +
        'and account metrics. Use this to assess the credibility and influence of a financial commentator ' +
        'or company account before analyzing their tweets.',
      inputSchema: z.object({
        username: z
          .string()
          .describe(
            "Twitter username, e.g. 'elonmusk' (with or without @ prefix)",
          ),
      }),
      execute: async ({ username }) => {
        try {
          return await service.getTwitterProfile(
            username.replace(/^@/, ''),
          );
        } catch (e) {
          return `Error fetching Twitter profile for @${username}: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    searchTweets: tool({
      description:
        'Search Twitter/X for tweets matching keywords, a specific user, hashtag, or minimum likes. ' +
        'Returns tweet text, engagement metrics, and author info. ' +
        'Use this to gauge social sentiment around a stock, crypto, or financial event.',
      inputSchema: z.object({
        keywords: z
          .string()
          .describe(
            "Search keywords, e.g. '$AAPL earnings' or 'bitcoin ETF'",
          ),
        fromUser: z
          .string()
          .optional()
          .describe(
            'Filter by author username (without @), or omit for all users',
          ),
        hashtag: z
          .string()
          .optional()
          .describe('Filter by hashtag (without #), or omit for any'),
        minLikes: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe(
            'Minimum number of likes to filter low-engagement tweets (0 for no filter)',
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(20)
          .describe('Number of tweets to return (1-20)'),
      }),
      execute: async ({ keywords, fromUser, hashtag, minLikes, limit }) => {
        try {
          return await service.searchTweets(
            keywords,
            fromUser,
            hashtag,
            minLikes ?? 0,
            limit,
          );
        } catch (e) {
          return `Error searching tweets: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    getUserTweets: tool({
      description:
        'Get recent tweets from a specific Twitter/X user. ' +
        'Returns their latest posts with engagement metrics. ' +
        'Use this to monitor what a financial influencer, analyst, or company is saying.',
      inputSchema: z.object({
        username: z
          .string()
          .describe(
            "Twitter username, e.g. 'jimcramer' (with or without @ prefix)",
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(20)
          .describe('Number of tweets to return (1-20)'),
      }),
      execute: async ({ username, limit }) => {
        try {
          return await service.getUserTweets(
            username.replace(/^@/, ''),
            limit,
          );
        } catch (e) {
          return `Error fetching tweets for @${username}: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),

    getKolFollowers: tool({
      description:
        'Get KOL (Key Opinion Leader) followers for a Twitter/X user. ' +
        'Shows which notable/verified accounts follow this user. ' +
        'Use this to assess the social credibility and network of a financial influencer.',
      inputSchema: z.object({
        username: z
          .string()
          .describe(
            "Twitter username, e.g. 'CathieDWood' (with or without @ prefix)",
          ),
      }),
      execute: async ({ username }) => {
        try {
          return await service.getKolFollowers(
            username.replace(/^@/, ''),
          );
        } catch (e) {
          return `Error fetching KOL followers for @${username}: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      },
    }),
  };
}
