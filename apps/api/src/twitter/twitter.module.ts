import { Module } from '@nestjs/common';
import { TwitterDataService } from './twitter-data.service';

/**
 * Twitter module -- 6551.io Twitter data integration.
 *
 * Conditionally imported when `APP_TWITTER_6551_ENABLED=true`.
 * Provides TwitterDataService for querying Twitter user profiles,
 * tweets, and follower data via the 6551 REST API.
 */
@Module({
  providers: [TwitterDataService],
  exports: [TwitterDataService],
})
export class TwitterModule {}
