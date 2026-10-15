/**
 * Display name for a bean: "Ethiopia (Local)" when roaster is set, else "Ethiopia".
 */
export function formatBeanDisplayName(bean) {
  const name = String(bean?.name ?? '').trim() || 'Unnamed';
  const roaster = String(bean?.roaster ?? '').trim();
  if (!roaster) return name;
  return `${name} (${roaster})`;
}

/** Roaster • roast type line; omits empty roaster segment. */
export function formatBeanRoasterRoastLine(bean) {
  const roaster = String(bean?.roaster ?? '').trim();
  const roastType = bean?.roastType ? `${bean.roastType} Roast` : '';
  const parts = [roaster, roastType].filter(Boolean);
  return parts.join(' • ');
}
