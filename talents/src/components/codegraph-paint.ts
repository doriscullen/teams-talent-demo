// Canvas painting for the CodeGraph view: flat discs, a static selection ring and haloed labels, all in theme colours.
export const palette = ['#287f8f', '#bd683c', '#557e39', '#a64f6b', '#526bb1', '#967525', '#487e67', '#88629c', '#637680'];
export interface Theme { canvas: string; text: string; primary: string }

const channels = (hex: string) => { const v = parseInt(hex.slice(1), 16); return [v >> 16, (v >> 8) & 255, v & 255]; };
export const rgba = (hex: string, alpha: number) => `rgba(${channels(hex)},${alpha})`;

export function readTheme(element: Element): Theme {
  const css = getComputedStyle(element), value = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return { canvas: value('--ui-color-workspace', '#ffffff'), text: value('--ui-color-text', '#282a35'), primary: value('--ui-color-primary', '#7855ae') };
}

/** A rim in the canvas colour keeps overlapping nodes apart. */
export function paintNode(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, dim: boolean, scale: number, theme: Theme) {
  ctx.globalAlpha = dim ? .15 : 1;
  ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI);
  ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = theme.canvas; ctx.lineWidth = 1 / scale; ctx.stroke();
  ctx.globalAlpha = 1;
}

export function paintSelection(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, scale: number, theme: Theme) {
  ctx.beginPath(); ctx.arc(x, y, r + 3 / scale, 0, 2 * Math.PI);
  ctx.strokeStyle = theme.primary; ctx.lineWidth = 2 / scale; ctx.stroke();
}

/** Draws text with a halo in the canvas colour; the caller sets ctx.font once per frame. */
export function paintLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, scale: number, strong: boolean, theme: Theme) {
  ctx.lineWidth = 3 / scale; ctx.lineJoin = 'round'; ctx.strokeStyle = theme.canvas; ctx.strokeText(text, x, y);
  ctx.globalAlpha = strong ? 1 : .85; ctx.fillStyle = theme.text; ctx.fillText(text, x, y); ctx.globalAlpha = 1;
}
