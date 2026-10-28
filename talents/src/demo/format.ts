// Formatting and ids shared by every page.

export const uid = (prefix: string) => prefix + '-' + Math.random().toString(36).slice(2, 8);
export const num = (n: number) => Number(n).toLocaleString('en-US');
export const tokens = (n: number) => n >= 10000 ? (Math.round(n / 1000) / 10) + ' 万' : num(n);

/** 2026-10-27 14:20, the format the demo data uses everywhere. */
export function now(d = new Date()) {
  const p = (n: number) => (n < 10 ? '0' : '') + n;
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
/** Today's times as "今天 14:20", other days as "10-25 14:20". */
export function when(s?: string | null) {
  if (!s) return '';
  // Some data carries ISO timestamps (e.g. 2026-10-27T12:16:47.022Z); show them in local time like the rest.
  if (/^\d{4}-\d\d-\d\dT/.test(s) && !Number.isNaN(Date.parse(s))) s = now(new Date(s));
  return s.slice(0, 10) === now().slice(0, 10) ? '今天 ' + s.slice(11) : s.slice(5);
}
export const versionLabel = (at?: string | null) => at ? when(at) + ' 版本' : '';

/** Stable pseudo session ids, so the same task always shows the same iCode session. */
export function hashId(seed: string, len = 12) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  const hex = ('00000000' + h.toString(16)).slice(-8);
  return (hex + hex.split('').reverse().join('')).slice(0, len);
}
