import { useEffect, useRef, useState } from 'react';
import { useSettings } from '../state/settings';

export function fmtBytes(b: number) {
  if (b < 1024) return `${Math.round(b)} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(b < 10240 ? 1 : 0)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(b < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

/** Number and unit apart, for readouts that set the unit smaller. */
export function rateParts(bytesPerSecond: number): [string, string] {
  if (useSettings.getState().units === 'bits') {
    const b = bytesPerSecond * 8;
    if (b < 1000) return [String(Math.round(b)), 'b/s'];
    if (b < 1e6) return [(b / 1e3).toFixed(b < 1e4 ? 1 : 0), 'Kb/s'];
    if (b < 1e9) return [(b / 1e6).toFixed(b < 1e7 ? 1 : 0), 'Mb/s'];
    return [(b / 1e9).toFixed(2), 'Gb/s'];
  }
  const b = bytesPerSecond;
  if (b < 1024) return [String(Math.round(b)), 'B/s'];
  if (b < 1024 ** 2) return [(b / 1024).toFixed(b < 10240 ? 1 : 0), 'KB/s'];
  if (b < 1024 ** 3) return [(b / 1024 ** 2).toFixed(b < 10 * 1024 ** 2 ? 1 : 0), 'MB/s'];
  return [(b / 1024 ** 3).toFixed(2), 'GB/s'];
}

export function fmtRate(b: number) {
  const [n, u] = rateParts(b);
  return `${n} ${u}`;
}

export const fmtClock = (t: number) =>
  new Date(t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export const fmtShortClock = (t: number) => new Date(t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function fmtAgo(seconds: number) {
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) {
    const h = Math.round(seconds / 3600);
    return `${h} ${h === 1 ? 'hour' : 'hours'} ago`;
  }
  const d = Math.round(seconds / 86400);
  return `${d} ${d === 1 ? 'day' : 'days'} ago`;
}

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

export function useIsPhone() {
  const q = '(max-width: 767px)';
  const [phone, setPhone] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const on = () => setPhone(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return phone;
}
