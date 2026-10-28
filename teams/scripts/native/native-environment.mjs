// Local Teams, trace and business-test endpoints must bypass inherited external
// proxies. Some HTTP clients read only one casing; Python also matches IPv6
// URL hosts with brackets. Preserve every existing bypass and proxy setting.
export function loopbackProxyEnvironment(base) {
  const bypass = [...new Set([
    ...(base.NO_PROXY ?? '').split(','),
    ...(base.no_proxy ?? '').split(','),
    '127.0.0.1', 'localhost', '::1', '[::1]',
  ].map(value => value.trim()).filter(Boolean))].join(',');
  return { ...base, NO_PROXY: bypass, no_proxy: bypass };
}
