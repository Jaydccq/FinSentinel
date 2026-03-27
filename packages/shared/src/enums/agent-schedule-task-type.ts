export const AgentScheduleTaskType = {
  PORTFOLIO_REVIEW: 'PORTFOLIO_REVIEW',
  MARKET_PULSE: 'MARKET_PULSE',
  BRAIN_REVIEW: 'BRAIN_REVIEW',
  HEARTBEAT_WAKEUP: 'HEARTBEAT_WAKEUP',
  CRYPTO_HEALTH_CHECK: 'CRYPTO_HEALTH_CHECK',
} as const;

export type AgentScheduleTaskType = (typeof AgentScheduleTaskType)[keyof typeof AgentScheduleTaskType];
