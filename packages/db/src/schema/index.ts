// Table definitions
export { users } from './users';
export { portfolios } from './portfolios';
export { holdings } from './holdings';
export { documents } from './documents';
export { documentChunks } from './document-chunks';
export { riskReports } from './risk-reports';
export { chatMessages } from './chat-messages';
export { newsItems } from './news-items';
export { tradeWallets } from './trade-wallets';
export { userInvestmentProfiles } from './user-investment-profiles';
export { agentBrains } from './agent-brains';
export { agentEvents } from './agent-events';
export { agentSchedules } from './agent-schedules';
export { agentHeartbeatConfigs } from './agent-heartbeat-configs';
export { chatSessionMemories } from './chat-session-memories';
export { apiKeys } from './api-keys';
export { knowledgeEntities } from './knowledge-entities';
export { knowledgeRelations, RELATION_TYPES } from './knowledge-relations';
export type { RelationType } from './knowledge-relations';
export { chunkEntityLinks } from './chunk-entity-links';
export { watchlistCategories } from './watchlist-categories';
export { watchlistItems } from './watchlist-items';
export { analysisRuns } from './analysis-runs';
export { analysisStages } from './analysis-stages';
export { analysisArtifacts } from './analysis-artifacts';
export { analysisApprovals } from './analysis-approvals';

// Relations
export {
  usersRelations,
  portfoliosRelations,
  holdingsRelations,
  documentsRelations,
  riskReportsRelations,
  tradeWalletsRelations,
  userInvestmentProfilesRelations,
  agentBrainsRelations,
  agentEventsRelations,
  agentSchedulesRelations,
  agentHeartbeatConfigsRelations,
  chatSessionMemoriesRelations,
  apiKeysRelations,
  watchlistCategoriesRelations,
  watchlistItemsRelations,
  analysisRunsRelations,
  analysisStagesRelations,
  analysisArtifactsRelations,
  analysisApprovalsRelations,
} from './relations';
