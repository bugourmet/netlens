import { describe, expect, it } from 'vitest';
import { DEFAULTS, sanitize } from './settings';

describe('sanitize', () => {
  it('returns defaults for anything that is not an object', () => {
    expect(sanitize(null)).toEqual(DEFAULTS);
    expect(sanitize('ultra')).toEqual(DEFAULTS);
    expect(sanitize(42)).toEqual(DEFAULTS);
  });

  it('keeps valid values', () => {
    const s = sanitize({ quality: 'battery', units: 'bits', arcLimit: 25, stars: false, homeCc: 'HR' });
    expect(s).toMatchObject({ quality: 'battery', units: 'bits', arcLimit: 25, stars: false, homeCc: 'HR' });
  });

  it('drops values of the wrong type, outside the choices or out of range', () => {
    const s = sanitize({ quality: 'high', arcLimit: '40', rotateSpeed: 99, stars: 'yes', captureMode: 'root' });
    expect(s.quality).toBe(DEFAULTS.quality);
    expect(s.arcLimit).toBe(DEFAULTS.arcLimit);
    expect(s.rotateSpeed).toBe(DEFAULTS.rotateSpeed);
    expect(s.stars).toBe(DEFAULTS.stars);
    expect(s.captureMode).toBe(DEFAULTS.captureMode);
  });

  it('ignores unknown keys', () => {
    expect(sanitize({ evil: true })).toEqual(DEFAULTS);
  });
});
