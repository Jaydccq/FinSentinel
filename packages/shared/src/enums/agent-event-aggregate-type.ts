export const AgentEventAggregateType = {
  CHAT_SESSION: 'CHAT_SESSION',
  TRADE_WALLET: 'TRADE_WALLET',
  AGENT_BRAIN: 'AGENT_BRAIN',
  USER_PROFILE: 'USER_PROFILE',
  SCHEDULE: 'SCHEDULE',
  HEARTBEAT: 'HEARTBEAT',
  SYSTEM: 'SYSTEM',
} as const;

export type AgentEventAggregateType = (typeof AgentEventAggregateType)[keyof typeof AgentEventAggregateType];
