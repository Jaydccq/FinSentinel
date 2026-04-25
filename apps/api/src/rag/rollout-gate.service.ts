import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { QueryClass } from './retrieval-planner.service';

export interface RolloutGateConfig {
  percentByClass: Partial<Record<QueryClass, number>>;
  anonMultiplier: number;
}

export interface StickinessInput {
  userId?: string | null;
  sessionId?: string | null;
  ipAddress?: string | null;
  requestId?: string | null;
}

export type StickinessSource = 'user_id' | 'session_id' | 'ip' | 'request_id';

export interface RolloutDecision {
  pipeline: 'multi_stage' | 'single_stage';
  stickinessSource: StickinessSource;
  auth: 'user' | 'anon';
  effectivePercent: number;
}

@Injectable()
export class RolloutGateService {
  constructor(private readonly config: RolloutGateConfig) {}

  decide(queryClass: QueryClass, stickiness: StickinessInput): RolloutDecision {
    const hourFloor = Math.floor(Date.now() / (30 * 60 * 1000));
    let stickinessKey: string;
    let source: StickinessSource;
    let auth: 'user' | 'anon' = 'anon';

    if (stickiness.userId) {
      stickinessKey = stickiness.userId;
      source = 'user_id';
      auth = 'user';
    } else if (stickiness.sessionId) {
      stickinessKey = stickiness.sessionId;
      source = 'session_id';
    } else if (stickiness.ipAddress) {
      stickinessKey = stickiness.ipAddress;
      source = 'ip';
    } else {
      stickinessKey = stickiness.requestId ?? String(Math.random());
      source = 'request_id';
    }

    const hash = createHash('sha256')
      .update(`${stickinessKey}:${hourFloor}:${queryClass}`)
      .digest();
    const bucket = (hash.readUInt32BE(0) % 10_000) / 100; // 0..99.99

    const basePercent = this.config.percentByClass[queryClass] ?? 0;
    const effectivePercent =
      auth === 'anon' ? basePercent * this.config.anonMultiplier : basePercent;
    const pipeline: 'multi_stage' | 'single_stage' =
      bucket < effectivePercent ? 'multi_stage' : 'single_stage';

    return { pipeline, stickinessSource: source, auth, effectivePercent };
  }
}
