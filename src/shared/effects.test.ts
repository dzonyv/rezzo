import { describe, expect, it } from 'vitest';
import { defaultParams, EFFECT_GROUPS, EFFECT_NAMES, EFFECTS, effectPassAt, paramsValid, type EffectName, type EffectTiming } from './effects.ts';

function effect(name: EffectName, patch: Partial<EffectTiming> = {}): EffectTiming {
  return { effect: name, start: 2, end: 4, intensity: [{ t: 2, value: 1, ease: 'cut' }], params: defaultParams(name), ...patch };
}

describe('effect library', () => {
  it('puts every effect in one of the groups, with valid starting settings', () => {
    for (const name of EFFECT_NAMES) {
      expect(EFFECT_GROUPS).toContain(EFFECTS[name].group);
      expect(paramsValid(name, defaultParams(name))).toBe(true);
    }
    for (const group of EFFECT_GROUPS) expect(EFFECT_NAMES.some((n) => EFFECTS[n].group === group)).toBe(true);
  });

  it('checks settings against the effect', () => {
    expect(paramsValid('shake', { amount: 0.5, speed: 12 })).toBe(true);
    expect(paramsValid('shake', { amount: 1.5, speed: 12 })).toBe(false);
    expect(paramsValid('shake', { amount: 0.5 })).toBe(false);
    expect(paramsValid('flash', { amount: 0.5 })).toBe(false);
  });
});

describe('effect passes', () => {
  it('gives the same pass for the same moment', () => {
    for (const name of EFFECT_NAMES) expect(effectPassAt(effect(name), 2.7)).toEqual(effectPassAt(effect(name), 2.7));
  });

  it('does nothing at intensity 0', () => {
    for (const name of EFFECT_NAMES) expect(effectPassAt(effect(name, { intensity: [{ t: 2, value: 0, ease: 'cut' }] }), 3)).toBeNull();
  });

  it('follows the intensity keyframes', () => {
    const fading = effect('saturation', { intensity: [{ t: 2, value: 1, ease: 'cut' }, { t: 3, value: 0.5, ease: 'cut' }] });
    expect(effectPassAt(fading, 2.5)).toMatchObject({ pass: 'grade', saturation: 0.5 });
    expect(effectPassAt(fading, 3.5)).toMatchObject({ pass: 'grade', saturation: 0.25 });
  });

  it('punches in quickly and holds, or goes back at the end', () => {
    const hold = effect('zoomPunch');
    expect(effectPassAt(hold, 2)).toBeNull();
    expect(effectPassAt(hold, 2.15)).toMatchObject({ pass: 'camera', zoom: 1.3 });
    expect(effectPassAt(hold, 3.99)).toMatchObject({ zoom: 1.3 });
    const back = effect('zoomPunch', { params: { zoom: 1.5, punch: 0.2, release: 0.5 } });
    expect((effectPassAt(back, 3.4) as { zoom: number }).zoom).toBeCloseTo(1.5);
    expect((effectPassAt(back, 3.75) as { zoom: number }).zoom).toBeCloseTo(1.25);
    expect((effectPassAt(back, 3.999) as { zoom: number }).zoom).toBeLessThan(1.001);
  });

  it('shakes within its reach, zoomed in enough to hide the edges', () => {
    for (let t = 2; t < 4; t += 0.01) {
      const pass = effectPassAt(effect('shake', { params: { amount: 1, speed: 20 } }), t);
      if (pass?.pass !== 'camera') throw new Error('not a camera pass');
      expect(Math.abs(pass.x)).toBeLessThanOrEqual(0.02);
      expect(Math.abs(pass.y)).toBeLessThanOrEqual(0.02);
      expect(pass.zoom - 1).toBeGreaterThanOrEqual(2 * Math.max(Math.abs(pass.x), Math.abs(pass.y)));
    }
  });

  it('zooms slowly over the effect, to its zoom at the end', () => {
    expect(effectPassAt(effect('slowZoom'), 2)).toBeNull();
    expect(effectPassAt(effect('slowZoom'), 3)).toMatchObject({ zoom: 1.075 });
  });

  it('flashes white at the start and fades out', () => {
    expect(effectPassAt(effect('flash'), 2)).toEqual({ pass: 'tint', color: [1, 1, 1], amount: 1 });
    expect((effectPassAt(effect('flash'), 3) as { amount: number }).amount).toBeCloseTo(0.25);
  });

  it('fades to black by the end, and from black from the start', () => {
    expect(effectPassAt(effect('fadeOut'), 2)).toBeNull();
    expect((effectPassAt(effect('fadeOut'), 3.99) as { amount: number }).amount).toBeGreaterThan(0.99);
    expect(effectPassAt(effect('fadeIn'), 2)).toEqual({ pass: 'tint', color: [0, 0, 0], amount: 1 });
    expect((effectPassAt(effect('fadeIn'), 3) as { amount: number }).amount).toBeCloseTo(0.5);
  });

  it('turns black and white with all of its saturation taken out', () => {
    expect(effectPassAt(effect('blackWhite'), 3)).toEqual({ pass: 'grade', brightness: 0, contrast: 0, saturation: -1, temperature: 0 });
  });

  it('changes the grain and the glitch with time, the same way every time', () => {
    const at = (name: EffectName, t: number) => (effectPassAt(effect(name), t) as { seed: number }).seed;
    expect(at('grain', 2.5)).not.toBe(at('grain', 2.6));
    expect(at('grain', 2.5)).toBe(at('grain', 2.51));
    expect(at('glitch', 3)).toBe(12);
  });

  it('uses the starting value of a setting the layer lacks', () => {
    expect(effectPassAt(effect('vignette', { params: {} }), 3)).toEqual({ pass: 'vignette', amount: 1, size: 0.5 });
  });
});
