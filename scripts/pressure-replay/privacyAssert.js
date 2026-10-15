/**
 * Scoring/harness-only checks: no image data must leave the lab via network or storage.
 * @param {{ url: string, method: string, postBytes: number }[]} requests
 * @param {{ localStorageWrites: number, indexedDbWrites: number }} storage
 * @param {string} originPrefix — e.g. preview server origin
 */
export function assessPressureLabPrivacy(requests, storage, originPrefix) {
  const external = requests.filter((r) => !r.url.startsWith(originPrefix));
  const largePosts = requests.filter((r) => r.postBytes > 48_000);
  const imageLikePosts = requests.filter((r) => {
    if (r.postBytes < 4096) return false;
    const u = r.url.toLowerCase();
    return u.includes('image') || u.includes('upload') || u.includes('blob');
  });
  const storageWrites = (storage?.localStorageWrites ?? 0) + (storage?.indexedDbWrites ?? 0);
  const passed = external.length === 0
    && largePosts.length === 0
    && imageLikePosts.length === 0
    && storageWrites === 0;
  return {
    passed,
    externalRequestCount: external.length,
    largePostCount: largePosts.length,
    imageLikePostCount: imageLikePosts.length,
    storageWrites,
    totalRequests: requests.length,
  };
}
