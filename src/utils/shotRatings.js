export function shotTasteRating(shot) {
  const { shotRating } = shot;
  return Number.isInteger(shotRating) && shotRating >= 1 && shotRating <= 5 ? shotRating : null;
}

export function saveShotTasteRating(db, id, rating) {
  if (rating !== null && shotTasteRating({ shotRating: rating }) === null) {
    throw new RangeError('Shot ratings must be whole stars from 1 to 5.');
  }
  return db.shots.update(id, { shotRating: rating ?? undefined });
}
