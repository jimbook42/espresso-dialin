import assert from 'assert';
import fs from 'fs';
import { calculateRecommendation } from '../utils/grinderLogic.js';
import { buildBrewSteps, DEFAULT_BREW_ACCESSORIES, normalizeBrewAccessories } from './steps.js';
import {
  BREW_GUIDANCE_GRADUATION_SHOT_COUNT,
  BREW_GUIDANCE_MODES,
  buildQuickChecklist,
  countLoggedShots,
  normalizeBrewGuidanceMode,
  shouldShowBrewGuideIntro,
  shouldShowGraduationPrompt,
} from './guidance.js';

const DIAL = {
  beanName: 'House Espresso',
  doseG: 18,
  yieldG: 36,
  timeMinS: 27,
  timeMaxS: 32,
  brewTemperatureC: 92,
  grinderModel: 'Sunbeam Barista Max',
  grindLabel: '15',
  previousGrindLabel: '15',
};

function shots(n) {
  return Array.from({ length: n }, (_, i) => ({ id: `s${i}`, timestamp: new Date().toISOString() }));
}

export function runBrewGuidanceTests() {
  assert.equal(normalizeBrewGuidanceMode(undefined), BREW_GUIDANCE_MODES.full);
  assert.equal(normalizeBrewGuidanceMode('quick'), BREW_GUIDANCE_MODES.quick);
  assert.equal(normalizeBrewGuidanceMode('none'), BREW_GUIDANCE_MODES.none);
  assert.equal(normalizeBrewGuidanceMode('invalid'), BREW_GUIDANCE_MODES.full);

  assert.equal(shouldShowBrewGuideIntro({}, 0), true);
  assert.equal(shouldShowBrewGuideIntro({ brewGuideIntroSeen: true }, 0), false);
  assert.equal(shouldShowBrewGuideIntro({}, 1), false);
  assert.equal(shouldShowBrewGuideIntro({ brewGuideSetupComplete: true }, 0), false);
  assert.equal(
    normalizeBrewGuidanceMode({ grinderModel: 'Sette 270Wi', brewGuideEnabled: true }.brewGuideGuidanceMode),
    BREW_GUIDANCE_MODES.full,
  );

  const nine = shots(9);
  const ten = shots(10);
  assert.equal(countLoggedShots(nine), 9);
  assert.equal(shouldShowGraduationPrompt({}, 9), false);
  assert.equal(shouldShowGraduationPrompt({}, 10), true);
  assert.equal(shouldShowGraduationPrompt({ brewGuideGraduationDismissed: true }, 10), false);
  assert.equal(shouldShowGraduationPrompt({ brewGuideGuidanceMode: 'quick' }, 10), false);
  assert.equal(shouldShowGraduationPrompt({ brewGuideGuidanceMode: 'none' }, 10), false);
  assert.equal(shouldShowBrewGuideIntro({ brewGuideIntroSeen: true }, 0), false);

  const withRdtWdtPuck = normalizeBrewAccessories({
    rdt: true,
    wdt: true,
    puckScreen: true,
    distributor: false,
  });
  const checklistText = buildQuickChecklist(withRdtWdtPuck, DIAL).map((item) => item.text).join('\n');
  assert.match(checklistText, /rdt/i);
  assert.match(checklistText, /wdt/i);
  assert.match(checklistText, /puck screen/i);
  assert.equal(/distributor/i.test(checklistText), false);

  const noneAccessories = { ...DEFAULT_BREW_ACCESSORIES };
  const minimal = buildQuickChecklist(noneAccessories, DIAL).map((item) => item.text).join('\n');
  assert.equal(/distributor|wdt|rdt|puck screen|shaker|funnel/i.test(minimal), false);

  const fullSteps = buildBrewSteps(withRdtWdtPuck, DIAL).length;
  assert.ok(buildQuickChecklist(withRdtWdtPuck, DIAL).length < fullSteps);

  const recipe = {
    targetTimeMinS: 25,
    targetTimeMaxS: 30,
    targetDoseG: 18,
    targetYieldG: 36,
    brewTemperatureC: 93,
  };
  const rec = calculateRecommendation(
    {
      grinderModel: 'Sette 270Wi',
      setteMacro: 13,
      setteMicro: 'E',
      wasPurged: true,
      actualTime: 27,
      actualDose: 18,
      actualYield: 36,
      tasteProfile: 'sour',
    },
    recipe,
    [],
    true,
  );
  assert.match(rec.reason, /FINER|COARSER|KEEP/i);

  const guidanceSource = fs.readFileSync(new URL('./guidance.js', import.meta.url), 'utf8');
  assert.equal(/dexie|indexedDB|db\.version/i.test(guidanceSource), false);
  assert.equal(BREW_GUIDANCE_GRADUATION_SHOT_COUNT, 10);

  console.log('Brew guidance tests passed!');
}
