import { Injectable, OnModuleInit } from '@nestjs/common';
import { Registry, Counter, Gauge, Histogram, collectDefaultMetrics } from 'prom-client';

/**
 * Prometheus-backed metrics service.
 *
 * Wraps prom-client with a thin API so callers don't import prom-client
 * directly. Exposes counters, gauges, and histograms. Default Node.js
 * process metrics (GC, event-loop lag, heap) are collected automatically.
 */
@Injectable()
export class MetricsService implements OnModuleInit {
  private readonly registry = new Registry();

  private readonly counters = new Map<string, Counter>();
  private readonly gauges = new Map<string, Gauge>();
  private readonly histograms = new Map<string, Histogram>();

  onModuleInit(): void {
    collectDefaultMetrics({ register: this.registry });
  }

  // ── Counters ──────────────────────────────────────────────────────────

  incrementCounter(
    name: string,
    help: string,
    labels: Record<string, string | number | boolean> = {},
    value = 1,
  ): void {
    const counter = this.getOrCreateCounter(name, help, labels);
    const normalised = this.normalizeLabels(labels);
    if (Object.keys(normalised).length > 0) {
      counter.inc(normalised, value);
    } else {
      counter.inc(value);
    }
  }

  // ── Gauges ────────────────────────────────────────────────────────────

  setGauge(
    name: string,
    help: string,
    labels: Record<string, string | number | boolean> = {},
    value: number,
  ): void {
    const gauge = this.getOrCreateGauge(name, help, labels);
    const normalised = this.normalizeLabels(labels);
    if (Object.keys(normalised).length > 0) {
      gauge.set(normalised, value);
    } else {
      gauge.set(value);
    }
  }

  // ── Histograms ────────────────────────────────────────────────────────

  observeHistogram(
    name: string,
    help: string,
    labels: Record<string, string | number | boolean> = {},
    value: number,
    buckets?: number[],
  ): void {
    const histogram = this.getOrCreateHistogram(name, help, labels, buckets);
    const normalised = this.normalizeLabels(labels);
    if (Object.keys(normalised).length > 0) {
      histogram.observe(normalised, value);
    } else {
      histogram.observe(value);
    }
  }

  /**
   * Start a timer that returns the elapsed seconds when called.
   * Usage:
   *   const end = metrics.startHistogramTimer('name', 'help', labels);
   *   // ... do work
   *   end(); // records duration
   */
  startHistogramTimer(
    name: string,
    help: string,
    labels: Record<string, string | number | boolean> = {},
    buckets?: number[],
  ): () => number {
    const histogram = this.getOrCreateHistogram(name, help, labels, buckets);
    const normalised = this.normalizeLabels(labels);
    if (Object.keys(normalised).length > 0) {
      return histogram.startTimer(normalised);
    }
    return histogram.startTimer();
  }

  // ── Prometheus scrape output ──────────────────────────────────────────

  async renderPrometheus(): Promise<string> {
    return this.registry.metrics();
  }

  // ── Private helpers ───────────────────────────────────────────────────

  private getOrCreateCounter(
    name: string,
    help: string,
    labels: Record<string, string | number | boolean>,
  ): Counter {
    let counter = this.counters.get(name);
    if (!counter) {
      counter = new Counter({
        name,
        help,
        labelNames: Object.keys(labels),
        registers: [this.registry],
      });
      this.counters.set(name, counter);
    }
    return counter;
  }

  private getOrCreateGauge(
    name: string,
    help: string,
    labels: Record<string, string | number | boolean>,
  ): Gauge {
    let gauge = this.gauges.get(name);
    if (!gauge) {
      gauge = new Gauge({
        name,
        help,
        labelNames: Object.keys(labels),
        registers: [this.registry],
      });
      this.gauges.set(name, gauge);
    }
    return gauge;
  }

  private getOrCreateHistogram(
    name: string,
    help: string,
    labels: Record<string, string | number | boolean>,
    buckets?: number[],
  ): Histogram {
    let histogram = this.histograms.get(name);
    if (!histogram) {
      histogram = new Histogram({
        name,
        help,
        labelNames: Object.keys(labels),
        buckets: buckets ?? [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
        registers: [this.registry],
      });
      this.histograms.set(name, histogram);
    }
    return histogram;
  }

  private normalizeLabels(
    labels: Record<string, string | number | boolean>,
  ): Record<string, string> {
    return Object.fromEntries(
      Object.entries(labels)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, String(value)]),
    );
  }
}
