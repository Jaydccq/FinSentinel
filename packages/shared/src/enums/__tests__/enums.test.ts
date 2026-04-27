import { describe, it, expect } from 'vitest';
import {
  TradingMode,
  DocumentType,
  DocumentStatus,
  NewsSource,
  RiskLevel,
  RiskCategory,
  StorageTier,
  AgentEventType,
  AgentEventAggregateType,
  AgentScheduleTaskType,
} from '../index';

describe('TradingMode', () => {
  it('has exactly 2 values', () => {
    expect(Object.values(TradingMode)).toHaveLength(2);
  });
  it('contains PAPER and LIVE', () => {
    expect(TradingMode.PAPER).toBe('PAPER');
    expect(TradingMode.LIVE).toBe('LIVE');
  });
});

describe('DocumentType', () => {
  it('has exactly 5 values', () => {
    expect(Object.values(DocumentType)).toHaveLength(5);
  });
  it('contains all document types', () => {
    expect(DocumentType.REGULATION).toBe('REGULATION');
    expect(DocumentType.RESEARCH_REPORT).toBe('RESEARCH_REPORT');
    expect(DocumentType.NEWS).toBe('NEWS');
    expect(DocumentType.SEC_FILING).toBe('SEC_FILING');
    expect(DocumentType.OTHER).toBe('OTHER');
  });
});

describe('DocumentStatus', () => {
  it('has exactly 5 values', () => {
    expect(Object.values(DocumentStatus)).toHaveLength(5);
  });
  it('contains all statuses', () => {
    expect(DocumentStatus.PENDING_UPLOAD).toBe('PENDING_UPLOAD');
    expect(DocumentStatus.PENDING).toBe('PENDING');
    expect(DocumentStatus.PROCESSING).toBe('PROCESSING');
    expect(DocumentStatus.COMPLETED).toBe('COMPLETED');
    expect(DocumentStatus.FAILED).toBe('FAILED');
  });
});

describe('NewsSource', () => {
  it('has exactly 10 values', () => {
    expect(Object.values(NewsSource)).toHaveLength(10);
  });
  it('contains key news sources', () => {
    expect(NewsSource.POLYGON).toBe('POLYGON');
    expect(NewsSource.RSS_CNBC).toBe('RSS_CNBC');
    expect(NewsSource.RSS_YAHOO).toBe('RSS_YAHOO');
    expect(NewsSource.RSS_BBC).toBe('RSS_BBC');
    expect(NewsSource.RSS_GUARDIAN).toBe('RSS_GUARDIAN');
    expect(NewsSource.RSS_NPR).toBe('RSS_NPR');
    expect(NewsSource.RSS_REUTERS_PROXY).toBe('RSS_REUTERS_PROXY');
    expect(NewsSource.X_INFLUENCER).toBe('X_INFLUENCER');
    expect(NewsSource.RSS_SIGNALHUB).toBe('RSS_SIGNALHUB');
    expect(NewsSource.CRYPTO_6551).toBe('CRYPTO_6551');
  });
});

describe('RiskLevel', () => {
  it('has exactly 4 values', () => {
    expect(Object.values(RiskLevel)).toHaveLength(4);
  });
  it('contains all risk levels', () => {
    expect(RiskLevel.LOW).toBe('LOW');
    expect(RiskLevel.MEDIUM).toBe('MEDIUM');
    expect(RiskLevel.HIGH).toBe('HIGH');
    expect(RiskLevel.CRITICAL).toBe('CRITICAL');
  });
});

describe('RiskCategory', () => {
  it('has exactly 5 values', () => {
    expect(Object.values(RiskCategory)).toHaveLength(5);
  });
  it('contains all risk categories', () => {
    expect(RiskCategory.MARKET).toBe('MARKET');
    expect(RiskCategory.LIQUIDITY).toBe('LIQUIDITY');
    expect(RiskCategory.POLICY).toBe('POLICY');
    expect(RiskCategory.CONCENTRATION).toBe('CONCENTRATION');
    expect(RiskCategory.VOLATILITY).toBe('VOLATILITY');
  });
});

describe('StorageTier', () => {
  it('has exactly 3 values', () => {
    expect(Object.values(StorageTier)).toHaveLength(3);
  });
  it('contains all storage tiers', () => {
    expect(StorageTier.HOT).toBe('HOT');
    expect(StorageTier.COLD).toBe('COLD');
    expect(StorageTier.DELETED).toBe('DELETED');
  });
});

describe('AgentEventType', () => {
  it('has exactly 53 values', () => {
    expect(Object.values(AgentEventType)).toHaveLength(53);
  });
  it('contains chat event types', () => {
    expect(AgentEventType.CHAT_SESSION_STARTED).toBe('CHAT_SESSION_STARTED');
    expect(AgentEventType.CHAT_MESSAGE_PERSISTED).toBe('CHAT_MESSAGE_PERSISTED');
    expect(AgentEventType.CHAT_CONTEXT_COMPACTED).toBe('CHAT_CONTEXT_COMPACTED');
    expect(AgentEventType.CHAT_STREAM_ERROR).toBe('CHAT_STREAM_ERROR');
  });
  it('contains trading event types', () => {
    expect(AgentEventType.TRADING_MODE_SWITCHED).toBe('TRADING_MODE_SWITCHED');
    expect(AgentEventType.TRADE_OPERATION_STAGED).toBe('TRADE_OPERATION_STAGED');
    expect(AgentEventType.TRADE_COMMIT_CREATED).toBe('TRADE_COMMIT_CREATED');
    expect(AgentEventType.TRADE_COMMIT_EXECUTED).toBe('TRADE_COMMIT_EXECUTED');
  });
  it('contains brain event types', () => {
    expect(AgentEventType.BRAIN_STRATEGY_UPDATED).toBe('BRAIN_STRATEGY_UPDATED');
    expect(AgentEventType.BRAIN_EMOTION_UPDATED).toBe('BRAIN_EMOTION_UPDATED');
  });
  it('contains schedule event types', () => {
    expect(AgentEventType.SCHEDULE_CREATED).toBe('SCHEDULE_CREATED');
    expect(AgentEventType.SCHEDULE_UPDATED).toBe('SCHEDULE_UPDATED');
    expect(AgentEventType.SCHEDULE_DELETED).toBe('SCHEDULE_DELETED');
    expect(AgentEventType.SCHEDULE_EXECUTED).toBe('SCHEDULE_EXECUTED');
    expect(AgentEventType.SCHEDULE_FAILED).toBe('SCHEDULE_FAILED');
  });
  it('contains heartbeat event types', () => {
    expect(AgentEventType.HEARTBEAT_TICK).toBe('HEARTBEAT_TICK');
    expect(AgentEventType.HEARTBEAT_ALERT).toBe('HEARTBEAT_ALERT');
  });
  it('contains OKX event types', () => {
    expect(AgentEventType.OKX_POSITION_OPENED).toBe('OKX_POSITION_OPENED');
    expect(AgentEventType.OKX_POSITION_CLOSED).toBe('OKX_POSITION_CLOSED');
    expect(AgentEventType.OKX_RISK_ALERT).toBe('OKX_RISK_ALERT');
    expect(AgentEventType.OKX_HEALTH_CHECK_RUN).toBe('OKX_HEALTH_CHECK_RUN');
  });
  it('contains order ledger operator event types', () => {
    expect(AgentEventType.LEDGER_UNKNOWN_ACKNOWLEDGED).toBe('LEDGER_UNKNOWN_ACKNOWLEDGED');
  });
});

describe('AgentEventAggregateType', () => {
  it('has exactly 9 values', () => {
    expect(Object.values(AgentEventAggregateType)).toHaveLength(9);
  });
  it('contains all aggregate types', () => {
    expect(AgentEventAggregateType.CHAT_SESSION).toBe('CHAT_SESSION');
    expect(AgentEventAggregateType.TRADE_WALLET).toBe('TRADE_WALLET');
    expect(AgentEventAggregateType.AGENT_BRAIN).toBe('AGENT_BRAIN');
    expect(AgentEventAggregateType.USER_PROFILE).toBe('USER_PROFILE');
    expect(AgentEventAggregateType.SCHEDULE).toBe('SCHEDULE');
    expect(AgentEventAggregateType.HEARTBEAT).toBe('HEARTBEAT');
    expect(AgentEventAggregateType.SYSTEM).toBe('SYSTEM');
    expect(AgentEventAggregateType.ANALYSIS_RUN).toBe('ANALYSIS_RUN');
    expect(AgentEventAggregateType.ANALYSIS_APPROVAL).toBe('ANALYSIS_APPROVAL');
  });
});

describe('AgentScheduleTaskType', () => {
  it('has exactly 5 values', () => {
    expect(Object.values(AgentScheduleTaskType)).toHaveLength(5);
  });
  it('contains all task types', () => {
    expect(AgentScheduleTaskType.PORTFOLIO_REVIEW).toBe('PORTFOLIO_REVIEW');
    expect(AgentScheduleTaskType.MARKET_PULSE).toBe('MARKET_PULSE');
    expect(AgentScheduleTaskType.BRAIN_REVIEW).toBe('BRAIN_REVIEW');
    expect(AgentScheduleTaskType.HEARTBEAT_WAKEUP).toBe('HEARTBEAT_WAKEUP');
    expect(AgentScheduleTaskType.CRYPTO_HEALTH_CHECK).toBe('CRYPTO_HEALTH_CHECK');
  });
});
