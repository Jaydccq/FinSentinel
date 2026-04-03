import { describe, it, expect } from 'vitest';
import { MetricsService } from '../metrics.service';

describe('MetricsService', () => {
  it('renders counters and gauges in Prometheus text format', () => {
    const service = new MetricsService();

    service.incrementCounter(
      'rag_jobs_enqueued_total',
      'Total number of RAG-related jobs enqueued',
      { job_type: 'vectorize' },
      2,
    );
    service.incrementCounter(
      'rag_jobs_enqueued_total',
      'Total number of RAG-related jobs enqueued',
      { job_type: 'vectorize' },
      3,
    );
    service.setGauge(
      'rag_backfill_running',
      'Whether the automatic RAG backfill loop is currently running',
      {},
      1,
    );

    const output = service.renderPrometheus();

    expect(output).toContain('# TYPE rag_jobs_enqueued_total counter');
    expect(output).toContain(
      'rag_jobs_enqueued_total{job_type="vectorize"} 5',
    );
    expect(output).toContain('rag_backfill_running 1');
  });
});
