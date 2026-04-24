import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WatchlistService } from './watchlist.service';
import { WatchlistController } from './watchlist.controller';

/**
 * Watchlist module — exposes /watchlist REST routes (controller) backed by
 * the existing WatchlistService. AuthModule is imported because the
 * controller is guarded by JwtGuard, which depends on JwtService.
 */
@Module({
  imports: [AuthModule],
  controllers: [WatchlistController],
  providers: [WatchlistService],
  exports: [WatchlistService],
})
export class WatchlistModule {}
