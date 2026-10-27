import { describe, it, expect } from 'vitest';
import { DPR_TIERS, resolveTier, makeScale } from '../renderer/hooks/useDPR.js';

// Tests the real tier table and scale() from useDPR.js.

describe('resolveTier — matches the PLAN.md §3.1 scaling table', () => {
  it('resolves exactly 1.0 to the Standard 1080p tier (13px base)', () => {
    expect(resolveTier(1.0)).toEqual(DPR_TIERS[0]);
  });

  it('resolves exactly 1.25 to the 125% Windows scaling tier (12px base)', () => {
    expect(resolveTier(1.25)).toEqual(DPR_TIERS[1]);
  });

  it('resolves exactly 1.5 to the 150%/2K tier (11px base)', () => {
    expect(resolveTier(1.5)).toEqual(DPR_TIERS[2]);
  });

  it('resolves 2.0 (Retina/4K) to the 10px base tier', () => {
    expect(resolveTier(2.0)).toEqual(DPR_TIERS[3]);
  });

  it('resolves anything above 1.5 and below 2.0 (e.g. 1.75) to the Retina/4K tier, not an intermediate one', () => {
    expect(resolveTier(1.75)).toEqual(DPR_TIERS[3]);
  });

  it('resolves below 1.0 (e.g. a non-standard 0.9) to the baseline tier rather than throwing', () => {
    expect(resolveTier(0.9)).toEqual(DPR_TIERS[0]);
  });

  it('resolves an extreme high DPR (e.g. 3.0, some Android devices) to the Retina/4K ceiling tier', () => {
    expect(resolveTier(3.0)).toEqual(DPR_TIERS[3]);
  });

  it('buckets a value just above 1.0 into the next tier up (e.g. 1.1 -> 1.25 tier), since tiers are upper-bound matches', () => {
    expect(resolveTier(1.1)).toEqual(DPR_TIERS[1]);
  });

  it('buckets a value just above 1.25 into the next tier up (e.g. 1.4 -> 1.5 tier)', () => {
    expect(resolveTier(1.4)).toEqual(DPR_TIERS[2]);
  });
});

describe('scale() — derives a multiplier from the matched tier\'s base font', () => {
  it('is a no-op (1:1) at the 1.0 / 13px baseline', () => {
    const scale = makeScale(1.0);
    expect(scale(12)).toBe(12);
    expect(scale(28)).toBe(28);
    expect(scale(6)).toBe(6);
  });

  it('shrinks values proportionally at 1.25 (12/13 factor)', () => {
    const scale = makeScale(1.25);
    expect(scale(13)).toBe(12); // base font itself maps exactly
    expect(scale(26)).toBe(24);
  });

  it('shrinks values proportionally at 1.5 (11/13 factor)', () => {
    const scale = makeScale(1.5);
    expect(scale(13)).toBe(11);
  });

  it('shrinks values proportionally at 2.0 / Retina (10/13 factor)', () => {
    const scale = makeScale(2.0);
    expect(scale(13)).toBe(10);
    expect(scale(120)).toBe(92.31);
  });

  it('rounds to 2 decimal places rather than producing long floats', () => {
    const scale = makeScale(1.5);
    const result = scale(11.5);
    // 11.5 * (11/13) = 9.7307...; rounded to 2dp = 9.73
    expect(result).toBe(9.73);
    expect(Number.isInteger(result * 100)).toBe(true);
  });

  it('never returns a negative or zero value for a positive input', () => {
    [1.0, 1.25, 1.5, 2.0].forEach(dpr => {
      const scale = makeScale(dpr);
      expect(scale(1)).toBeGreaterThan(0);
    });
  });

  it('preserves relative ordering of inputs (monotonic) within a tier', () => {
    const scale = makeScale(1.5);
    expect(scale(10)).toBeLessThan(scale(20));
    expect(scale(20)).toBeLessThan(scale(30));
  });
});
