/**
 * BullMQ queue name constants.
 *
 * Use BullMQ-safe names without ":" because BullMQ reserves colon-delimited keys
 * for its own Redis metadata.
 */
export const VECTORIZE_QUEUE = 'finsentinel-vectorize';
export const NEWS_ENRICH_QUEUE = 'finsentinel-news-enrich';

export const GRAPH_ENRICH_QUEUE = 'finsentinel-graph-enrich';

/** Injection tokens for BullMQ Queue instances. */
export const VECTORIZE_QUEUE_TOKEN = 'VECTORIZE_QUEUE';
export const NEWS_ENRICH_QUEUE_TOKEN = 'NEWS_ENRICH_QUEUE';
export const GRAPH_ENRICH_QUEUE_TOKEN = 'GRAPH_ENRICH_QUEUE';

export const ANALYSIS_RUN_QUEUE = 'finsentinel-analysis-run';
export const ANALYSIS_RUN_QUEUE_TOKEN = 'ANALYSIS_RUN_QUEUE';

export const REPRESENTATION_ENRICH_QUEUE = 'finsentinel-representation-enrich';
export const REPRESENTATION_ENRICH_QUEUE_TOKEN = 'REPRESENTATION_ENRICH_QUEUE';
