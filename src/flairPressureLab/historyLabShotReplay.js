/** History tab: play control only on the newest shot when a replay exists for that id. */
export function shouldShowLabShotReplayPlay({ shotId, newestShotId, labReplayShotId }) {
  if (!shotId || !newestShotId || !labReplayShotId) return false;
  return shotId === newestShotId && shotId === labReplayShotId;
}
