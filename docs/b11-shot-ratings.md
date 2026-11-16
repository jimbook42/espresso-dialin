# B11 shot ratings and consistency

Taste ratings use the existing optional `shotRating` property on saved shots. A cleared rating leaves that property absent. Existing valid whole-star ratings are readable. Deleting a shot, or deleting a bean and its associated shots, also deletes the associated ratings.

The existing History CSV already exports and imports the `Rating` column. A CSV restored into fresh storage preserves valid whole-star ratings and blank ratings. The current importer skips duplicate shots, so importing into an existing log does not overwrite or clear a rating on a duplicate. B13 can consider how restore should reconcile ratings for duplicate shots.

The existing CSV also omits device curves and timing. Sensor consistency therefore depends on recordings available on the current device. Historical curves with missing device provenance are marked unsupported for aggregate statistics and remain available through their existing profile views. New captures record source metadata with their existing shot timing so the aggregate can require physical input. This uses the current Dexie schema and leaves existing shot measurements and CSV fields intact.
