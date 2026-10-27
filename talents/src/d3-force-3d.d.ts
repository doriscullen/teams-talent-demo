// d3-force-3d ships without types; force-graph bundles it, so the view reuses its forces at no extra bundle cost.
declare module 'd3-force-3d' {
  type Value<N> = number | ((node: N) => number);
  interface Force<N> { (alpha: number): void; initialize?: (nodes: N[], ...args: any[]) => void; strength(value: Value<N>): this }
  export function forceCollide<N>(radius?: Value<N>): Force<N> & { iterations(value: number): Force<N> };
  export function forceX<N>(x?: Value<N>): Force<N>;
  export function forceY<N>(y?: Value<N>): Force<N>;
}
