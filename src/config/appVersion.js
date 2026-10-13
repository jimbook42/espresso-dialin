const version = import.meta.env.VITE_APP_VERSION || '4.3';
const commitSha = (import.meta.env.VITE_APP_COMMIT_SHA || '').trim();

export const APP_VERSION_LABEL =
  commitSha && commitSha !== 'unknown' ? `v${version} · ${commitSha}` : `v${version}`;
