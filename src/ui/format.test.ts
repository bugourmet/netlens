import { afterEach, describe, expect, it } from 'vitest';
import { useSettings } from '../state/settings';
import { esc, fmtAgo, fmtBytes, rateParts } from './format';

describe('fmtBytes', () => {
  it('picks a readable unit', () => {
    expect(fmtBytes(0)).toBe('0 B');
    expect(fmtBytes(1536)).toBe('1.5 KB');
    expect(fmtBytes(20 * 1024)).toBe('20 KB');
    expect(fmtBytes(3 * 1024 ** 3)).toBe('3.00 GB');
  });
});

describe('rateParts', () => {
  afterEach(() => useSettings.getState().set('units', 'bytes'));

  it('uses bytes by default', () => {
    expect(rateParts(2.5 * 1024 ** 2)).toEqual(['2.5', 'MB/s']);
  });

  it('switches to bits per second', () => {
    useSettings.getState().set('units', 'bits');
    expect(rateParts(125_000)).toEqual(['1.0', 'Mb/s']);
  });
});

describe('fmtAgo', () => {
  it('scales from minutes to days', () => {
    expect(fmtAgo(30)).toBe('just now');
    expect(fmtAgo(600)).toBe('10 min ago');
    expect(fmtAgo(3600)).toBe('1 hour ago');
    expect(fmtAgo(5 * 3600)).toBe('5 hours ago');
    expect(fmtAgo(3 * 86400)).toBe('3 days ago');
  });
});

describe('esc', () => {
  it('neutralises HTML in names taken from traffic', () => {
    expect(esc('<img src=x onerror="a()">&\'')).toBe('&lt;img src=x onerror=&quot;a()&quot;&gt;&amp;&#39;');
  });
});
