export const BRAND_NAME = "TransGest";
export const BRAND_VERSION_NAME = process.env.REACT_APP_PRODUCT === 'planner' ? 'Planner' : 'TMS';
export const BRAND_VERSION = "1.0.0";
export const BRAND_VERSION_LABEL = `${BRAND_VERSION_NAME} v${BRAND_VERSION}`;
export const BRAND_FULL_NAME = `${BRAND_NAME} ${BRAND_VERSION_LABEL}`;

const PLAN_BRAND_SUFFIX = {
  lite: "Go",
  basico: "Control",
  profesional: "Pro",
  enterprise: "Pro Intelligence",
};

export function getBrandEdition(plan = "enterprise") {
  return PLAN_BRAND_SUFFIX[String(plan || "").trim().toLowerCase()] || PLAN_BRAND_SUFFIX.enterprise;
}

export function getBrandDisplayName(plan = "enterprise") {
  if (process.env.REACT_APP_PRODUCT === 'planner') return 'TransGest Planner';
  return `${BRAND_NAME} ${getBrandEdition(plan)}`;
}

export function getBrandVersionLabel(appMeta = null) {
  const versionName = String(appMeta?.version_name || BRAND_VERSION_NAME).trim() || BRAND_VERSION_NAME;
  const version = String(appMeta?.version || BRAND_VERSION).trim() || BRAND_VERSION;
  return `${versionName} v${version}`;
}
