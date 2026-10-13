export function buildAppDefaultInitialGrindHint(grinderModel, currentGrindLabel) {
  const isNiche = grinderModel === 'Niche Zero';
  const grindLabel = isNiche
    ? `Starting dial ${currentGrindLabel}`
    : `Starting grind ${currentGrindLabel}`;
  return `${grindLabel} — common espresso starting point (app default, not manufacturer guidance). Not from your shot history.`;
}
