import { describe, it, expect, beforeEach } from 'vitest';
import { MetricsService } from '../metrics.service';

describe('MetricsService', () => {
  let service: MetricsService;

  beforeEach(() => {
    service = new MetricsService();
    // Skip collectDefaultMetrics in tests — we test our own metrics only
  });

  it('renders counters in Prometheus text format', async () => {
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

    const output = await service.renderPrometheus();

    expect(output).toContain('# TYPE rag_jobs_enqueued_total counter');
    expect(output).toContain('rag_jobs_enqueued_total{job_type="vectorize"} 5');
  });

  it('renders gauges in Prometheus text format', async () => {
    service.setGauge(
      'rag_backfill_running',
      'Whether the automatic RAG backfill loop is currently running',
      {},
      1,
    );

    const output = await service.renderPrometheus();
    expect(output).toContain('rag_backfill_running 1');
  });

  it('records histogram observations with buckets', async () => {
    service.observeHistogram(
      'test_duration_seconds',
      'Test duration',
      { status: 'success' },
      0.05,
    );
    service.observeHistogram(
      'test_duration_seconds',
      'Test duration',
      { status: 'success' },
      0.25,
    );

    const output = await service.renderPrometheus();

    expect(output).toContain('# TYPE test_duration_seconds histogram');
    expect(output).toContain('test_duration_seconds_bucket');
    expect(output).toContain('test_duration_seconds_sum');
    expect(output).toContain('test_duration_seconds_count{status="success"} 2');
  });

  it('startHistogramTimer records elapsed duration', async () => {
    const end = service.startHistogramTimer(
      'timer_test_seconds',
      'Timer test',
      {},
    );

    // Simulate small delay
    const elapsed = end();

    expect(elapsed).toBeGreaterThanOrEqual(0);

    const output = await service.renderPrometheus();
    expect(output).toContain('timer_test_seconds_count 1');
  });
});
