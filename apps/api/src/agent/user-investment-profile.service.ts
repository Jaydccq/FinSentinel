import { Inject, Injectable } from '@nestjs/common';
import { userInvestmentProfiles, eq } from '@finsentinel/db';
import type { DrizzleDB } from '@finsentinel/db';

interface UserInvestmentProfileRow {
  id: string;
  userId: string;
  workingMemory: string | null;
  riskTolerance: string | null;
  investmentHorizon: string | null;
  currentSentiment: string | null;
  sentimentReason: string | null;
  preferences: Record<string, unknown> | null;
  stateHistory: unknown[];
  createdAt: Date;
  updatedAt: Date;
}

interface ProfileHistoryEntry {
  timestamp: string;
  type: 'sentiment' | 'memory' | 'preferences';
  value: unknown;
  reason?: string;
}

@Injectable()
export class UserInvestmentProfileService {
  constructor(@Inject('DRIZZLE_DB') private readonly db: DrizzleDB) {}

  async getProfileSummary(userId: string): Promise<string> {
    const profile = await this.getOrCreateProfile(userId);
    return [
      `Risk tolerance: ${profile.riskTolerance ?? 'UNKNOWN'}`,
      `Investment horizon: ${profile.investmentHorizon ?? 'UNKNOWN'}`,
      `Current sentiment: ${profile.currentSentiment ?? 'NEUTRAL'}`,
      `Sentiment reason: ${profile.sentimentReason ?? 'None recorded'}`,
      `Working memory: ${profile.workingMemory ?? 'No active focus recorded'}`,
      `Preferences: ${JSON.stringify(profile.preferences ?? {}, null, 2)}`,
    ].join('\n');
  }

  async updateSentiment(userId: string, sentiment: string, reason: string): Promise<string> {
    const profile = await this.getOrCreateProfile(userId);
    const stateHistory = this.prependHistory(profile.stateHistory, {
      timestamp: new Date().toISOString(),
      type: 'sentiment',
      value: sentiment,
      reason,
    });

    await this.db
      .update(userInvestmentProfiles)
      .set({
        currentSentiment: sentiment,
        sentimentReason: reason,
        stateHistory,
        updatedAt: new Date(),
      })
      .where(eq(userInvestmentProfiles.userId, userId));

    return `User sentiment updated to ${sentiment}.`;
  }

  async updateWorkingMemory(userId: string, memory: string): Promise<string> {
    const profile = await this.getOrCreateProfile(userId);
    const stateHistory = this.prependHistory(profile.stateHistory, {
      timestamp: new Date().toISOString(),
      type: 'memory',
      value: memory,
    });

    await this.db
      .update(userInvestmentProfiles)
      .set({
        workingMemory: memory,
        stateHistory,
        updatedAt: new Date(),
      })
      .where(eq(userInvestmentProfiles.userId, userId));

    return 'Working memory updated successfully.';
  }

  async updatePreferences(userId: string, preferencesJson: string): Promise<string> {
    const profile = await this.getOrCreateProfile(userId);
    const preferences = JSON.parse(preferencesJson) as Record<string, unknown>;
    const stateHistory = this.prependHistory(profile.stateHistory, {
      timestamp: new Date().toISOString(),
      type: 'preferences',
      value: preferences,
    });

    await this.db
      .update(userInvestmentProfiles)
      .set({
        preferences,
        stateHistory,
        updatedAt: new Date(),
      })
      .where(eq(userInvestmentProfiles.userId, userId));

    return 'User preferences updated successfully.';
  }

  private async getOrCreateProfile(userId: string): Promise<UserInvestmentProfileRow> {
    const [existing] = await this.db
      .select()
      .from(userInvestmentProfiles)
      .where(eq(userInvestmentProfiles.userId, userId))
      .limit(1);

    if (existing) {
      return existing as UserInvestmentProfileRow;
    }

    const [created] = await this.db
      .insert(userInvestmentProfiles)
      .values({
        userId,
        currentSentiment: 'NEUTRAL',
        preferences: {},
        stateHistory: [],
      })
      .returning();

    return created as UserInvestmentProfileRow;
  }

  private prependHistory(history: unknown[], entry: ProfileHistoryEntry): ProfileHistoryEntry[] {
    return [entry, ...this.asHistory(history)].slice(0, 100);
  }

  private asHistory(history: unknown[]): ProfileHistoryEntry[] {
    return Array.isArray(history) ? (history as ProfileHistoryEntry[]) : [];
  }
}
