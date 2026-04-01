/**
 * BullMQ queue name constants.
 *
 * Prefixed with `finsentinel:` to namespace within shared Redis instances.
 */
export const VECTORIZE_QUEUE = 'finsentinel:vectorize';
export const NEWS_ENRICH_QUEUE = 'finsentinel:news-enrich';

/** Injection tokens for BullMQ Queue instances. */
export const VECTORIZE_QUEUE_TOKEN = 'VECTORIZE_QUEUE';
export const NEWS_ENRICH_QUEUE_TOKEN = 'NEWS_ENRICH_QUEUE';
