import { describe, it, expect } from 'vitest';
import { RolloutGateService } from '../rollout-gate.service';

describe('RolloutGateService.decide', () => {
  const config = {
    percentByClass: {
      exact_lookup: 100,
      factoid: 10,
      relational: 10,
      analytical: 10,
      multi_part: 10,
    },
    anonMultiplier: 0.5,
  };

  it('always returns multi_stage for exact_lookup at 100%', () => {
    const gate = new RolloutGateService(config);
    for (let i = 0; i < 20; i++) {
      const { pipeline } = gate.decide('exact_lookup', { userId: `u${i}` });
      expect(pipeline).toBe('multi_stage');
    }
  });

  it('is deterministic per stickiness key within the 30-min bucket', () => {
    const gate = new RolloutGateService(config);
    const a = gate.decide('factoid', { userId: 'fixed-user' }).pipeline;
    const b = gate.decide('factoid', { userId: 'fixed-user' }).pipeline;
    expect(a).toBe(b);
  });

  it('applies anonMultiplier — anon canary hits ~50% of the user rate', () => {
    const gate = new RolloutGateService({
      ...config,
      percentByClass: { ...config.percentByClass, analytical: 40 },
    });
    let multi = 0;
    const total = 10_000;
    for (let i = 0; i < total; i++) {
      if (
        gate.decide('analytical', { ipAddress: `10.0.${(i >> 8) & 0xff}.${i & 0xff}` }).pipeline ===
        'multi_stage'
      ) {
        multi++;
      }
    }
    // expect ~20% (40% base * 0.5 anon); wide band for sha256 variance on only 10k samples
    expect(multi / total).toBeGreaterThan(0.15);
    expect(multi / total).toBeLessThan(0.25);
  });

  it('records stickinessSource correctly for each input tier', () => {
    const gate = new RolloutGateService(config);
    expect(gate.decide('factoid', { userId: 'u1' }).stickinessSource).toBe('user_id');
    expect(gate.decide('factoid', { sessionId: 's1' }).stickinessSource).toBe('session_id');
    expect(gate.decide('factoid', { ipAddress: '1.2.3.4' }).stickinessSource).toBe('ip');
    expect(gate.decide('factoid', { requestId: 'r1' }).stickinessSource).toBe('request_id');
  });

  it('records auth=user only when userId is present', () => {
    const gate = new RolloutGateService(config);
    expect(gate.decide('factoid', { userId: 'u1' }).auth).toBe('user');
    expect(gate.decide('factoid', { sessionId: 's1' }).auth).toBe('anon');
    expect(gate.decide('factoid', { ipAddress: '1.2.3.4' }).auth).toBe('anon');
  });
});
