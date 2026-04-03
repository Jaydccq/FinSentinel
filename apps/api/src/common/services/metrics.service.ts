import { Injectable } from '@nestjs/common';

type MetricType = 'counter' | 'gauge';
type MetricLabels = Record<string, string>;

interface MetricDefinition {
  help: string;
  type: MetricType;
  samples: Map<string, { labels: MetricLabels; value: number }>;
}

@Injectable()
export class MetricsService {
  private readonly metrics = new Map<string, MetricDefinition>();

  incrementCounter(
    name: string,
    help: string,
    labels: Record<string, string | number | boolean> = {},
    value = 1,
  ): void {
    this.ensureMetric(name, help, 'counter');
    const normalizedLabels = this.normalizeLabels(labels);
    const key = this.serializeLabels(normalizedLabels);
    const metric = this.metrics.get(name)!;
    const existing = metric.samples.get(key);

    if (existing) {
      existing.value += value;
      return;
    }

    metric.samples.set(key, { labels: normalizedLabels, value });
  }

  setGauge(
    name: string,
    help: string,
    labels: Record<string, string | number | boolean> = {},
    value: number,
  ): void {
    this.ensureMetric(name, help, 'gauge');
    const normalizedLabels = this.normalizeLabels(labels);
    const key = this.serializeLabels(normalizedLabels);
    const metric = this.metrics.get(name)!;
    metric.samples.set(key, { labels: normalizedLabels, value });
  }

  renderPrometheus(): string {
    const lines: string[] = [];

    for (const [name, metric] of [...this.metrics.entries()].sort((left, right) =>
      left[0].localeCompare(right[0]),
    )) {
      lines.push(`# HELP ${name} ${metric.help}`);
      lines.push(`# TYPE ${name} ${metric.type}`);

      const samples = [...metric.samples.values()].sort((left, right) =>
        this.serializeLabels(left.labels).localeCompare(
          this.serializeLabels(right.labels),
        ),
      );

      for (const sample of samples) {
        lines.push(
          `${name}${this.formatLabels(sample.labels)} ${sample.value}`,
        );
      }
    }

    return `${lines.join('\n')}\n`;
  }

  private ensureMetric(name: string, help: string, type: MetricType): void {
    const existing = this.metrics.get(name);
    if (existing) {
      if (existing.type !== type || existing.help !== help) {
        throw new Error(
          `Metric ${name} already registered with different definition`,
        );
      }
      return;
    }

    this.metrics.set(name, {
      help,
      type,
      samples: new Map(),
    });
  }

  private normalizeLabels(
    labels: Record<string, string | number | boolean>,
  ): MetricLabels {
    return Object.fromEntries(
      Object.entries(labels)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, String(value)]),
    );
  }

  private serializeLabels(labels: MetricLabels): string {
    return Object.entries(labels)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`)
      .join(',');
  }

  private formatLabels(labels: MetricLabels): string {
    const entries = Object.entries(labels).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    if (entries.length === 0) {
      return '';
    }

    const body = entries
      .map(([key, value]) => `${key}="${this.escapeLabelValue(value)}"`)
      .join(',');

    return `{${body}}`;
  }

  private escapeLabelValue(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  }
}
