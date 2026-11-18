const MODEL_BASE: string = (import.meta.env.VITE_MODEL_BASE || '').replace(/\/+$/, '');

export function modelUrl(path: string): string {
  if (!path) {
    return path;
  }
  if (MODEL_BASE) {
    const clean = String(path).replace(/^\/+/, '');
    return `${MODEL_BASE}/${clean}`;
  }
  return path;
}

// Maps ship the same way as models: local files in dev, the R2 bucket in
// production (VITE_MAP_BASE, defaulting to the model base since maps live
// under the same bucket prefix). dist/ never contains maps/.
const MAP_BASE: string = (import.meta.env.VITE_MAP_BASE || import.meta.env.VITE_MODEL_BASE || '').replace(/\/+$/, '');

export function mapBase(): string {
  return MAP_BASE;
}

export function mapUrl(path: string): string {
  if (!path) {
    return path;
  }
  if (/^(https?:|data:|blob:)/.test(path)) {
    return path;
  }
  if (MAP_BASE) {
    const clean = String(path).replace(/^\/+/, '');
    return `${MAP_BASE}/${clean}`;
  }
  return path;
}

// UI images (HUD portraits, build-menu and command icons) are referenced as
// relative `assets/...` paths and are NOT bundled by vite (no glob covers
// them), so production serves them from R2 while dev keeps local files.
const ASSET_BASE: string = (import.meta.env.VITE_ASSET_BASE || '').replace(/\/+$/, '');

export function assetUrl(path: string | null): string | null {
  if (!path || typeof path !== 'string' || !path.includes('/')) {
    return path;
  }
  if (/^(https?:|data:|blob:)/.test(path) || path.startsWith('/') || !ASSET_BASE) {
    return path;
  }
  return `${ASSET_BASE}/${path.replace(/^\/+/, '')}`;
}
