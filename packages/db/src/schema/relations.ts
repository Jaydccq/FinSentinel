import { relations } from 'drizzle-orm';
import { users } from './users';
import { portfolios } from './portfolios';
import { holdings } from './holdings';
import { documents } from './documents';
import { riskReports } from './risk-reports';
import { chatMessages } from './chat-messages';
import { newsItems } from './news-items';
import { tradeWallets } from './trade-wallets';
import { userInvestmentProfiles } from './user-investment-profiles';
import { agentBrains } from './agent-brains';
import { agentEvents } from './agent-events';
import { agentSchedules } from './agent-schedules';
import { agentHeartbeatConfigs } from './agent-heartbeat-configs';
import { chatSessionMemories } from './chat-session-memories';
import { apiKeys } from './api-keys';
import { watchlistCategories } from './watchlist-categories';
import { watchlistItems } from './watchlist-items';
import { analysisRuns } from './analysis-runs';
import { analysisStages } from './analysis-stages';
import { analysisArtifacts } from './analysis-artifacts';
import { analysisApprovals } from './analysis-approvals';
import { contextJournalEntries } from './context-journal-entries';
import { executionReviewLedgers } from './execution-review-ledgers';

// ── users ───────────────────────────────────────────────────────────────────
export const usersRelations = relations(users, ({ many, one }) => ({
  portfolios: many(portfolios),
  documents: many(documents),
  tradeWallet: one(tradeWallets),
  investmentProfile: one(userInvestmentProfiles),
  agentBrain: one(agentBrains),
  agentEvents: many(agentEvents),
  agentSchedules: many(agentSchedules),
  heartbeatConfig: one(agentHeartbeatConfigs),
  chatSessionMemories: many(chatSessionMemories),
  apiKeys: many(apiKeys),
  watchlistCategories: many(watchlistCategories),
  watchlistItems: many(watchlistItems),
  analysisRuns: many(analysisRuns),
  contextJournalEntries: many(contextJournalEntries),
}));

// ── portfolios ──────────────────────────────────────────────────────────────
export const portfoliosRelations = relations(portfolios, ({ one, many }) => ({
  user: one(users, { fields: [portfolios.userId], references: [users.id] }),
  holdings: many(holdings),
  riskReports: many(riskReports),
}));

// ── holdings ────────────────────────────────────────────────────────────────
export const holdingsRelations = relations(holdings, ({ one }) => ({
  portfolio: one(portfolios, { fields: [holdings.portfolioId], references: [portfolios.id] }),
}));

// ── documents ───────────────────────────────────────────────────────────────
export const documentsRelations = relations(documents, ({ one }) => ({
  user: one(users, { fields: [documents.userId], references: [users.id] }),
}));

// ── risk_reports ────────────────────────────────────────────────────────────
export const riskReportsRelations = relations(riskReports, ({ one }) => ({
  portfolio: one(portfolios, { fields: [riskReports.portfolioId], references: [portfolios.id] }),
}));

// ── chat_messages ───────────────────────────────────────────────────────────
// chat_messages.user_id has no FK in SQL, so no relation defined.

// ── news_items ──────────────────────────────────────────────────────────────
// news_items has no FK constraints, so no relations defined.

// ── trade_wallets ───────────────────────────────────────────────────────────
export const tradeWalletsRelations = relations(tradeWallets, ({ one }) => ({
  user: one(users, { fields: [tradeWallets.userId], references: [users.id] }),
}));

// ── user_investment_profiles ────────────────────────────────────────────────
export const userInvestmentProfilesRelations = relations(userInvestmentProfiles, ({ one }) => ({
  user: one(users, { fields: [userInvestmentProfiles.userId], references: [users.id] }),
}));

// ── agent_brains ────────────────────────────────────────────────────────────
export const agentBrainsRelations = relations(agentBrains, ({ one }) => ({
  user: one(users, { fields: [agentBrains.userId], references: [users.id] }),
}));

// ── agent_events ────────────────────────────────────────────────────────────
export const agentEventsRelations = relations(agentEvents, ({ one }) => ({
  user: one(users, { fields: [agentEvents.userId], references: [users.id] }),
}));

// ── agent_schedules ─────────────────────────────────────────────────────────
export const agentSchedulesRelations = relations(agentSchedules, ({ one }) => ({
  user: one(users, { fields: [agentSchedules.userId], references: [users.id] }),
}));

// ── agent_heartbeat_configs ─────────────────────────────────────────────────
export const agentHeartbeatConfigsRelations = relations(agentHeartbeatConfigs, ({ one }) => ({
  user: one(users, { fields: [agentHeartbeatConfigs.userId], references: [users.id] }),
}));

// ── chat_session_memories ───────────────────────────────────────────────────
export const chatSessionMemoriesRelations = relations(chatSessionMemories, ({ one }) => ({
  user: one(users, { fields: [chatSessionMemories.userId], references: [users.id] }),
}));

// ── api_keys ────────────────────────────────────────────────────────────────
export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  user: one(users, { fields: [apiKeys.userId], references: [users.id] }),
}));

// ── watchlist_categories ───────────────────────────────────────────────────
export const watchlistCategoriesRelations = relations(watchlistCategories, ({ one, many }) => ({
  user: one(users, { fields: [watchlistCategories.userId], references: [users.id] }),
  items: many(watchlistItems),
}));

// ── watchlist_items ────────────────────────────────────────────────────────
export const watchlistItemsRelations = relations(watchlistItems, ({ one }) => ({
  user: one(users, { fields: [watchlistItems.userId], references: [users.id] }),
  category: one(watchlistCategories, {
    fields: [watchlistItems.categoryId],
    references: [watchlistCategories.id],
  }),
}));

// ── analysis_runs ──────────────────────────────────────────────────────────
export const analysisRunsRelations = relations(analysisRuns, ({ one, many }) => ({
  user: one(users, { fields: [analysisRuns.userId], references: [users.id] }),
  stages: many(analysisStages),
  artifacts: many(analysisArtifacts),
  approvals: many(analysisApprovals),
  contextJournalEntries: many(contextJournalEntries),
  executionReviewLedgers: many(executionReviewLedgers),
}));

// ── analysis_stages ────────────────────────────────────────────────────────
export const analysisStagesRelations = relations(analysisStages, ({ one, many }) => ({
  run: one(analysisRuns, {
    fields: [analysisStages.runId],
    references: [analysisRuns.id],
  }),
  artifacts: many(analysisArtifacts),
}));

// ── analysis_artifacts ─────────────────────────────────────────────────────
export const analysisArtifactsRelations = relations(analysisArtifacts, ({ one }) => ({
  run: one(analysisRuns, {
    fields: [analysisArtifacts.runId],
    references: [analysisRuns.id],
  }),
  stage: one(analysisStages, {
    fields: [analysisArtifacts.stageId],
    references: [analysisStages.id],
  }),
}));

// ── analysis_approvals ─────────────────────────────────────────────────────
export const analysisApprovalsRelations = relations(analysisApprovals, ({ one, many }) => ({
  run: one(analysisRuns, {
    fields: [analysisApprovals.runId],
    references: [analysisRuns.id],
  }),
  resolvedBy: one(users, {
    fields: [analysisApprovals.resolvedByUserId],
    references: [users.id],
  }),
  executionReviewLedgers: many(executionReviewLedgers),
}));

// ── context_journal_entries ────────────────────────────────────────────────
export const contextJournalEntriesRelations = relations(contextJournalEntries, ({ one }) => ({
  user: one(users, { fields: [contextJournalEntries.userId], references: [users.id] }),
  run: one(analysisRuns, { fields: [contextJournalEntries.runId], references: [analysisRuns.id] }),
}));

// ── execution_review_ledgers ───────────────────────────────────────────────
export const executionReviewLedgersRelations = relations(executionReviewLedgers, ({ one }) => ({
  run: one(analysisRuns, {
    fields: [executionReviewLedgers.runId],
    references: [analysisRuns.id],
  }),
  approval: one(analysisApprovals, {
    fields: [executionReviewLedgers.approvalId],
    references: [analysisApprovals.id],
  }),
}));
