import { Inject, Injectable } from '@nestjs/common';
import { agentBrains, eq } from '@finsentinel/db';

interface BrainCommitEntry {
  timestamp: string;
  type: 'strategy' | 'emotion';
  content: string;
  reason?: string;
}

interface AgentBrainRow {
  id: string;
  userId: string;
  frontalLobe: string;
  emotion: string;
  commitHistory: unknown[];
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class AgentBrainService {
  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    @Inject('DRIZZLE_DB') private readonly db: any,
  ) {}

  async getFrontalLobe(userId: string): Promise<string> {
    const brain = await this.getOrCreateBrain(userId);
    return brain.frontalLobe || 'No saved trading strategy yet.';
  }

  async updateFrontalLobe(userId: string, content: string): Promise<string> {
    const brain = await this.getOrCreateBrain(userId);
    const history = this.prependHistory(brain.commitHistory, {
      timestamp: new Date().toISOString(),
      type: 'strategy',
      content,
    });

    await this.db
      .update(agentBrains)
      .set({
        frontalLobe: content,
        commitHistory: history,
        updatedAt: new Date(),
      })
      .where(eq(agentBrains.userId, userId));

    return 'Strategy updated successfully.';
  }

  async updateEmotion(
    userId: string,
    emotion: string,
    reason: string,
  ): Promise<string> {
    const brain = await this.getOrCreateBrain(userId);
    const history = this.prependHistory(brain.commitHistory, {
      timestamp: new Date().toISOString(),
      type: 'emotion',
      content: emotion,
      reason,
    });

    await this.db
      .update(agentBrains)
      .set({
        emotion,
        commitHistory: history,
        updatedAt: new Date(),
      })
      .where(eq(agentBrains.userId, userId));

    return `Emotion updated to ${emotion}.`;
  }

  async getEmotion(userId: string): Promise<string> {
    const brain = await this.getOrCreateBrain(userId);
    return `Current emotion: ${brain.emotion}`;
  }

  async getBrainLog(userId: string, limit: number): Promise<string> {
    const brain = await this.getOrCreateBrain(userId);
    const history = this.asHistory(brain.commitHistory).slice(0, limit);

    if (history.length === 0) {
      return 'No brain commits recorded yet.';
    }

    return JSON.stringify(history, null, 2);
  }

  private async getOrCreateBrain(userId: string): Promise<AgentBrainRow> {
    const [existing] = await this.db
      .select()
      .from(agentBrains)
      .where(eq(agentBrains.userId, userId))
      .limit(1);

    if (existing) {
      return existing as AgentBrainRow;
    }

    const [created] = await this.db
      .insert(agentBrains)
      .values({ userId })
      .returning();

    return created as AgentBrainRow;
  }

  private prependHistory(
    existing: unknown[],
    entry: BrainCommitEntry,
  ): BrainCommitEntry[] {
    return [entry, ...this.asHistory(existing)].slice(0, 100);
  }

  private asHistory(history: unknown[]): BrainCommitEntry[] {
    return Array.isArray(history) ? (history as BrainCommitEntry[]) : [];
  }
}
