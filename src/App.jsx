import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import {
  db,
  generateId,
  calculateRecommendation,
  calculateEffectiveBeanAge,
  getInitialGrindRecommendation,
  getAgeAdjustedRecommendation,
  getIdealFreezeWindow,
  classifyShotOutcome,
  getRecommendationEvidenceContext,
  recipeContextForShot,
  beanIsDecaf,
  decafContextNote,
  getHistoricalRoastBaseline,
  shotEligibleForLearning,
  filterShotsForGrinderLearning,
  filterShotsForGrinderModelLearning,
  shotMatchesGrinderForLearning,
  findLatestShotForBeanAndGrinder,
  recomputeReferenceLearningRecommendationFromLastShot,
  recomputeQuantitativeRecommendationFromLastShot,
  grinderSupportsQuantitativeRecommendations,
  shouldUsePreviousRecipeRecommendation,
  PREVIOUS_RECIPE_REC_DISCLAIMER,
  KNOWN_ISSUE_REASONS,
  knownIssueReasonLabel,
} from './utils/grinderLogic';
import { useLiveQuery } from 'dexie-react-hooks';
import { History, PlusCircle, AlertTriangle, Download, Trash2, ArrowRight, Sun, Moon, BarChart2, Star, Flame, ChevronDown, ChevronUp, Settings, Sliders, Coffee, Play, RotateCcw, Edit2, X, CheckCircle, ClipboardList, Info, Flag } from 'lucide-react';
import { HowItWorksModal } from './components/HowItWorksModal';
import { FinishBeanToast, TOAST_DURATION_MS } from './components/FinishBeanToast.jsx';
import {
  nextActiveBeanIdAfterFinish,
  persistBeanActive,
  persistBeanFinished,
  restoreBeanFromSnapshot,
  snapshotBeanRecord,
} from './utils/beanFinishActions.js';
import {
  readBeansFinishedSectionOpen,
  writeBeansFinishedSectionOpen,
} from './utils/beansFinishedSectionPrefs.js';
import { PastBeansList } from './components/PastBeansList.jsx';
import { ShotEngineStatsPanel } from './components/ShotEngineStatsPanel';
import { PressureProfileChart } from './components/PressureProfileChart';
import { ShotTimerWeightReadout } from './components/ShotTimerWeightReadout.jsx';
import { ShotTimerWeightGoalLine } from './components/ShotTimerWeightGoalLine.jsx';
import { GrinderGrindControls } from './components/GrindControls';
import { formatGrindRecommendationSummary } from './utils/grindRecommendationDisplay.js';
import { formatBeanDisplayName, formatBeanRoasterRoastLine } from './utils/beanDisplayName.js';
import {
  formatHistoryShotUserNoteLine,
  formatLastShotUserNoteSuffix,
} from './utils/shotNotesDisplay.js';
import { buildAppDefaultInitialGrindHint } from './utils/initialGrindHint.js';
import {
  CUSTOM_GRINDER_PICKER_ID,
  defaultBrewTemperatureForGrinder,
  formatCurrentGrindLabel,
  formatInitialGrindDisplay,
  formatPreviousGrindLabel,
  formatRecommendedGrindDisplay,
  formatShotGrindForHistory,
  getUiGrinderPresentation,
  grinderPickerValueForSettings,
  resolveActiveGrinderModel,
  isCustomGrinderModel,
  isPresetGrinderModel,
  isSunbeamGrinderModel,
  isNicheZeroGrinderModel,
  NICHE_ZERO_GRINDER_ID,
  listGrinderPickerOptions,
  normalizeCustomGrinderSettingsPatch,
  parseGrindForShotSave,
  persistedSettingsPatchFromRecommendation,
  uiStateFromRecommendedSetting,
} from './grinders/grinderRegistry.js';
import {
  BCG820_GRINDER_ID,
  ENCORE_ESP_GRINDER_ID,
  getPresetGrinderSpec,
  isHeldbackEstimatedPresetId,
} from './grinders/presetGrinders/index.js';
import { PresetGrinderAuxFields } from './components/PresetGrinderAuxFields.jsx';
import {
  defaultPresetGrindValue,
  resolveEffectiveZeroOffsetPresetDial,
} from './grinders/presetGrinders/dial.js';
import {
  getGrindUiForBeanGrinder,
  grindUiSnapshotFromControls,
  patchGrindUiForBeanGrinder,
} from './grinders/grindDialByBean.js';
import {
  defaultCustomGrindValue,
  isCustomGrinderFormValid,
  normalizeCustomGrinderProfile,
} from './grinders/customGrinder.js';
import { FirstLaunchWizard } from './components/FirstLaunchWizard.jsx';
import { CustomGrinderForm } from './components/CustomGrinderForm.jsx';
import {
  shouldDeferMainShellForFirstLaunch,
  shouldRenderFirstLaunchWizard,
} from './settings/firstLaunchRenderGate.js';
import { SETTINGS_QUERY_PENDING } from './settings/settingsLiveQuery.js';
import { writeCachedGlobalSettings } from './settings/settingsLocalCache.js';
import { patchGlobalSettings } from './settings/patchGlobalSettings.js';
import { grindSettingsRestoreDeps } from './settings/grindSettingsRestoreDeps.js';
import { PwaInstallBanner } from './components/PwaInstallBanner.jsx';
import {
  clearRecommendationCardDisplayHoldPatch,
  getRecommendationCardDisplayHold,
  patchRecommendationCardDisplayHold,
} from './settings/recommendationCardDisplayHold.js';
import { isDevUrlSimScaleActive } from './config/devUrlSimScale.js';
import {
  isSmartScaleIntegrationActive,
  listSmartScalePickerOptions,
  normalizeSmartScaleDeviceId,
  SMART_SCALE_MANUAL_ID,
  resolveSmartScalePickerValue,
  smartScaleActiveSummary,
} from './settings/scalePreference.js';
import {
  capturePendingGrindState,
  pendingGrindSessionKey,
  resolveGrindControlUiStateWithPending,
} from './grinders/pendingGrindSession.js';
import {
  formatRecFollowedForCsv,
  resolveRecommendationFollowedForSave,
} from './utils/recommendationFollowed.js';
import { buildLabPressureShotFields } from './flairPressureLab/labPressureShotFields.js';
import {
  buildShotsCsvContent,
  buildShotsCsvRows,
  downloadCsvFile,
  SHOT_CSV_HEADERS,
} from './utils/csvExport.js';
import { importShotsFromCsv } from './utils/csvImport.js';
import {
  inferRecipeTargetsFromShots,
  persistBeanRecipeForBean,
  resolveRecipeForBean,
} from './utils/beanRecipeResolution.js';
import {
  BALANCED_TASTE_PROFILE,
  normalizeTasteProfile,
  tasteProfileDisplayLabel,
  tasteProfileForSave,
  tasteProfilesMatch,
} from './utils/tasteProfile.js';
import { SettingsToggle } from './components/SettingsToggle';
import { readCachedGrindBootstrapState } from './grinders/grindControlBootstrap.js';
import {
  isShotStartCountdownActive,
  normalizeShotStartCountdown,
  SHOT_START_COUNTDOWN_FLAIR_ONLY,
  SHOT_START_COUNTDOWN_OFF,
  SHOT_START_COUNTDOWN_ON,
} from './settings/shotStartCountdown.js';
import { SHOT_YIELD_SETTLE_MS } from './scales/scaleShotStopSettle.js';
import { smoothFlowSeriesForPlot } from './scales/flowMetrics.js';
import {
  createFlowEndAutoStopState,
  flowEndAutoStopRecordedEndExtractionS,
  flowEndAutoStopShouldFreezeTimer,
  flowEndAutoStopShouldStop,
  stepFlowEndAutoStop,
} from './scales/flowEndAutoStop.js';
import { normalizeScaleFlowAutoStopEnabled } from './settings/scaleFlowAutoStop.js';
import {
  isShotScreenWeightGoalsEnabled,
  SHOT_SCREEN_WEIGHT_GOALS_KEY,
} from './settings/shotScreenWeightGoals.js';
import {
  applyBasketChangeToRecommendation,
  buildBasketAdjustmentBasisRec,
  BASKET_FLOW_FEWER_HOLES,
  BASKET_FLOW_MORE_HOLES,
} from './utils/basketChangeAdjustment.js';
import { BrewGuide } from './components/BrewGuide';
import { BrewGuideIntroModal } from './components/BrewGuideIntroModal';
import { BrewGraduationPrompt } from './components/BrewGraduationPrompt';
import { QuickChecklistCard } from './components/QuickChecklistCard';
import {
  BREW_GUIDANCE_MODES,
  countLoggedShots,
  normalizeBrewGuidanceMode,
  shouldShowBrewGuideIntro,
  shouldShowGraduationPrompt,
  shouldNavigateToBrewAfterFirstBean,
} from './brewGuide/guidance';
import { buildBrewGuideDialPayload } from './brewGuide/grinderBrewGuide.js';
import { brewGuideIntroMachineSettingsLine, brewGuideSettingsToggleDetail } from './brewGuide/copy.js';
import { APP_VERSION_LABEL } from './config/appVersion.js';
import { PerfectShotCelebration } from './components/PerfectShotCelebration.jsx';
import {
  isPerfectShot,
  PERFECT_SHOT_CELEBRATION_MS,
  PERFECT_SHOT_RECOMMENDATION_SCROLL_DELAY_MS,
  pickCameo,
} from './utils/perfectShot.js';
import {
  brewRatioOneDecimal,
  formatPerfectShotRatioLabel,
  scrollPerfectShotIntoView,
} from './utils/celebrationOverlap.js';
import { createLogoTapTester, nextLogoTestCelebrationVariant } from './utils/logoTapTester.js';
import { normalizeBrewAccessories } from './brewGuide/steps';
import { isBrewGuideExtractCountdownActive } from './brewGuide/brewGuideExtractPhase.js';
import { formatShotCount } from './utils/shotCountDisplay.js';
import { getAppTheme } from './theme';
import { Analytics } from '@vercel/analytics/react';
import { ScaleFlowChart } from './components/ScaleFlowChart.jsx';
import { ShotLabPressureIntegration } from './components/ShotLabPressureIntegration.jsx';
import { ShotLabPressureProvider } from './components/ShotLabPressureContext.jsx';
import { LabShotReplayScreen } from './components/LabShotReplayScreen.jsx';
import {
  loadLastLabShotReplayMeta,
  loadLastLabShotReplayWithBlob,
} from './flairPressureLab/labShotReplayDb.js';
import { shouldShowLabShotReplayPlay } from './flairPressureLab/historyLabShotReplay.js';
import { exportLabShotReplayDownloads } from './flairPressureLab/labShotReplayExport.js';
import { LabPressureStartPanel } from './components/LabPressureStartPanel.jsx';
import { LabPreShotDialUnderScale } from './components/LabPreShotDialUnderScale.jsx';
import { LabPressurePreShotConfirm } from './components/LabPressurePreShotConfirm.jsx';
import { ShotPressureChart } from './components/ShotPressureChart.jsx';
import {
  LAB_CAMERA_PRESSURE_KEY,
  LAB_GAUGE_TAP_CALIBRATION_KEY,
  LAB_PRESSURE_READER_KEY,
  LAB_PRESSURE_READER_LEGACY,
  isLabCameraPressureEnabled,
  labGaugeTapCalibrationFromSettings,
  labPressureReaderLegacy,
} from './settings/labCameraPressure.js';
import { LAB_PRESSURE_CAMERA_PREVIEW_KEY } from './flairPressureLab/shotLabPressureTrust.js';
import { shotTimerLabCompactClass } from './flairPressureLab/shotTimerCompactLayout.js';
import { isPressureSimAllowed } from './config/pressureSimFlag.js';
import { ScaleTimerControls } from './components/ScaleTimerControls.jsx';
import { WeighingView } from './components/WeighingView.jsx';
import { useTimemoreScale } from './scales/useTimemoreScale.js';
import { isScaleDebugActive, subscribeScaleDebug } from './scales/scaleDebug.js';
import {
  preinfusionAutoEndTargets,
  recipeDefinesPreinfusion,
  recipeUsesTimedPreinfusionAutoEnd,
  shouldAutoEndPreinfusion,
} from './scales/preinfusionAutoEnd.js';

function createDefaultFlairProfile() {
  return {
    preinfusionPressure: '',
    preinfusionTime: '',
    preinfusionEndTrigger: 'manual',
    peakPressure: '',
    peakEndYield: '',
    taperPressure: '',
    taperStartTrigger: 'weight',
  };
}

function createDefaultNewRecipe(grinderModel) {
  return {
    targetDoseG: 18,
    targetYieldG: '',
    targetTimeMinS: 27,
    targetTimeMaxS: 32,
    brewTemperatureC: defaultBrewTemperatureForGrinder(grinderModel),
    flairProfile: createDefaultFlairProfile(),
  };
}

function parseRecipeFloatField(raw) {
  if (raw === '' || raw === null || raw === undefined) return '';
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : '';
}

function parseRecipeIntField(raw) {
  if (raw === '' || raw === null || raw === undefined) return '';
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) ? n : '';
}

function recipeFieldDisplayValue(value) {
  if (value === '' || value === null || value === undefined) return '';
  if (typeof value === 'number' && Number.isNaN(value)) return '';
  return value;
}

function sanitizeRecipeFormState(recipe, grinderModel) {
  if (!recipe) return createDefaultNewRecipe(grinderModel);
  const next = { ...recipe };
  for (const key of ['targetDoseG', 'targetYieldG', 'targetTimeMinS', 'targetTimeMaxS', 'brewTemperatureC']) {
    next[key] = recipeFieldDisplayValue(next[key]);
  }
  return next;
}

const EXTRACTION_TIME_COLORS = {
  inRange: { bar: 'bg-[#8a9d72]', dot: 'bg-[#8a9d72]', label: 'text-[#9cb088]' },
  under: { bar: 'bg-[#c88a4b]', dot: 'bg-[#c88a4b]', label: 'text-[#d4a060]' },
  over: { bar: 'bg-[#b86b5c]', dot: 'bg-[#b86b5c]', label: 'text-[#c97868]' },
};

const TASTE_CHART_COLORS = {
  very_sour: 'bg-[#9a8a4a]',
  sour: 'bg-[#c4a04b]',
  balanced: 'bg-[#8a9d72]',
  bitter: 'bg-[#a67c52]',
  very_bitter: 'bg-[#b86b5c]',
};

function extractionTimeStatus(timeS, minT, maxT) {
  const t = Number(timeS) || 0;
  if (t >= minT && t <= maxT) return 'inRange';
  if (t < minT) return 'under';
  return 'over';
}

const EMPTY_SHOT_FIELD_HIGHLIGHTS = { dose: false, yield: false, time: false, taste: false };

const cachedGrindBootstrap = readCachedGrindBootstrapState();

function formatMissingShotFields(keys) {
  const labels = { dose: 'dose', yield: 'yield', time: 'time', taste: 'taste' };
  const parts = keys.map((key) => labels[key]);
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

function shotLogValidationMessage(missing) {
  if (missing.length === 1) {
    if (missing[0] === 'taste') return 'Taste profile selection is required.';
    if (missing[0] === 'dose') return 'Dose is required and must be a number.';
    if (missing[0] === 'yield') return 'Yield is required and must be a number.';
    return 'Extraction time is required and must be a number.';
  }
  const list = formatMissingShotFields(missing);
  return `${list.charAt(0).toUpperCase()}${list.slice(1)} are required.`;
}

function shotFieldAttentionClass(active) {
  return active ? 'ring-2 ring-[#c88a4b]/80 taste-attention-pulse' : '';
}

export default function App() {
  const [activeTab, setActiveTab] = useState('dial');
  const [darkMode, setDarkMode] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHowItWorksOpen, setIsHowItWorksOpen] = useState(false);
  const [expandedShotStatsIds, setExpandedShotStatsIds] = useState(() => new Set());

  const [perfectShotCelebration, setPerfectShotCelebration] = useState(null);
  const [chartType, setChartType] = useState('timeline');

  const [showPastBeans, setShowPastBeans] = useState(true);
  const [finishedSectionOpen, setFinishedSectionOpen] = useState(() => readBeansFinishedSectionOpen());
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [leaderboardFilter, setLeaderboardFilter] = useState('All');

  const beans = useLiveQuery(() => db.beans.toArray(), []) || [];
  const recipes = useLiveQuery(() => db.recipes.toArray(), []) || [];
  const shots = useLiveQuery(() => db.shots.orderBy('timestamp').reverse().toArray(), []) || [];
  const settingsQueryResult = useLiveQuery(() => db.settings.get('global'), [], SETTINGS_QUERY_PENDING);
  const settingsSetting =
    settingsQueryResult === SETTINGS_QUERY_PENDING ? null : (settingsQueryResult ?? null);
  const brewGuideEnabled = Boolean(settingsSetting?.brewGuideEnabled);
  const brewGuideSetupComplete = Boolean(settingsSetting?.brewGuideSetupComplete);
  const brewGuideAccessories = normalizeBrewAccessories(settingsSetting?.brewGuideAccessories);
  const brewGuidanceMode = normalizeBrewGuidanceMode(settingsSetting?.brewGuideGuidanceMode);
  const loggedShotCount = countLoggedShots(shots);
  const showBrewGuideIntro = brewGuideEnabled && shouldShowBrewGuideIntro(settingsSetting, loggedShotCount);
  const showBrewGraduationPrompt = brewGuideEnabled
    && shouldShowGraduationPrompt(settingsSetting, loggedShotCount);
  const statsForNerdsEnabled = settingsSetting?.statsForNerdsEnabled === true;
  const labCameraPressureEnabled = isLabCameraPressureEnabled(settingsSetting);
  const shotScreenWeightGoalsEnabled = isShotScreenWeightGoalsEnabled(settingsSetting);
  const devUrlSimScaleActive = isDevUrlSimScaleActive();
  const scaleFeatureEnabled = isSmartScaleIntegrationActive(settingsSetting) || devUrlSimScaleActive;
  const [scaleShotMetrics, setScaleShotMetrics] = useState(null);
  const [labPressureShotMetrics, setLabPressureShotMetrics] = useState(null);
  const labPressureMetricsGetterRef = useRef(() => ({}));
  const [shotCountdownValue, setShotCountdownValue] = useState(null);
  const [countdownHandoffPending, setCountdownHandoffPending] = useState(false);
  const shotCountdownStartOptsRef = useRef(null);
  const [weighingViewOpen, setWeighingViewOpen] = useState(false);
  const [labCalibrateRequest, setLabCalibrateRequest] = useState(0);
  const [labZeroConfirmOpen, setLabZeroConfirmOpen] = useState(false);
  const labZeroConfirmedSessionRef = useRef(false);
  const labPendingStartOptsRef = useRef(null);
  const labPressureOpenCalibrateRef = useRef(() => {});
  const labShotReplayCommitRef = useRef(null);
  const labShotReplayDiscardRef = useRef(null);
  /** Dial-in recommendation card source of truth at save time (see displayDynamicRec). */
  const displayedDialInRecRef = useRef(null);
  const [labReplayShotId, setLabReplayShotId] = useState(null);
  const [labReplayOpen, setLabReplayOpen] = useState(false);
  const [labReplayPayload, setLabReplayPayload] = useState(null);
  const [scaleDebugLines, setScaleDebugLines] = useState([]);
  const [yieldSettleActive, setYieldSettleActive] = useState(false);
  const [frozenShotWeightG, setFrozenShotWeightG] = useState(null);
  const yieldSettleUserEditedRef = useRef(false);
  const yieldSettleTimerRef = useRef(null);
  const activeTabRef = useRef(activeTab);
  const activeBeansCountRef = useRef(0);
  const logoTapTesterRef = useRef(null);
  const clearPerfectShotCelebration = useCallback(() => {
    setPerfectShotCelebration(null);
  }, []);
  const triggerPerfectShotCelebration = useCallback((variant, showYieldRing, snapshot = null) => {
    setPerfectShotCelebration({ variant, showYieldRing, snapshot });
  }, []);
  const [basketChangePromptOpen, setBasketChangePromptOpen] = useState(false);
  const [pendingBasketAdjustment, setPendingBasketAdjustment] = useState(null);
  const [appliedRecommendationDisplay, setAppliedRecommendationDisplay] = useState(null);
  const appSettings = settingsSetting;

  const [selectedBeanId, setSelectedBeanId] = useState('');
  const [historyFilterBeanId, setHistoryFilterBeanId] = useState('all');
  const [finishUndoToast, setFinishUndoToast] = useState(null);
  const finishUndoTimerRef = useRef(null);
  
  // Timer State
  const [timerRunning, setTimerRunning] = useState(false);
  const [brewTimerHost, setBrewTimerHost] = useState(false);
  const [timerTicks, setTimerTicks] = useState(0);
  const timerSeconds = timerTicks / 10;
  const [usePreInfusion, setUsePreInfusion] = useState(false);
  const [preInfusionPhase, setPreInfusionPhase] = useState(false);
  const [preInfusionSeconds, setPreInfusionSeconds] = useState(0);

  // Editing State
  const [isEditingBean, setIsEditingBean] = useState(false);

  const [newBean, setNewBean] = useState({ 
    name: '', 
    roaster: '', 
    roastType: 'Medium', 
    roastDate: '', 
    storageType: 'bag', 
    postThawStorage: 'bag',
    freezeDate: '', 
    thawDate: '',
    thawHistory: [],
    rating: '',
    isFinished: false,
    isDecaf: false
  });
  
  const [newRecipe, setNewRecipe] = useState(() => createDefaultNewRecipe(''));

  const [grinderModel, setGrinderModel] = useState(() => cachedGrindBootstrap?.grinderModel || '');
  const [flairEnabled, setFlairEnabled] = useState(false);

  const [setteMacro, setSetteMacro] = useState(() => cachedGrindBootstrap?.grindUi?.setteMacro ?? 13);
  const [setteMicro, setSetteMicro] = useState(() => cachedGrindBootstrap?.grindUi?.setteMicro ?? 'E');
  const [sunbeamSetting, setSunbeamSetting] = useState(
    () => cachedGrindBootstrap?.grindUi?.sunbeamSetting ?? 15
  );
  const [nicheZeroSetting, setNicheZeroSetting] = useState(
    () => cachedGrindBootstrap?.grindUi?.nicheZeroSetting ?? 15
  );
  const [customGrindValue, setCustomGrindValue] = useState(
    () => cachedGrindBootstrap?.grindUi?.customGrindValue ?? null
  );
  const [wasPurged, setWasPurged] = useState(true);
  const [actualDoseG, setActualDoseG] = useState(18);
  const [actualYieldG, setActualYieldG] = useState('');
  const [actualTimeS, setActualTimeS] = useState('');
  const [tasteProfile, setTasteProfile] = useState('');
  const [shotRating, setShotRating] = useState(null);
  const [notes, setNotes] = useState('');
  const [excludeFromLearning, setExcludeFromLearning] = useState(false);
  const [knownIssueReason, setKnownIssueReason] = useState('puck_prep');

  const doseInputRef = useRef(null);
  const timeInputRef = useRef(null);
  const yieldInputRef = useRef(null);
  const notesCardRef = useRef(null);
  const tasteInputRef = useRef(null);
  const actualDoseGRef = useRef(actualDoseG);
  const actualYieldGRef = useRef(actualYieldG);
  const recommendationRef = useRef(null);
  const grindSettingsRef = useRef(null);
  const flairPressureProfileRef = useRef(null);
  const pendingFocusFlairProfileRef = useRef(false);
  const pendingGrindByKeyRef = useRef({});
  const lastSeenPersistedGrindByKeyRef = useRef({});
  const brewTempDefaultRef = useRef('');
  const syncedSettingsCustomGrinderRef = useRef('');
  const [validationError, setValidationError] = useState('');
  const [beanFieldErrors, setBeanFieldErrors] = useState({});
  const [applyRecConfirmation, setApplyRecConfirmation] = useState('');
  const [csvImportSummary, setCsvImportSummary] = useState('');
  const csvImportInputRef = useRef(null);
  const [highlightGrind, setHighlightGrind] = useState(false);
  const [shotFieldHighlights, setShotFieldHighlights] = useState(EMPTY_SHOT_FIELD_HIGHLIGHTS);
  const [setupBrewGuideEnabled, setSetupBrewGuideEnabled] = useState(true);
  const [setupFlairEnabled, setSetupFlairEnabled] = useState(false);
  const [setupPreInfusionEnabled, setSetupPreInfusionEnabled] = useState(false);
  const [setupGrinderPickerValue, setSetupGrinderPickerValue] = useState('');
  const [setupCustomGrinderDraft, setSetupCustomGrinderDraft] = useState({
    name: '',
    dialType: 'stepped',
    min: 1,
    max: 40,
    step: 1,
    lowerIsFiner: true,
  });
  const [setupUseSmartScale, setSetupUseSmartScale] = useState(false);
  const [setupSmartScaleDeviceId, setSetupSmartScaleDeviceId] = useState(SMART_SCALE_MANUAL_ID);
  const [settingsGrinderPickerValue, setSettingsGrinderPickerValue] = useState('');
  const [settingsCustomGrinderDraft, setSettingsCustomGrinderDraft] = useState(null);
  const lastPersistedGrinderModelRef = useRef(null);
  const [brewAccessoriesOpenRequest, setBrewAccessoriesOpenRequest] = useState(0);
  const [brewAccessoriesReturnTo, setBrewAccessoriesReturnTo] = useState('brew');

  useEffect(() => {
    if (settingsSetting?.id === 'global') {
      writeCachedGlobalSettings(settingsSetting);
    }
  }, [settingsSetting]);

  useEffect(() => {
    if (settingsSetting) {
      queueMicrotask(() => {
      setSettingsGrinderPickerValue(grinderPickerValueForSettings(settingsSetting));
      if (settingsSetting.customGrinderSetupDraft) {
        setSettingsCustomGrinderDraft(settingsSetting.customGrinderSetupDraft);
      } else if (settingsSetting.customGrinder) {
        setSettingsCustomGrinderDraft(settingsSetting.customGrinder);
      }
      const persistedGrinderModel = settingsSetting.grinderModel;
      const grinderModelChanged =
        lastPersistedGrinderModelRef.current === null
        || persistedGrinderModel !== lastPersistedGrinderModelRef.current;
      let grinderModelFromSettings =
        grinderModel || resolveActiveGrinderModel(settingsSetting);
      if (grinderModelChanged) {
        lastPersistedGrinderModelRef.current = persistedGrinderModel;
        grinderModelFromSettings =
          persistedGrinderModel !== null
          && persistedGrinderModel !== undefined
          && persistedGrinderModel !== ''
            ? persistedGrinderModel
            : resolveActiveGrinderModel(settingsSetting);
        if (grinderModelFromSettings) {
          setGrinderModel(grinderModelFromSettings);
        }
      }
      if (grinderModelFromSettings && !isEditingBean && brewTempDefaultRef.current !== grinderModelFromSettings) {
        brewTempDefaultRef.current = grinderModelFromSettings;
        const nextTemp = defaultBrewTemperatureForGrinder(grinderModelFromSettings);
        setNewRecipe((prev) => {
          const current = prev.brewTemperatureC;
          const isUnset = current === '' || current === null || current === undefined;
          const isFactoryDefault = current === 92 || current === 93;
          if (!isUnset && !isFactoryDefault) return prev;
          return current === nextTemp ? prev : { ...prev, brewTemperatureC: nextTemp };
        });
      }
      if (settingsSetting.flairEnabled !== undefined) setFlairEnabled(settingsSetting.flairEnabled);
      if (settingsSetting.preInfusionEnabled !== undefined) setUsePreInfusion(settingsSetting.preInfusionEnabled);
      if (settingsSetting.darkMode !== undefined) setDarkMode(settingsSetting.darkMode);
      if (isCustomGrinderModel(grinderModelFromSettings, settingsSetting)) {
        if (syncedSettingsCustomGrinderRef.current !== grinderModelFromSettings) {
          syncedSettingsCustomGrinderRef.current = grinderModelFromSettings;
        }
      }
      });
    }
  }, [settingsSetting, isEditingBean]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
    document.body.style.backgroundColor = darkMode ? '#121110' : '#ebe6dc';
    document.body.style.color = darkMode ? '#f5f2eb' : '#2a261f';
  }, [darkMode]);

  useEffect(() => {
    actualDoseGRef.current = actualDoseG;
    actualYieldGRef.current = actualYieldG;
  }, [actualDoseG, actualYieldG]);

  useEffect(() => {
    logoTapTesterRef.current = createLogoTapTester({
      onTrigger: () => {
        const variant = nextLogoTestCelebrationVariant();
        const showYieldRing =
          activeTabRef.current === 'dial' && activeBeansCountRef.current > 0;
        const dose = parseFloat(actualDoseGRef.current);
        const yld = parseFloat(actualYieldGRef.current);
        const snapshot =
          showYieldRing && Number.isFinite(dose) && Number.isFinite(yld) && yld > 0
            ? { doseG: dose, yieldG: yld }
            : null;
        triggerPerfectShotCelebration(variant, showYieldRing, snapshot);
      },
    });
  }, [triggerPerfectShotCelebration]);

  useEffect(() => {
    if (!perfectShotCelebration) return undefined;
    const reduced =
      typeof window !== 'undefined'
      && window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    queueMicrotask(() => {
      scrollPerfectShotIntoView({
        yieldEl: yieldInputRef.current,
        notesEl: notesCardRef.current,
        reducedMotion: reduced,
      });
    });
    return undefined;
  }, [perfectShotCelebration]);

  const activeBeansList = beans.filter(b => !b?.isFinished);
  activeTabRef.current = activeTab;
  activeBeansCountRef.current = activeBeansList.length;
  const effectiveBeanId = (() => {
    if (selectedBeanId && beans.some((b) => b.id === selectedBeanId)) return selectedBeanId;
    const remembered = settingsSetting?.lastSelectedBeanId;
    if (remembered) {
      const match =
        beans.find((b) => b.id === remembered && !b?.isFinished)
        || beans.find((b) => b.id === remembered);
      if (match) return match.id;
    }
    return activeBeansList[0]?.id || beans[0]?.id || '';
  })();
  const activeBean = beans.find(b => b.id === effectiveBeanId) || activeBeansList[0] || beans[0];
  const beanShots = shots.filter(s => s.beanId === activeBean?.id);
  const storedRecipe = recipes.find(r => r.beanId === activeBean?.id);
  const activeRecipe = resolveRecipeForBean(activeBean, storedRecipe, beanShots, grinderModel);
  const lastLoggedShot = findLatestShotForBeanAndGrinder(shots, activeBean?.id, grinderModel);
  const lastLearningShot = activeBean && grinderModel
    ? shots.find(
        (s) =>
          s.beanId === activeBean.id
          && shotEligibleForLearning(s)
          && shotMatchesGrinderForLearning(s, grinderModel)
      )
    : null;

  const scaleRecipePreinfusion =
    flairEnabled && recipeDefinesPreinfusion(activeRecipe?.flairProfile);
  const hookUsePreInfusion = usePreInfusion || (scaleFeatureEnabled && scaleRecipePreinfusion);

  const timemoreScale = useTimemoreScale({
    enabled: scaleFeatureEnabled,
    scaleDeviceId: normalizeSmartScaleDeviceId(settingsSetting?.smartScaleDeviceId),
    targetYieldG: activeRecipe?.targetYieldG || 36,
    usePreInfusion: hookUsePreInfusion,
    preInfusionDurationS: hookUsePreInfusion
      ? Number(activeRecipe?.flairProfile?.preinfusionTime) || 12
      : 0,
  });

  const preinfusionScaleCtx = {
    scaleFeatureEnabled,
    scaleConnected: timemoreScale.isConnected,
  };
  const flairTimedPreinfusionAuto =
    recipeUsesTimedPreinfusionAutoEnd(activeRecipe?.flairProfile, flairEnabled, preinfusionScaleCtx);
  const timerUsePreInfusion =
    usePreInfusion
    || (timemoreScale.isConnected && scaleRecipePreinfusion)
    || flairTimedPreinfusionAuto;
  const scaleAutoEndPreinfusionRef = useRef(false);
  const flowAutoStopStateRef = useRef(createFlowEndAutoStopState());
  const [flowAutoStopTimerFrozen, setFlowAutoStopTimerFrozen] = useState(false);
  const [brewGuideTimerActive, setBrewGuideTimerActive] = useState(false);
  const brewGuideTimerActiveRef = useRef(false);
  const syncBrewGuideTimerActive = (active) => {
    brewGuideTimerActiveRef.current = active;
    setBrewGuideTimerActive(active);
  };
  const profilePreinfusionTimeS = Number(activeRecipe?.flairProfile?.preinfusionTime) || 0;
  const flowChartTimeOffsetSec = timerUsePreInfusion ? Math.max(profilePreinfusionTimeS, 4) : 0;
  const scaleLiveFlowOnProfile =
    scaleFeatureEnabled && timemoreScale.isConnected && timerRunning
      ? timemoreScale.liveFlowSeries
      : null;

  const prefillDoseFromRecipe = (recipe) => {
    if (recipe?.targetDoseG == null || recipe.targetDoseG === '') return;
    setActualDoseG(recipe.targetDoseG);
  };

  useEffect(() => {
    if (weighingViewOpen && !timemoreScale.isConnected) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- close weighing view when scale drops
      setWeighingViewOpen(false);
    }
  }, [weighingViewOpen, timemoreScale.isConnected]);

  useEffect(() => {
    if (!isScaleDebugActive()) return undefined;
    return subscribeScaleDebug(setScaleDebugLines);
  }, []);

  const brewRatio = actualDoseG > 0 && actualYieldG > 0 ? (parseFloat(actualYieldG) / parseFloat(actualDoseG)).toFixed(1) : '0.0';
  const perfectShotSnapshot = perfectShotCelebration?.snapshot;
  const perfectShotYieldRing = Boolean(perfectShotCelebration?.showYieldRing);
  const yieldTileCelebrating = perfectShotYieldRing && perfectShotSnapshot;
  const yieldDisplayValue = yieldTileCelebrating
    ? perfectShotSnapshot.yieldG
    : actualYieldG;
  const yieldRatioLine = yieldTileCelebrating
    ? formatPerfectShotRatioLabel(
        brewRatioOneDecimal(perfectShotSnapshot.doseG, perfectShotSnapshot.yieldG),
      )
    : `1:${brewRatio}`;

  // Timer Logic (0.1s resolution for mobile fullscreen display)
  useEffect(() => {
    if (!timerRunning || flowAutoStopTimerFrozen) return undefined;
    const interval = setInterval(() => {
      setTimerTicks((t) => t + 1);
    }, 100);
    return () => clearInterval(interval);
  }, [timerRunning, flowAutoStopTimerFrozen]);

  const resetFlowAutoStop = useCallback(() => {
    flowAutoStopStateRef.current = createFlowEndAutoStopState();
    setFlowAutoStopTimerFrozen(false);
  }, []);

  useEffect(() => {
    if (!timerRunning || !preInfusionPhase) {
      if (!timerRunning) scaleAutoEndPreinfusionRef.current = false;
      return;
    }
    if (!timerUsePreInfusion) return;
    const scaleConnected = timemoreScale.isConnected;
    const targets = preinfusionAutoEndTargets(activeRecipe?.flairProfile, preinfusionScaleCtx);
    if (targets.trigger === 'manual') return;
    if (targets.trigger === 'weight' && !scaleConnected) return;
    if (targets.trigger === 'weight' && !timemoreScale.weightTriggersPrimed) return;
    if (targets.timeS == null && targets.weightG == null) return;
    if (scaleAutoEndPreinfusionRef.current) return;
    if (
      !shouldAutoEndPreinfusion(targets, {
        preInfusionElapsedS: timerSeconds,
        liveRelativeWeightG: timemoreScale.liveRelativeWeightG,
      })
    ) {
      return;
    }
    scaleAutoEndPreinfusionRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- auto end at recipe time/weight
    setPreInfusionSeconds(timerSeconds);
    setPreInfusionPhase(false);
    if (scaleConnected) {
      void timemoreScale.notifyPreInfusionEnded();
    }
  }, [
    timerRunning,
    preInfusionPhase,
    timerSeconds,
    timemoreScale.isConnected,
    timemoreScale.liveRelativeWeightG,
    timemoreScale.weightTriggersPrimed,
    timerUsePreInfusion,
    preinfusionScaleCtx,
    activeRecipe?.flairProfile,
    scaleFeatureEnabled,
    timemoreScale,
  ]);

  const formatTime = (totalSeconds) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = Math.floor(totalSeconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const formatTimerLive = (totalSeconds) => {
    const whole = Math.floor(totalSeconds);
    const mins = Math.floor(whole / 60);
    const secs = whole % 60;
    const tenths = Math.floor((totalSeconds - whole) * 10);
    if (mins > 0) {
      return `${mins}:${String(secs).padStart(2, '0')}.${tenths}`;
    }
    return `0:${String(secs).padStart(2, '0')}.${tenths}`;
  };

  const releaseBrewGuideTimer = useCallback(() => {
    if (!brewGuideTimerActiveRef.current) return;
    syncBrewGuideTimerActive(false);
    scaleAutoEndPreinfusionRef.current = false;
    setTimerRunning(false);
    setTimerTicks(0);
    setPreInfusionSeconds(0);
    setPreInfusionPhase(false);
    if (timemoreScale.isConnected) {
      void timemoreScale.notifyShotCancelled();
    }
  }, [timemoreScale]);

  const handleStartTimer = async ({ fromBrewGuide = false, tareAlreadyDone = false } = {}) => {
    setWeighingViewOpen(false);
    if (fromBrewGuide) syncBrewGuideTimerActive(true);
    else syncBrewGuideTimerActive(false);
    scaleAutoEndPreinfusionRef.current = false;
    resetFlowAutoStop();
    setFrozenShotWeightG(null);
    setTimerTicks(0);
    setPreInfusionSeconds(0);
    if (timemoreScale.isConnected) {
      setScaleShotMetrics(null);
      await timemoreScale.notifyShotStarted({ tareAlreadyDone });
    }
    setLabPressureShotMetrics(null);
    if (timerUsePreInfusion) setPreInfusionPhase(true);
    else setPreInfusionPhase(false);
    setTimerRunning(true);
  };

  const cancelShotCountdown = useCallback(() => {
    const opts = shotCountdownStartOptsRef.current;
    setShotCountdownValue(null);
    setCountdownHandoffPending(false);
    shotCountdownStartOptsRef.current = null;
    if (timemoreScale.isConnected) {
      void timemoreScale.notifyShotCancelled();
    }
    if (opts?.fromBrewGuide) {
      syncBrewGuideTimerActive(false);
      scaleAutoEndPreinfusionRef.current = false;
      setTimerRunning(false);
      setTimerTicks(0);
      setPreInfusionSeconds(0);
      setPreInfusionPhase(false);
    }
  }, [timemoreScale]);

  const requestStartTimer = useCallback(
    (opts = {}) => {
      if (shotCountdownValue != null || timerRunning) return;
      const useCountdown = isShotStartCountdownActive(
        appSettings?.shotStartCountdown,
        flairEnabled
      );
      if (!useCountdown) {
        void handleStartTimer(opts);
        return;
      }
      if (opts.fromBrewGuide) {
        syncBrewGuideTimerActive(true);
        scaleAutoEndPreinfusionRef.current = false;
        setTimerRunning(false);
        setTimerTicks(0);
        setPreInfusionSeconds(0);
        setPreInfusionPhase(false);
      }
      shotCountdownStartOptsRef.current = opts;
      setShotCountdownValue(3);
      if (timemoreScale.isConnected) {
        void timemoreScale.notifyShotCountdownPrepare();
      }
    },
    [shotCountdownValue, timerRunning, appSettings?.shotStartCountdown, flairEnabled, timemoreScale]
  );

  useEffect(() => {
    if (shotCountdownValue == null) return undefined;
    if (shotCountdownValue <= 0) {
      const opts = shotCountdownStartOptsRef.current || {};
      shotCountdownStartOptsRef.current = null;
      setCountdownHandoffPending(true);
      setShotCountdownValue(null);
      void handleStartTimer({ ...opts, tareAlreadyDone: true });
      return undefined;
    }
    const tick = window.setTimeout(() => {
      setShotCountdownValue((v) => (v != null && v > 0 ? v - 1 : v));
    }, 1000);
    return () => window.clearTimeout(tick);
  }, [shotCountdownValue]);

  useEffect(() => {
    if (timerRunning && countdownHandoffPending) {
      setCountdownHandoffPending(false);
    }
  }, [timerRunning, countdownHandoffPending]);

  const handleEndPreInfusion = () => {
    setPreInfusionSeconds(timerSeconds);
    setPreInfusionPhase(false);
    if (timemoreScale.isConnected) {
      void timemoreScale.notifyPreInfusionEnded();
    }
  };

  const clearYieldSettleTimer = useCallback(() => {
    if (yieldSettleTimerRef.current) {
      window.clearTimeout(yieldSettleTimerRef.current);
      yieldSettleTimerRef.current = null;
    }
  }, []);

  const finalizeYieldSettle = useCallback(() => {
    clearYieldSettleTimer();
    setYieldSettleActive(false);
    if (timemoreScale.isConnected) {
      const { yieldG, metrics } = timemoreScale.finalizeShotYieldSettle();
      if (!yieldSettleUserEditedRef.current && yieldG != null && yieldG > 0) {
        setActualYieldG(String(yieldG));
        setFrozenShotWeightG(yieldG);
      } else {
        setFrozenShotWeightG(null);
      }
      setScaleShotMetrics(metrics);
    } else {
      setFrozenShotWeightG(null);
    }
    yieldSettleUserEditedRef.current = false;
  }, [clearYieldSettleTimer, timemoreScale]);

  useEffect(() => {
    if (
      !timerRunning
      || !timemoreScale.isConnected
      || !normalizeScaleFlowAutoStopEnabled(settingsSetting?.scaleFlowAutoStopEnabled)
    ) {
      if (!timerRunning) resetFlowAutoStop();
      return;
    }
    const series = timemoreScale.liveFlowSeries;
    if (!series.length) return;

    const smoothed = smoothFlowSeriesForPlot(series);
    const last = smoothed[smoothed.length - 1];
    flowAutoStopStateRef.current = stepFlowEndAutoStop(flowAutoStopStateRef.current, {
      enabled: true,
      preinfusionActive: preInfusionPhase,
      extractionActive: !preInfusionPhase,
      tExtractionS: last.tS,
      smoothedFlowGs: last.flowGs,
    });

    const autoState = flowAutoStopStateRef.current;
    if (flowEndAutoStopShouldFreezeTimer(autoState)) {
      const endExtractionS = flowEndAutoStopRecordedEndExtractionS(autoState);
      if (endExtractionS != null) {
        setFlowAutoStopTimerFrozen(true);
        const totalS = timerUsePreInfusion ? preInfusionSeconds + endExtractionS : endExtractionS;
        setTimerTicks(Math.round(totalS * 10));
      }
    } else if (flowAutoStopTimerFrozen && !flowEndAutoStopShouldStop(autoState)) {
      setFlowAutoStopTimerFrozen(false);
      const totalS = timerUsePreInfusion ? preInfusionSeconds + last.tS : last.tS;
      setTimerTicks(Math.round(totalS * 10));
    }

    if (!flowEndAutoStopShouldStop(autoState)) return;

    const endExtractionS = flowEndAutoStopRecordedEndExtractionS(autoState);
    resetFlowAutoStop();
    if (endExtractionS == null) return;

    if (labCameraPressureEnabled) {
      try {
        const labMetrics = labPressureMetricsGetterRef.current?.() ?? {};
        setLabPressureShotMetrics(
          labMetrics?.labPressureCurve?.length ? labMetrics : null
        );
      } catch {
        setLabPressureShotMetrics(null);
      }
    }
    setTimerRunning(false);
    const rounded = Math.round(endExtractionS);
    setActualTimeS(rounded);
    if (timerUsePreInfusion) {
      const totalS = preInfusionSeconds + endExtractionS;
      setTimerTicks(Math.round(totalS * 10));
    } else {
      setTimerTicks(Math.round(endExtractionS * 10));
    }
    clearYieldSettleTimer();
    yieldSettleUserEditedRef.current = false;
    const began = timemoreScale.notifyShotYieldSettleBegin();
    if (began) {
      setYieldSettleActive(true);
      yieldSettleTimerRef.current = window.setTimeout(() => {
        finalizeYieldSettle();
      }, SHOT_YIELD_SETTLE_MS);
    } else {
      const { yieldG, metrics } = timemoreScale.notifyShotStopped();
      if (yieldG != null && yieldG > 0) {
        setActualYieldG(String(yieldG));
      }
      setScaleShotMetrics(metrics);
    }
  }, [
    timerRunning,
    preInfusionPhase,
    timerUsePreInfusion,
    preInfusionSeconds,
    timemoreScale.isConnected,
    timemoreScale.liveFlowSeries,
    flowAutoStopTimerFrozen,
    settingsSetting?.scaleFlowAutoStopEnabled,
    timemoreScale,
    resetFlowAutoStop,
    clearYieldSettleTimer,
    finalizeYieldSettle,
    labCameraPressureEnabled,
  ]);

  const handleStopTimer = () => {
    resetFlowAutoStop();
    if (labCameraPressureEnabled) {
      try {
        const labMetrics = labPressureMetricsGetterRef.current?.() ?? {};
        setLabPressureShotMetrics(
          labMetrics?.labPressureCurve?.length ? labMetrics : null
        );
      } catch {
        setLabPressureShotMetrics(null);
      }
    }
    setTimerRunning(false);
    let finalExtractionTime = timerSeconds;
    if (timerUsePreInfusion && !preInfusionPhase) {
      finalExtractionTime = Math.max(0, timerSeconds - preInfusionSeconds);
    }
    const rounded = Math.round(finalExtractionTime);
    setActualTimeS(rounded);
    if (timemoreScale.isConnected) {
      clearYieldSettleTimer();
      yieldSettleUserEditedRef.current = false;
      const began = timemoreScale.notifyShotYieldSettleBegin();
      if (began) {
        setYieldSettleActive(true);
        yieldSettleTimerRef.current = window.setTimeout(() => {
          finalizeYieldSettle();
        }, SHOT_YIELD_SETTLE_MS);
      } else {
        const { yieldG, metrics } = timemoreScale.notifyShotStopped();
        if (yieldG != null && yieldG > 0) {
          setActualYieldG(String(yieldG));
        }
        setScaleShotMetrics(metrics);
      }
    }
    return rounded;
  };

  useEffect(() => () => clearYieldSettleTimer(), [clearYieldSettleTimer]);

  useEffect(() => {
    if (!yieldSettleActive) return;
    timemoreScale.recordYieldSettleSample();
  }, [yieldSettleActive, timemoreScale.liveRelativeWeightG, timemoreScale]);

  const handleCancelTimer = () => {
    cancelShotCountdown();
    clearYieldSettleTimer();
    setYieldSettleActive(false);
    setFrozenShotWeightG(null);
    yieldSettleUserEditedRef.current = false;
    scaleAutoEndPreinfusionRef.current = false;
    resetFlowAutoStop();
    setTimerRunning(false);
    setTimerTicks(0);
    setPreInfusionSeconds(0);
    setPreInfusionPhase(false);
    if (timemoreScale.isConnected) {
      void timemoreScale.notifyShotCancelled();
    }
    setLabPressureShotMetrics(null);
    labShotReplayDiscardRef.current?.();
  };

  const handleResetTimer = () => {
    cancelShotCountdown();
    setFrozenShotWeightG(null);
    resetFlowAutoStop();
    scaleAutoEndPreinfusionRef.current = false;
    setTimerRunning(false);
    setTimerTicks(0);
    setPreInfusionSeconds(0);
    setPreInfusionPhase(false);
    if (timemoreScale.isConnected) {
      void timemoreScale.notifyShotCancelled();
    }
    labShotReplayDiscardRef.current?.();
  };

  const handleTimerSurfaceTap = (e) => {
    if (e.target.closest('[data-timer-dismiss]')) return;
    if (timerUsePreInfusion && preInfusionPhase) handleEndPreInfusion();
    else handleStopTimer();
  };

  const stashPendingGrind = (model, beanId, grindFields) => {
    const key = pendingGrindSessionKey(beanId, model);
    const snap = capturePendingGrindState(model, grindFields, appSettings);
    if (key && snap) pendingGrindByKeyRef.current[key] = snap;
  };

  const clearPendingGrind = (beanId, model) => {
    const key = pendingGrindSessionKey(beanId, model);
    if (key) delete pendingGrindByKeyRef.current[key];
  };

  const persistGrindUiToSettings = async (model, uiSnapshot) => {
    if (!activeBean?.id || !model || !uiSnapshot) return;
    await patchGlobalSettings(db, (currentSettings) =>
      patchGrindUiForBeanGrinder(currentSettings, activeBean.id, model, uiSnapshot)
    );
  };

  const handleSetteMacroChange = (value) => {
    setSetteMacro(value);
    const snap = grindUiSnapshotFromControls({
      setteMacro: value,
      setteMicro,
      sunbeamSetting,
      nicheZeroSetting,
      customGrindValue,
    });
    stashPendingGrind(grinderModel, activeBean?.id, snap);
    void persistGrindUiToSettings(grinderModel, snap);
  };

  const handleSetteMicroChange = (value) => {
    setSetteMicro(value);
    const snap = grindUiSnapshotFromControls({
      setteMacro,
      setteMicro: value,
      sunbeamSetting,
      nicheZeroSetting,
      customGrindValue,
    });
    stashPendingGrind(grinderModel, activeBean?.id, snap);
    void persistGrindUiToSettings(grinderModel, snap);
  };

  const handleSunbeamChange = (value) => {
    setSunbeamSetting(value);
    const snap = grindUiSnapshotFromControls({
      setteMacro,
      setteMicro,
      sunbeamSetting: value,
      nicheZeroSetting,
      customGrindValue,
    });
    stashPendingGrind(grinderModel, activeBean?.id, snap);
    void persistGrindUiToSettings(grinderModel, snap);
  };

  const handleNicheZeroChange = (value) => {
    setNicheZeroSetting(value);
    const snap = grindUiSnapshotFromControls({
      setteMacro,
      setteMicro,
      sunbeamSetting,
      nicheZeroSetting: value,
      customGrindValue,
    });
    stashPendingGrind(grinderModel, activeBean?.id, snap);
    void persistGrindUiToSettings(grinderModel, snap);
  };

  const handleCustomGrindChange = (value) => {
    setCustomGrindValue(value);
    const snap = grindUiSnapshotFromControls({
      setteMacro,
      setteMicro,
      sunbeamSetting,
      nicheZeroSetting,
      customGrindValue: value,
    });
    stashPendingGrind(grinderModel, activeBean?.id, snap);
    void persistGrindUiToSettings(grinderModel, snap);
  };

  useEffect(() => {
    if (!activeBean || !grinderModel) return;
    const uiState = resolveGrindControlUiStateWithPending({
      pendingGrindByKey: pendingGrindByKeyRef.current,
      lastSeenPersistedGrindByKey: lastSeenPersistedGrindByKeyRef.current,
      grinderModel,
      shots,
      activeBean,
      recipes,
      beans,
      mockDate: null,
      flairEnabled,
      settings: appSettings,
    });
    if (!uiState) return;
    if (uiState.setteMacro != null) setSetteMacro(uiState.setteMacro);
    if (uiState.setteMicro != null) setSetteMicro(uiState.setteMicro);
    if (uiState.sunbeamSetting != null) setSunbeamSetting(uiState.sunbeamSetting);
    if (uiState.nicheZeroSetting != null) setNicheZeroSetting(uiState.nicheZeroSetting);
    if (uiState.customGrindValue != null) setCustomGrindValue(uiState.customGrindValue);
  }, [
    effectiveBeanId,
    activeBean,
    grinderModel,
    beans,
    flairEnabled,
    recipes,
    shots,
    grindSettingsRestoreDeps(settingsSetting, effectiveBeanId, grinderModel),
  ]);

  const handleSaveGrinderSetup = async (modelOrPicker, options = {}) => {
    const {
      brewGuideEnabled: brewGuideChoice,
      flairEnabled: flairChoice,
      preInfusionEnabled: preInfusionChoice,
      customGrinder: customGrinderChoice,
      smartScaleDeviceId: smartScaleChoice,
    } = options;

    let model = modelOrPicker;
    let customGrinderPatch = {};
    if (modelOrPicker === CUSTOM_GRINDER_PICKER_ID) {
      const normalized = normalizeCustomGrinderProfile(customGrinderChoice);
      if (!normalized) return;
      model = normalized.name;
      customGrinderPatch = { customGrinder: normalized };
    } else if (!isCustomGrinderModel(modelOrPicker, { grinderModel: modelOrPicker, customGrinder: customGrinderChoice })) {
      customGrinderPatch = { customGrinder: undefined };
    }

    setGrinderModel(model);
    if (!isEditingBean) {
      brewTempDefaultRef.current = model;
      const nextTemp = defaultBrewTemperatureForGrinder(model);
      setNewRecipe((prev) => {
        const current = prev.brewTemperatureC;
        const isUnset = current === '' || current === null || current === undefined;
        const isFactoryDefault = current === 92 || current === 93;
        if (!isUnset && !isFactoryDefault) return prev;
        return current === nextTemp ? prev : { ...prev, brewTemperatureC: nextTemp };
      });
    }
    const currentSettings = (await db.settings.get('global')) || { id: 'global' };
    if (isPresetGrinderModel(model) && activeBean?.id) {
      const spec = getPresetGrinderSpec(model);
      const persisted = getGrindUiForBeanGrinder(currentSettings, activeBean.id, model);
      if (spec) {
        const defaultVal = defaultPresetGrindValue(spec, currentSettings);
        const persistedVal = persisted?.customGrindValue ?? defaultVal;
        const nextVal =
          resolveEffectiveZeroOffsetPresetDial(
            persistedVal,
            spec,
            currentSettings,
            false
          ) ?? persistedVal;
        setCustomGrindValue(nextVal);
      }
    }
    if (typeof flairChoice === 'boolean') setFlairEnabled(flairChoice);
    if (typeof preInfusionChoice === 'boolean') setUsePreInfusion(preInfusionChoice);
    await patchGlobalSettings(db, (row) => {
      const patch = {
        grinderModel: model,
        grinderPickerSelection:
          modelOrPicker === CUSTOM_GRINDER_PICKER_ID ? CUSTOM_GRINDER_PICKER_ID : undefined,
        customGrinderSetupDraft:
          modelOrPicker === CUSTOM_GRINDER_PICKER_ID
            ? customGrinderChoice ?? row.customGrinderSetupDraft
            : undefined,
        ...customGrinderPatch,
        ...(typeof brewGuideChoice === 'boolean' ? { brewGuideEnabled: brewGuideChoice } : {}),
        ...(typeof flairChoice === 'boolean' ? { flairEnabled: flairChoice } : {}),
        ...(typeof preInfusionChoice === 'boolean' ? { preInfusionEnabled: preInfusionChoice } : {}),
        ...(smartScaleChoice !== undefined
          ? { smartScaleDeviceId: normalizeSmartScaleDeviceId(smartScaleChoice) }
          : {}),
      };
      return patch;
    });
  };

  const handleFinishFirstLaunch = async () => {
    const scaleId = setupUseSmartScale
      ? normalizeSmartScaleDeviceId(setupSmartScaleDeviceId)
      : SMART_SCALE_MANUAL_ID;
    await handleSaveGrinderSetup(setupGrinderPickerValue || CUSTOM_GRINDER_PICKER_ID, {
      brewGuideEnabled: setupBrewGuideEnabled,
      flairEnabled: setupFlairEnabled,
      preInfusionEnabled: setupPreInfusionEnabled,
      customGrinder: setupCustomGrinderDraft,
      smartScaleDeviceId: scaleId,
    });
  };

  const persistCustomGrinderSetupDraft = async (draft) => {
    await patchGlobalSettings(db, () => {
      const patch = {
        grinderPickerSelection: CUSTOM_GRINDER_PICKER_ID,
        customGrinderSetupDraft: draft ?? null,
      };
      if (isCustomGrinderFormValid(draft)) {
        const normalized = normalizeCustomGrinderSettingsPatch(draft);
        if (normalized) {
          Object.assign(patch, normalized);
          setGrinderModel(normalized.grinderModel);
        }
      }
      return patch;
    });
  };

  const handleSettingsCustomGrinderDraftChange = (draft) => {
    setSettingsCustomGrinderDraft(draft);
    void persistCustomGrinderSetupDraft(draft);
  };

  const handleSettingsGrinderPickerChange = async (pickerValue) => {
    setSettingsGrinderPickerValue(pickerValue);
    if (pickerValue === CUSTOM_GRINDER_PICKER_ID) {
      const draft =
        settingsCustomGrinderDraft
        || settingsSetting?.customGrinderSetupDraft
        || settingsSetting?.customGrinder
        || setupCustomGrinderDraft;
      setSettingsCustomGrinderDraft(draft);
      await persistCustomGrinderSetupDraft(draft);
      return;
    }
    await patchGlobalSettings(db, {
      grinderPickerSelection: undefined,
      customGrinderSetupDraft: undefined,
    });
    await handleSaveGrinderSetup(pickerValue);
  };

  const handleSaveCustomGrinderFromSettings = async () => {
    if (!isCustomGrinderFormValid(settingsCustomGrinderDraft)) return;
    const patch = normalizeCustomGrinderSettingsPatch(settingsCustomGrinderDraft);
    if (!patch) return;
    await handleSaveGrinderSetup(CUSTOM_GRINDER_PICKER_ID, { customGrinder: patch.customGrinder });
    setSettingsGrinderPickerValue(CUSTOM_GRINDER_PICKER_ID);
  };

  const handleSmartScaleDeviceChange = async (deviceId) => {
    await patchGlobalSettings(db, {
      smartScaleDeviceId: normalizeSmartScaleDeviceId(deviceId),
    });
  };

  const handleToggleFlairSetting = async (val) => {
    setFlairEnabled(val);
    await patchGlobalSettings(db, { flairEnabled: val });
  };

  const handleTogglePreInfusion = async (val) => {
    setUsePreInfusion(val);
    await patchGlobalSettings(db, { preInfusionEnabled: val });
  };

  const handleShotStartCountdownChange = async (value) => {
    const normalized = normalizeShotStartCountdown(value);
    await patchGlobalSettings(db, { shotStartCountdown: normalized });
  };

  const handleToggleScaleFlowAutoStop = async (val) => {
    await patchGlobalSettings(db, { scaleFlowAutoStopEnabled: val });
  };

  const handleToggleShotScreenWeightGoals = async (val) => {
    await patchGlobalSettings(db, { [SHOT_SCREEN_WEIGHT_GOALS_KEY]: val });
  };

  const handleToggleDarkMode = async () => {
    const next = !darkMode;
    setDarkMode(next);
    await patchGlobalSettings(db, { darkMode: next });
  };

  const handleToggleBrewGuide = async (val) => {
    if (!val && activeTab === 'brew') setActiveTab('dial');
    await patchGlobalSettings(db, { brewGuideEnabled: val });
  };

  const handleToggleStatsForNerds = async (val) => {
    if (!val) setExpandedShotStatsIds(new Set());
    await patchGlobalSettings(db, { statsForNerdsEnabled: val });
  };

  const handleToggleLabCameraPressure = async (val) => {
    await patchGlobalSettings(db, { [LAB_CAMERA_PRESSURE_KEY]: val });
  };

  const handleSaveLabGaugeCalibration = async (calibration) => {
    await patchGlobalSettings(db, {
      [LAB_GAUGE_TAP_CALIBRATION_KEY]: {
        calibration,
        savedAt: new Date().toISOString(),
        viewMoved: false,
      },
    });
    labZeroConfirmedSessionRef.current = true;
  };

  const handleToggleLabPressurePreview = async (val) => {
    await patchGlobalSettings(db, { [LAB_PRESSURE_CAMERA_PREVIEW_KEY]: val });
  };

  const handleLabPressureReader = async (value) => {
    const next = value === LAB_PRESSURE_READER_LEGACY ? LAB_PRESSURE_READER_LEGACY : 'current';
    await patchGlobalSettings(db, { [LAB_PRESSURE_READER_KEY]: next });
  };

  const labShotsWithPressureLogged = shots.filter((s) => s.labPressureCurve?.length > 0).length;

  const refreshLabReplayShotId = useCallback(() => {
    void loadLastLabShotReplayMeta().then((meta) => {
      setLabReplayShotId(meta?.shotId ?? null);
    });
  }, []);

  useEffect(() => {
    refreshLabReplayShotId();
  }, [refreshLabReplayShotId, shots.length]);

  const openLabShotReplay = useCallback(async () => {
    const data = await loadLastLabShotReplayWithBlob();
    if (!data) return;
    setLabReplayPayload(data);
    setLabReplayOpen(true);
  }, []);

  const exportLabShotReplay = useCallback(async (shot) => {
    const data = await loadLastLabShotReplayWithBlob();
    if (!data || data.meta.shotId !== shot?.id) return;
    exportLabShotReplayDownloads({
      shot,
      blob: data.blob,
      mimeType: data.meta.mimeType || data.blob.type,
    });
  }, []);

  const requestStartTimerWithLab = useCallback(
    (opts = {}) => {
      if (shotCountdownValue != null || timerRunning) return;
      const labOn = isLabCameraPressureEnabled(settingsSetting);
      const calibration = labGaugeTapCalibrationFromSettings(settingsSetting);
      const viewMoved = settingsSetting?.labGaugeTapCalibration?.viewMoved === true;
      if (labOn && (!calibration || viewMoved) && !isPressureSimAllowed()) {
        setLabCalibrateRequest((n) => n + 1);
        return;
      }
      if (
        labOn
        && calibration
        && !labZeroConfirmedSessionRef.current
        && !viewMoved
        && !isPressureSimAllowed()
      ) {
        labPendingStartOptsRef.current = opts;
        setLabZeroConfirmOpen(true);
        return;
      }
      requestStartTimer(opts);
    },
    [shotCountdownValue, timerRunning, settingsSetting, requestStartTimer],
  );

  const captureLabPressureShotMetrics = () => {
    try {
      return labPressureMetricsGetterRef.current?.() ?? {};
    } catch {
      return {};
    }
  };

  const toggleShotEngineStats = (shotId) => {
    setExpandedShotStatsIds((prev) => {
      const next = new Set(prev);
      if (next.has(shotId)) next.delete(shotId);
      else next.add(shotId);
      return next;
    });
  };

  const handleSaveBrewAccessories = async (accessories) => {
    await patchGlobalSettings(db, {
      brewGuideAccessories: normalizeBrewAccessories(accessories),
      brewGuideSetupComplete: true,
    });
  };

  const patchBrewGuidanceSettings = async (patch) => {
    const merged = await patchGlobalSettings(db, patch);
    const touchesZeroOffset =
      patch
      && typeof patch === 'object'
      && (Object.prototype.hasOwnProperty.call(patch, 'df64Gen2ZeroOffset')
        || Object.prototype.hasOwnProperty.call(patch, 'df54ZeroOffset'));
    if (touchesZeroOffset && isPresetGrinderModel(grinderModel) && activeBean) {
      const spec = getPresetGrinderSpec(grinderModel);
      const beanShots = shots.filter(
        (s) => s.beanId === activeBean.id && s.grinderModel === grinderModel
      );
      if (spec?.zeroStartOffset && beanShots.length === 0) {
        const resolved = resolveEffectiveZeroOffsetPresetDial(
          customGrindValue,
          spec,
          merged,
          false
        );
        if (resolved !== null) setCustomGrindValue(resolved);
      }
    }
  };

  const rememberSelectedBeanId = async (beanId) => {
    if (!beanId) return;
    await patchBrewGuidanceSettings({ lastSelectedBeanId: beanId });
  };

  const selectActiveBean = (beanId) => {
    setSelectedBeanId(beanId);
    prefillDoseFromRecipe(recipes.find((r) => r.beanId === beanId));
    void rememberSelectedBeanId(beanId);
  };

  const handleDismissBrewGuideIntro = () => {
    patchBrewGuidanceSettings({ brewGuideIntroSeen: true });
  };

  const handleUseQuickChecklist = () => {
    patchBrewGuidanceSettings({
      brewGuideGuidanceMode: BREW_GUIDANCE_MODES.quick,
      brewGuideGraduationDismissed: true,
    });
  };

  const handleNoBrewChecklist = () => {
    patchBrewGuidanceSettings({
      brewGuideGuidanceMode: BREW_GUIDANCE_MODES.none,
      brewGuideGraduationDismissed: true,
    });
  };

  const handleKeepFullBrewGuide = () => {
    patchBrewGuidanceSettings({ brewGuideGraduationDismissed: true });
  };

  const handleBrewGuidanceModeChange = async (mode) => {
    const next = normalizeBrewGuidanceMode(mode);
    await patchBrewGuidanceSettings({
      brewGuideGuidanceMode: next,
      ...(next !== BREW_GUIDANCE_MODES.full ? { brewGuideGraduationDismissed: true } : {}),
    });
  };

  const handleRevertToFullBrewGuide = () => {
    patchBrewGuidanceSettings({ brewGuideGuidanceMode: BREW_GUIDANCE_MODES.full });
  };

  const handleOpenBrewAccessories = () => {
    setBrewAccessoriesReturnTo('dial');
    setActiveTab('brew');
    setBrewAccessoriesOpenRequest((count) => count + 1);
  };

  const handleAccessoriesOpenHandled = () => {
    setBrewAccessoriesOpenRequest(0);
  };

  const handleExitBrewAccessories = (target) => {
    setBrewAccessoriesReturnTo('brew');
    setBrewAccessoriesOpenRequest(0);
    if (target === 'dial') setActiveTab('dial');
  };

  const handleLogoClick = () => {
    logoTapTesterRef.current?.handleTap();
  };

  const handleFactoryReset = async () => {
    await db.shots.clear();
    await db.recipes.clear();
    await db.beans.clear();
    await db.settings.clear();
    setShowResetConfirm(false);
    setSelectedBeanId('');
    setGrinderModel('');
    setFlairEnabled(false);
    setUsePreInfusion(false);
    setIsSettingsOpen(false);
  };

  const sanitizeRating = (val) => {
    if (!val && val !== 0) return '';
    let num = parseFloat(val);
    if (isNaN(num)) return '';
    return Math.min(10.0, Math.max(1.0, num));
  };

  const handleSaveBean = async (e) => {
    e.preventDefault();
    if (!newBean.name) return;
    setValidationError('');
    if (!newBean.roastDate) {
      setBeanFieldErrors({ roastDate: 'Roast date is required.' });
      return;
    }
    setBeanFieldErrors({});

    try {
      const sanitized = sanitizeRating(newBean.rating);
      const beanToSave = { ...newBean, rating: sanitized !== '' ? sanitized : null, isDecaf: beanIsDecaf(newBean) };
      
      if (isEditingBean && newBean.id) {
        await db.beans.update(newBean.id, beanToSave);
        const existingRecipe = recipes.find(r => r.beanId === newBean.id);
        await persistBeanRecipeForBean(db, newBean.id, newRecipe, existingRecipe, grinderModel);
        prefillDoseFromRecipe(newRecipe);
      } else {
        const isFirstBeanAdd = beans.length === 0;
        const beanId = generateId();
        await db.beans.add({ ...beanToSave, id: beanId, isFinished: false, thawHistory: [], createdAt: new Date().toISOString() });
        await db.recipes.add({ ...newRecipe, targetYieldG: parseFloat(newRecipe.targetYieldG) || 36, id: generateId(), beanId });
        selectActiveBean(beanId);

        const currentSettings = await db.settings.get('global') || { id: 'global' };
        if (shouldNavigateToBrewAfterFirstBean(currentSettings, isFirstBeanAdd, Boolean(currentSettings.brewGuideEnabled))) {
          await patchBrewGuidanceSettings({ brewGuideFirstBeanNavDone: true });
          setIsEditingBean(false);
          setNewBean({ name: '', roaster: '', roastType: 'Medium', roastDate: '', storageType: 'bag', postThawStorage: 'bag', freezeDate: '', thawDate: '', thawHistory: [], rating: '', isFinished: false, isDecaf: false });
          setNewRecipe(createDefaultNewRecipe(grinderModel));
          setActiveTab('brew');
          return;
        }
      }

      setNewBean({ name: '', roaster: '', roastType: 'Medium', roastDate: '', storageType: 'bag', postThawStorage: 'bag', freezeDate: '', thawDate: '', thawHistory: [], rating: '', isFinished: false, isDecaf: false });
      setNewRecipe(createDefaultNewRecipe(grinderModel));
      setIsEditingBean(false);
      setActiveTab('dial');
    } catch (err) {
      console.error("Failed to save bean profile:", err);
      setValidationError("Failed to save bean: " + err.message);
    }
  };

  const startEditBean = (bean, options = {}) => {
    const { focusFlairProfile = false } = options;
    const recipe = recipes.find(r => r.beanId === bean.id);
    const beanShotHistory = shots.filter((s) => s.beanId === bean.id);
    setNewBean(bean);
    if (recipe) {
      setNewRecipe(sanitizeRecipeFormState(recipe, grinderModel));
    } else {
      setNewRecipe(
        sanitizeRecipeFormState(
          { ...createDefaultNewRecipe(grinderModel), ...inferRecipeTargetsFromShots(beanShotHistory) },
          grinderModel
        )
      );
    }
    setIsEditingBean(true);
    setActiveTab('beans');
    if (focusFlairProfile) {
      pendingFocusFlairProfileRef.current = true;
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleEditOnBeansFromDial = () => {
    if (activeBean?.id) {
      startEditBean(activeBean, { focusFlairProfile: true });
      return;
    }
    setActiveTab('beans');
  };

  useEffect(() => {
    if (activeTab !== 'beans' || !isEditingBean || !pendingFocusFlairProfileRef.current) return;
    pendingFocusFlairProfileRef.current = false;
    const frame = requestAnimationFrame(() => {
      flairPressureProfileRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const firstField = flairPressureProfileRef.current?.querySelector('input, select');
      firstField?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeTab, isEditingBean, newBean.id]);

  const cancelEditBean = () => {
    pendingFocusFlairProfileRef.current = false;
    setIsEditingBean(false);
    setNewBean({ name: '', roaster: '', roastType: 'Medium', roastDate: '', storageType: 'bag', postThawStorage: 'bag', freezeDate: '', thawDate: '', thawHistory: [], rating: '', isFinished: false, isDecaf: false });
    setNewRecipe(createDefaultNewRecipe(grinderModel));
  };

  const handleUpdateBeanRating = async (beanId, val) => {
    const sanitized = sanitizeRating(val);
    await db.beans.update(beanId, { rating: sanitized !== '' ? sanitized : null });
  };

  const clearFinishUndoToast = useCallback(() => {
    if (finishUndoTimerRef.current) {
      clearTimeout(finishUndoTimerRef.current);
      finishUndoTimerRef.current = null;
    }
    setFinishUndoToast(null);
  }, []);

  useEffect(() => () => {
    if (finishUndoTimerRef.current) clearTimeout(finishUndoTimerRef.current);
  }, []);

  const scheduleFinishUndoToast = useCallback((payload) => {
    if (finishUndoTimerRef.current) clearTimeout(finishUndoTimerRef.current);
    setFinishUndoToast(payload);
    finishUndoTimerRef.current = setTimeout(() => {
      finishUndoTimerRef.current = null;
      setFinishUndoToast(null);
    }, TOAST_DURATION_MS);
  }, []);

  const handleUndoMarkFinished = async () => {
    if (!finishUndoToast?.snapshot) return;
    const { snapshot, wasSelected } = finishUndoToast;
    clearFinishUndoToast();
    await restoreBeanFromSnapshot(db, snapshot);
    if (wasSelected) {
      setSelectedBeanId(snapshot.id);
      void rememberSelectedBeanId(snapshot.id);
    }
  };

  const toggleFinishedSection = () => {
    setFinishedSectionOpen((prev) => {
      const next = !prev;
      writeBeansFinishedSectionOpen(next);
      return next;
    });
  };

  const handleMarkActive = async (beanId) => {
    clearFinishUndoToast();
    await persistBeanActive(db, beanId);
  };

  const handleToggleFinished = async (beanId, currentStatus) => {
    clearFinishUndoToast();
    if (currentStatus) {
      await persistBeanActive(db, beanId);
      return;
    }

    const bean = beans.find((b) => b.id === beanId);
    const snapshot = snapshotBeanRecord(bean);
    if (!snapshot) return;

    const wasSelected = effectiveBeanId === beanId;
    await persistBeanFinished(db, beanId);
    if (wasSelected) {
      const nextId = nextActiveBeanIdAfterFinish(beans, beanId);
      setSelectedBeanId(nextId);
      void rememberSelectedBeanId(nextId);
    }
    scheduleFinishUndoToast({ snapshot, wasSelected });
  };

  const handleDeleteBean = async (beanId) => {
    if (window.confirm("Are you sure you want to delete this coffee profile? This will permanently remove its recipe and all associated shot history.")) {
      await db.beans.delete(beanId);
      
      const associatedRecipes = await db.recipes.where('beanId').equals(beanId).toArray();
      for (const r of associatedRecipes) await db.recipes.delete(r.id);
      
      const associatedShots = await db.shots.where('beanId').equals(beanId).toArray();
      for (const s of associatedShots) await db.shots.delete(s.id);

      if (effectiveBeanId === beanId) {
        const remaining = beans.filter(b => b.id !== beanId && !b?.isFinished);
        const nextId = remaining.length > 0 ? remaining[0].id : '';
      setSelectedBeanId(nextId);
      void rememberSelectedBeanId(nextId);
      }
    }
  };

  const handleThawNewBag = async () => {
    if (!activeBean) return;
    const todayStr = new Date().toISOString().slice(0, 10);
    const currentHistory = activeBean.thawHistory || [];
    const newHistoryEntry = { thawDate: activeBean.thawDate || null };
    
    await db.beans.update(activeBean.id, { 
      thawDate: todayStr,
      thawHistory: [...currentHistory, newHistoryEntry]
    });
  };

  const handleReverseThaw = async () => {
    if (!activeBean || !activeBean.thawHistory || activeBean.thawHistory.length === 0) return;
    const currentHistory = [...activeBean.thawHistory];
    const lastEntry = currentHistory.pop();

    await db.beans.update(activeBean.id, {
      thawDate: lastEntry.thawDate,
      thawHistory: currentHistory
    });
  };

  const handleDeleteShot = async (id) => {
    if (window.confirm("Are you sure you want to delete this shot? It will be permanently removed from history and recommendation learning calculations.")) {
      await db.shots.delete(id);
    }
  };

  const handleToggleShotLearningExclusion = async (shot) => {
    const nextExcluded = !shot.excludeFromLearning;
    await db.shots.update(shot.id, {
      excludeFromLearning: nextExcluded,
      ...(nextExcluded ? { knownIssueReason: shot.knownIssueReason || 'other' } : {}),
    });
  };

  const handleLogShot = async (e) => {
    e.preventDefault();
    setValidationError('');

    const parsedTime = parseInt(actualTimeS, 10);
    const parsedYield = parseFloat(actualYieldG);
    const parsedDose = parseFloat(actualDoseG);

    const missing = [];
    const highlights = { ...EMPTY_SHOT_FIELD_HIGHLIGHTS };
    if (isNaN(parsedDose)) {
      missing.push('dose');
      highlights.dose = true;
    }
    if (isNaN(parsedYield)) {
      missing.push('yield');
      highlights.yield = true;
    }
    if (isNaN(parsedTime)) {
      missing.push('time');
      highlights.time = true;
    }
    if (!tasteProfile) {
      missing.push('taste');
      highlights.taste = true;
    }
    if (missing.length > 0) {
      setValidationError(shotLogValidationMessage(missing));
      setShotFieldHighlights(highlights);
      const focusOrder = [
        ['dose', doseInputRef, 'input'],
        ['yield', yieldInputRef, 'input'],
        ['time', timeInputRef, 'input'],
        ['taste', tasteInputRef, 'button'],
      ];
      for (const [key, ref, focusSelector] of focusOrder) {
        if (!highlights[key]) continue;
        ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (focusSelector === 'button') ref.current?.querySelector('button')?.focus();
        else ref.current?.querySelector('input')?.focus();
        break;
      }
      return;
    }
    setShotFieldHighlights(EMPTY_SHOT_FIELD_HIGHLIGHTS);

    const logGrinderModel = grinderModel || resolveActiveGrinderModel(appSettings);
    const pendingGrindKey = pendingGrindSessionKey(activeBean?.id, logGrinderModel);
    const pendingGrind = pendingGrindKey ? pendingGrindByKeyRef.current[pendingGrindKey] : null;
    const grindStateForSave = {
      setteMacro: pendingGrind?.setteMacro ?? setteMacro,
      setteMicro: pendingGrind?.setteMicro ?? setteMicro,
      sunbeamSetting: pendingGrind?.sunbeamSetting ?? sunbeamSetting,
      nicheZeroSetting: pendingGrind?.nicheZeroSetting ?? nicheZeroSetting,
      customGrindValue: pendingGrind?.customGrindValue ?? customGrindValue,
    };
    const parsedGrind = parseGrindForShotSave(
      logGrinderModel,
      grindStateForSave,
      appSettings
    );
    if (!parsedGrind.ok) {
      setValidationError(parsedGrind.error);
      return;
    }
    const {
      setteMacro: finalMacro,
      setteMicro: finalMicro,
      sunbeamSetting: finalSunbeam,
      nicheZeroSetting: finalNicheZero,
      customGrindValue: finalCustomGrind,
    } = parsedGrind;

    if (!activeBean || !activeRecipe) {
      setValidationError('Missing active coffee profile or recipe.');
      return;
    }

    const recommendationFollowed = resolveRecommendationFollowedForSave({
      displayedRecommendation: displayedDialInRecRef.current,
      grinderModel: logGrinderModel,
      settings: appSettings,
      savedGrind: {
        setteMacro: finalMacro,
        setteMicro: finalMicro,
        sunbeamSetting: finalSunbeam,
        nicheZeroSetting: finalNicheZero,
        customGrindValue: finalCustomGrind,
      },
    });

    const lastShotGrind = lastLearningShot ? {
      setteMacro: lastLearningShot.setteMacro,
      setteMicro: lastLearningShot.setteMicro,
      sunbeamSetting: lastLearningShot.sunbeamSetting,
      nicheZeroSetting: lastLearningShot.nicheZeroSetting,
      customGrindValue: lastLearningShot.customGrindValue,
    } : null;

    const referenceNow = new Date();

    const ageData = calculateEffectiveBeanAge(activeBean, null);
    const recentBeanShots = filterShotsForGrinderLearning(shots, {
      beanId: activeBean.id,
      grinderModel: logGrinderModel,
    });

    const savedTasteProfile = tasteProfileForSave(tasteProfile);

    const labPressureSave = buildLabPressureShotFields({
      labCameraPressureEnabled,
      labPressureShotMetrics,
      captureLabPressureShotMetrics,
    });

    const rec = calculateRecommendation(
      { 
        beanId: activeBean.id,
        grinderModel: logGrinderModel,
        setteMacro: finalMacro, 
        setteMicro: finalMicro, 
        sunbeamSetting: finalSunbeam,
        nicheZeroSetting: finalNicheZero,
        customGrindValue: finalCustomGrind,
        wasPurged, 
        actualTime: parsedTime, 
        actualDose: parsedDose, 
        actualYield: parsedYield, 
        tasteProfile: savedTasteProfile, 
        lastShotGrind,
        recommendationFollowed,
        previousShot: lastLearningShot || null,
        excludeFromLearning,
      },
      activeRecipe,
      recentBeanShots,
      flairEnabled,
      {
        settings: appSettings,
        grinderLearningShots: filterShotsForGrinderModelLearning(shots, logGrinderModel),
      }
    );

    const shotRecord = {
      id: generateId(),
      beanId: activeBean.id,
      timestamp: referenceNow.toISOString(),
      grinderModel: logGrinderModel,
      setteMacro: finalMacro,
      setteMicro: finalMicro,
      sunbeamSetting: finalSunbeam,
      nicheZeroSetting: finalNicheZero,
      customGrindValue: finalCustomGrind,
      wasPurged,
      actualDoseG: parsedDose,
      actualYieldG: parsedYield,
      actualTimeS: parsedTime,
      tasteProfile: savedTasteProfile,
      shotRating: shotRating !== null ? shotRating : undefined,
      brewRatio: `1:${brewRatio}`,
      beanAgeDays: ageData.daysOld,
      storageType: activeBean.storageType || 'bag',
      recommendationFollowed,
      targetTimeMinS: activeRecipe.targetTimeMinS,
      targetTimeMaxS: activeRecipe.targetTimeMaxS,
      targetDoseG: activeRecipe.targetDoseG,
      targetYieldG: activeRecipe.targetYieldG,
      brewTemperatureC: activeRecipe.brewTemperatureC || null,
      flairProfile: flairEnabled && activeRecipe.flairProfile ? { ...activeRecipe.flairProfile } : null,
      recommendation: rec,
      notes: preInfusionSeconds > 0 ? `Pre-infusion: ${preInfusionSeconds}s. ${notes}` : notes,
      ...(excludeFromLearning
        ? { excludeFromLearning: true, knownIssueReason: knownIssueReason || 'other' }
        : {}),
      ...(scaleShotMetrics?.scaleFlowCurve?.length
        ? {
            scaleFlowRateGs: scaleShotMetrics.scaleFlowRateGs ?? undefined,
            scaleFlowCurve: scaleShotMetrics.scaleFlowCurve,
          }
        : {}),
      ...labPressureSave.fields,
    };

    try {
      await db.shots.add(shotRecord);
      if (labCameraPressureEnabled) {
        try {
          await labShotReplayCommitRef.current?.(shotRecord.id);
        } catch (err) {
          console.warn('[lab-pressure] replay commit failed (shot curve kept):', err);
        }
      }
      const displayHoldClear = clearRecommendationCardDisplayHoldPatch(
        appSettings,
        activeBean.id,
        logGrinderModel
      );
      if (Object.keys(displayHoldClear).length > 0) {
        await patchGlobalSettings(db, displayHoldClear);
      }
      await persistGrindUiToSettings(
        logGrinderModel,
        grindUiSnapshotFromControls({
          setteMacro: finalMacro,
          setteMicro: finalMicro,
          sunbeamSetting: finalSunbeam,
          nicheZeroSetting: finalNicheZero,
          customGrindValue: finalCustomGrind,
        })
      );
      clearPendingGrind(activeBean.id, grinderModel);
      setApplyRecConfirmation('');
      setPendingBasketAdjustment(null);
      setAppliedRecommendationDisplay(null);

      setActualTimeS('');
      if (activeRecipe?.targetDoseG != null && activeRecipe.targetDoseG !== '') {
        setActualDoseG(activeRecipe.targetDoseG);
      }
      setActualYieldG('');
      setShotRating(null);
      setNotes('');
      setTasteProfile('');
      setExcludeFromLearning(false);
      setKnownIssueReason('puck_prep');
      setScaleShotMetrics(null);
      setLabPressureShotMetrics(null);
      handleResetTimer();

      const loggedPerfectShot = isPerfectShot({
        yieldG: parsedYield,
        targetYieldG: activeRecipe.targetYieldG,
        timeS: parsedTime,
        timeMinS: activeRecipe.targetTimeMinS,
        timeMaxS: activeRecipe.targetTimeMaxS,
        taste: savedTasteProfile,
      });

      if (loggedPerfectShot) {
        queueMicrotask(() => {
          triggerPerfectShotCelebration(pickCameo(), true, {
            doseG: parsedDose,
            yieldG: parsedYield,
          });
        });
      }

      const recScrollDelayMs = loggedPerfectShot ? PERFECT_SHOT_RECOMMENDATION_SCROLL_DELAY_MS : 100;
      setTimeout(() => {
        recommendationRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, recScrollDelayMs);
    } catch (err) {
      console.error("Database save failed:", err);
      setValidationError(`Error saving to database: ${err.message || 'Unknown IndexedDB Error.'}`);
    }
  };

  const lastShotOutcome =
    lastLoggedShot && activeRecipe
      ? classifyShotOutcome(lastLoggedShot, recipeContextForShot(lastLoggedShot, activeRecipe))
      : null;
  const beanShotsForGrinder = activeBean
    ? filterShotsForGrinderLearning(shots, { beanId: activeBean.id, grinderModel })
    : [];
  const grinderShotsForLearning = grinderModel
    ? filterShotsForGrinderModelLearning(shots, grinderModel)
    : [];
  const usePreviousRecipeRecommendation = shouldUsePreviousRecipeRecommendation({
    lastLoggedShot,
    activeRecipe,
    beanShotsForGrinder,
    flairEnabled,
  });
  const previousRecipeRec =
    usePreviousRecipeRecommendation && lastLoggedShot
      ? getAgeAdjustedRecommendation(lastLoggedShot, activeBean, null, appSettings)
      : null;
  const ageAdjustedRec =
    !usePreviousRecipeRecommendation
    && lastLearningShot
    && lastLearningShot.grinderModel === grinderModel
      ? getAgeAdjustedRecommendation(lastLearningShot, activeBean, null, appSettings)
      : null;
  const liveReferenceLearningRec =
    !usePreviousRecipeRecommendation
    && lastLearningShot
    && activeRecipe
      ? recomputeReferenceLearningRecommendationFromLastShot(
          lastLearningShot,
          activeRecipe,
          beanShotsForGrinder,
          flairEnabled,
          appSettings,
          grinderShotsForLearning
        )
      : null;
  const liveQuantitativeRec =
    !usePreviousRecipeRecommendation
    && grinderSupportsQuantitativeRecommendations(grinderModel, appSettings)
    && !isNicheZeroGrinderModel(grinderModel)
    && lastLearningShot
    && activeRecipe
      ? recomputeQuantitativeRecommendationFromLastShot(
          lastLearningShot,
          activeRecipe,
          beanShotsForGrinder,
          flairEnabled,
          appSettings,
          grinderShotsForLearning
        )
      : null;
  const dynamicRec = usePreviousRecipeRecommendation && previousRecipeRec
    ? {
        ...previousRecipeRec,
        reason: lastLoggedShot.recommendation?.reason ?? previousRecipeRec.originalReason,
        originalReason: lastLoggedShot.recommendation?.reason ?? previousRecipeRec.originalReason,
        previousRecipeDisclaimer: PREVIOUS_RECIPE_REC_DISCLAIMER,
      }
    : liveReferenceLearningRec
      ? {
          ...liveReferenceLearningRec,
          ageWarning: ageAdjustedRec?.ageWarning ?? null,
          originalReason: liveReferenceLearningRec.reason,
        }
      : liveQuantitativeRec
        ? {
            ...liveQuantitativeRec,
            ageWarning: ageAdjustedRec?.ageWarning ?? null,
            originalReason: liveQuantitativeRec.reason,
          }
        : ageAdjustedRec;
  const nicheLearningBlocksEvidence =
    isNicheZeroGrinderModel(grinderModel)
    && Boolean(dynamicRec?.nicheLearningNote)
    && !dynamicRec?.outlierGrindHeld;
  const recommendationEvidenceContext =
    (activeRecipe && beanShotsForGrinder.length > 0
      ? getRecommendationEvidenceContext(beanShotsForGrinder, activeRecipe, flairEnabled)
      : null) || dynamicRec?.evidenceContext;
  const hasLoggedShotForBean = beanShots.length > 0;
  const decafNoteSource = !beanIsDecaf(activeBean)
    ? null
    : hasLoggedShotForBean
      ? 'shots'
      : (grinderModel && getHistoricalRoastBaseline(grinderModel, activeBean?.roastType, recipes, shots, beans, 'decaf') !== null)
        ? 'decaf-history'
        : 'roast-baseline';
  const decafNote = decafNoteSource ? decafContextNote(activeBean, decafNoteSource) : null;
  const initialGrindSetting = activeBean && grinderModel && beanShotsForGrinder.length === 0
    ? getInitialGrindRecommendation(
        grinderModel,
        activeBean.roastType,
        activeBean,
        recipes,
        shots,
        beans,
        null,
        flairEnabled,
        appSettings
      )
    : null;
  const initialGrindHintSource = (() => {
    if (!initialGrindSetting || beanShotsForGrinder.length > 0) return null;
    if (initialGrindSetting.initialSource) return initialGrindSetting.initialSource;
    if (!activeBean || !grinderModel) return null;
    const baseline = getHistoricalRoastBaseline(
      grinderModel,
      activeBean.roastType,
      recipes,
      shots,
      beans,
      beanIsDecaf(activeBean) ? 'decaf' : 'regular'
    );
    return baseline !== null ? 'roast-baseline' : 'app-default';
  })();

  const effectiveCustomGrindValue = (() => {
    if (isPresetGrinderModel(grinderModel)) {
      const spec = getPresetGrinderSpec(grinderModel);
      const resolved = resolveEffectiveZeroOffsetPresetDial(
        customGrindValue,
        spec,
        appSettings,
        beanShotsForGrinder.length > 0
      );
      if (resolved !== null) return resolved;
    }
    if (customGrindValue !== null && customGrindValue !== '') return customGrindValue;
    if (isPresetGrinderModel(grinderModel)) {
      const spec = getPresetGrinderSpec(grinderModel);
      if (spec) return defaultPresetGrindValue(spec, appSettings);
    }
    if (isCustomGrinderModel(grinderModel, appSettings)) {
      const profile = normalizeCustomGrinderProfile(appSettings?.customGrinder);
      if (profile) return defaultCustomGrindValue(profile);
    }
    return 15;
  })();

  const currentGrindLabel = formatCurrentGrindLabel(
    grinderModel,
    {
      setteMacro,
      setteMicro,
      sunbeamSetting,
      nicheZeroSetting,
      customGrindValue: effectiveCustomGrindValue,
    },
    appSettings
  );

  const basketAdjustmentBasis = buildBasketAdjustmentBasisRec(dynamicRec, grinderModel, {
    initialGrindSetting,
    hasBeanShotsForGrinder: beanShotsForGrinder.length > 0,
    grindFields: {
      setteMacro,
      setteMicro,
      sunbeamSetting,
      nicheZeroSetting,
      customGrindValue: effectiveCustomGrindValue,
    },
    settings: appSettings,
  });
  const displayDynamicRec =
    pendingBasketAdjustment && basketAdjustmentBasis?.recommendedSetting
      ? applyBasketChangeToRecommendation(
          basketAdjustmentBasis,
          grinderModel,
          pendingBasketAdjustment,
          appSettings
        )
      : dynamicRec;
  const grindRecommendationSummary = displayDynamicRec?.recommendedSetting
    ? formatGrindRecommendationSummary(grinderModel, displayDynamicRec, appSettings)
    : null;

  displayedDialInRecRef.current = displayDynamicRec;

  const initialGrindHint = (() => {
    if (!initialGrindHintSource) return null;
    switch (initialGrindHintSource) {
      case 'app-default':
        return buildAppDefaultInitialGrindHint(grinderModel, currentGrindLabel);
      case 'roast-baseline':
        return 'Starting grind from your dialled-in shots on other beans of this roast class.';
      case 'bean-history':
        return 'Starting grind from your logged shots on this bean (matching recipe).';
      case 'bean-history-other-recipe':
        return 'Starting grind from this bean; recipe differs from current targets — verify before brewing.';
      default:
        return null;
    }
  })();

  const timerWindowSeconds =
    (timerUsePreInfusion ? Number(activeRecipe?.flairProfile?.preinfusionTime) || 12 : 0) +
    (activeRecipe?.targetTimeMaxS || 32) +
    6;
  const timerDisplaySeconds =
    timerUsePreInfusion && timerRunning && !preInfusionPhase
      ? Math.max(0, timerSeconds - preInfusionSeconds)
      : timerSeconds;
  const timerProgress = timerRunning ? Math.min(1, timerSeconds / timerWindowSeconds) : 0;
  const scaleExtractionElapsedS =
    timerRunning && timerUsePreInfusion && !preInfusionPhase
      ? Math.max(0, timerSeconds - preInfusionSeconds)
      : timerRunning
        ? timerSeconds
        : 0;
  const scaleShowLiveReadout =
    scaleFeatureEnabled && timemoreScale.isConnected && (timerRunning || timemoreScale.liveWeightG > 0);
  const scaleShowFlow =
    scaleShowLiveReadout
    && timerRunning
    && (!timerUsePreInfusion || !preInfusionPhase)
    && timemoreScale.instantFlowGs != null;

  const applyRecommendation = async () => {
    if (!displayDynamicRec || !displayDynamicRec.recommendedSetting) return;
    const recSet = displayDynamicRec.recommendedSetting;
    const appliedLabel = formatRecommendedGrindDisplay(grinderModel, recSet, appSettings);
    
    const applyGrinder = grinderModel;
    const uiState = uiStateFromRecommendedSetting(applyGrinder, recSet, appSettings);
    if (uiState) {
      setGrinderModel(applyGrinder);
      if (uiState.setteMacro != null) setSetteMacro(uiState.setteMacro);
      if (uiState.setteMicro != null) setSetteMicro(uiState.setteMicro);
      if (uiState.sunbeamSetting != null) setSunbeamSetting(uiState.sunbeamSetting);
      if (uiState.nicheZeroSetting != null) setNicheZeroSetting(uiState.nicheZeroSetting);
      if (uiState.customGrindValue != null) setCustomGrindValue(uiState.customGrindValue);
      stashPendingGrind(applyGrinder, activeBean?.id, {
        setteMacro: uiState.setteMacro ?? setteMacro,
        setteMicro: uiState.setteMicro ?? setteMicro,
        sunbeamSetting: uiState.sunbeamSetting ?? sunbeamSetting,
        nicheZeroSetting: uiState.nicheZeroSetting ?? nicheZeroSetting,
        customGrindValue: uiState.customGrindValue ?? customGrindValue,
      });
      await patchGlobalSettings(db, (currentSettings) => {
        const recPatch = persistedSettingsPatchFromRecommendation(
          applyGrinder,
          recSet,
          currentSettings,
          activeBean?.id
        );
        const displayHoldPatch = patchRecommendationCardDisplayHold(
          currentSettings,
          activeBean?.id,
          applyGrinder,
          appliedLabel
        );
        return { ...recPatch, ...displayHoldPatch };
      });
    }

    if (grindSettingsRef.current) {
      grindSettingsRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightGrind(true);
      setTimeout(() => setHighlightGrind(false), 1500);
    }

    setPendingBasketAdjustment(null);
    setAppliedRecommendationDisplay(appliedLabel);
    setApplyRecConfirmation(`Grind set to ${appliedLabel}.`);
    window.setTimeout(() => setApplyRecConfirmation(''), 4000);
  };

  const exportDataCSV = async () => {
    const [allShots, allBeans, allRecipes] = await Promise.all([
      db.shots.orderBy('timestamp').reverse().toArray(),
      db.beans.toArray(),
      db.recipes.toArray(),
    ]);
    const rows = buildShotsCsvRows(allShots, {
      beans: allBeans,
      recipes: allRecipes,
      formatShotGrindForHistory: (shot) => formatShotGrindForHistory(shot, appSettings),
      normalizeTasteProfile,
      formatRecFollowedForCsv,
      knownIssueReasonLabel,
    });
    const csvText = buildShotsCsvContent(SHOT_CSV_HEADERS, rows);
    downloadCsvFile(`espresso_shots_${new Date().toISOString().slice(0, 10)}.csv`, csvText);
  };

  const handleImportCsvFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const csvText = await file.text();
      const result = await importShotsFromCsv(db, csvText, { settings: appSettings });
      const errorCount = result.errors.length;
      const parts = [
        `Imported ${result.imported} shot${result.imported === 1 ? '' : 's'}`,
        `skipped ${result.skipped} duplicate${result.skipped === 1 ? '' : 's'}`,
      ];
      if (result.createdBeans > 0) {
        parts.push(`created ${result.createdBeans} bean${result.createdBeans === 1 ? '' : 's'}`);
      }
      if (errorCount > 0) {
        parts.push(`${errorCount} row${errorCount === 1 ? '' : 's'} with errors`);
      }
      if (result.nicheCalibrationNotice) {
        parts.push(result.nicheCalibrationNotice);
      }
      const summary = parts.join(', ');
      setCsvImportSummary(summary.endsWith('.') ? summary : `${summary}.`);
      void patchBrewGuidanceSettings({ brewGuideGraduationSuppressed: true });
      window.setTimeout(() => setCsvImportSummary(''), 8000);
    } catch (err) {
      setCsvImportSummary(err?.message || 'Import failed.');
      window.setTimeout(() => setCsvImportSummary(''), 8000);
    }
  };

  const beanAgeInfo = activeBean ? calculateEffectiveBeanAge(activeBean, null) : null;
  const filteredShots = historyFilterBeanId === 'all' ? shots : shots.filter(s => s.beanId === historyFilterBeanId);
  const newestShotId = shots[0]?.id ?? null;

  const totalShots = shots.length;
  const compliantShots = shots.filter(s => {
    const r = recipes.find(rec => rec.beanId === s.beanId);
    if (!r) return false;
    return s.actualTimeS >= (r.targetTimeMinS || 27) && s.actualTimeS <= (r.targetTimeMaxS || 32);
  }).length;
  const complianceRate = totalShots > 0 ? Math.round((compliantShots / totalShots) * 100) : 0;
  const avgExtractionTime = totalShots > 0 ? Math.round(shots.reduce((acc, s) => acc + (s.actualTimeS || 0), 0) / totalShots) : 0;

  const tasteCounts = {
    very_sour: shots.filter(s => s.tasteProfile === 'very_sour').length,
    sour: shots.filter(s => s.tasteProfile === 'sour').length,
    balanced: shots.filter((s) => normalizeTasteProfile(s.tasteProfile) === BALANCED_TASTE_PROFILE).length,
    bitter: shots.filter(s => s.tasteProfile === 'bitter').length,
    very_bitter: shots.filter(s => s.tasteProfile === 'very_bitter').length,
  };

  const ui = getAppTheme(darkMode);
  const currentTheme = {
    primary: ui.primary,
    badge: ui.badge,
    text: ui.accentText,
    card: `${ui.card} shadow-sm`,
  };
  const inputClass = `${ui.input} border`;
  const labelClass = ui.label;
  const subTextClass = ui.sub;

  const previousGrindLabel = (() => {
    const shot = shots.find((s) => s.grinderModel === grinderModel);
    if (!shot) return '';
    return formatPreviousGrindLabel(grinderModel, shot, appSettings);
  })();

  const recommendedGrindDisplay = (() => {
    if (appliedRecommendationDisplay && !pendingBasketAdjustment) return appliedRecommendationDisplay;
    const heldLabel = getRecommendationCardDisplayHold(appSettings, activeBean?.id, grinderModel);
    if (heldLabel) return heldLabel;
    if (displayDynamicRec?.recommendedSetting && grinderModel) {
      return formatRecommendedGrindDisplay(grinderModel, displayDynamicRec.recommendedSetting, appSettings);
    }
    return currentGrindLabel;
  })();

  const grinderBadgeLabel = getUiGrinderPresentation(grinderModel, appSettings).shortBadgeLabel;
  const showHeldbackEstimatedStartingCard =
    !dynamicRec
    && beanShotsForGrinder.length === 0
    && initialGrindHintSource === 'app-default'
    && isHeldbackEstimatedPresetId(grinderModel);

  const formatShotWhen = (timestamp) => {
    const d = new Date(timestamp);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return isToday ? `Today • ${time}` : `${d.toLocaleDateString()} • ${time}`;
  };

  const shotTimeTone = (timeS, minT, maxT) =>
    EXTRACTION_TIME_COLORS[extractionTimeStatus(timeS, minT, maxT)].label;

  const preInfusionFromNotes = (notes) => {
    if (!notes) return null;
    const match = notes.match(/Pre-infusion:\s*([\d.]+)s/i);
    return match ? match[1] : null;
  };

  const handleBrewStartTimer = () => {
    setActualTimeS('');
    requestStartTimer({ fromBrewGuide: true });
  };

  const shotCountdownOverlayVisible = shotCountdownValue != null && shotCountdownValue > 0;
  const brewGuideExtractCountdownActive = isBrewGuideExtractCountdownActive({
    shotCountdownValue,
    countdownHandoffPending,
  });

  const handleBrewResetTimer = () => {
    syncBrewGuideTimerActive(false);
    handleResetTimer();
    setActualTimeS('');
  };

  useLayoutEffect(() => {
    if (activeTab === 'brew' && brewGuideEnabled) return;
    releaseBrewGuideTimer();
  }, [activeTab, brewGuideEnabled, releaseBrewGuideTimer]);

  const handleBrewHandoff = ({ timeS, yieldG } = {}) => {
    if (activeRecipe && activeRecipe.targetDoseG != null && activeRecipe.targetDoseG !== '') {
      setActualDoseG(activeRecipe.targetDoseG);
    }
    if (timeS != null && timeS !== '') setActualTimeS(timeS);
    if (yieldG != null && yieldG !== '' && Number(yieldG) > 0) setActualYieldG(yieldG);
    setWasPurged(true);
    if (lastLearningShot && dynamicRec?.recommendedSetting && lastLearningShot.grinderModel === grinderModel) {
      const uiState = uiStateFromRecommendedSetting(grinderModel, dynamicRec.recommendedSetting, appSettings);
      if (uiState?.setteMacro != null) setSetteMacro(uiState.setteMacro);
      if (uiState?.setteMicro != null) setSetteMicro(uiState.setteMicro);
      if (uiState?.sunbeamSetting != null) setSunbeamSetting(uiState.sunbeamSetting);
      if (uiState?.nicheZeroSetting != null) setNicheZeroSetting(uiState.nicheZeroSetting);
      if (uiState?.customGrindValue != null) setCustomGrindValue(uiState.customGrindValue);
      stashPendingGrind(grinderModel, activeBean?.id, {
        setteMacro: uiState?.setteMacro ?? setteMacro,
        setteMicro: uiState?.setteMicro ?? setteMicro,
        sunbeamSetting: uiState?.sunbeamSetting ?? sunbeamSetting,
        nicheZeroSetting: uiState?.nicheZeroSetting ?? nicheZeroSetting,
        customGrindValue: uiState?.customGrindValue ?? customGrindValue,
      });
    }
    syncBrewGuideTimerActive(false);
    setBrewTimerHost(false);
    setShotFieldHighlights({ ...EMPTY_SHOT_FIELD_HIGHLIGHTS, taste: true });
    setActiveTab('dial');
    window.setTimeout(() => {
      tasteInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      tasteInputRef.current?.querySelector('button')?.focus();
    }, 200);
  };

  const hasExistingUserData = shots.length > 0 || beans.length > 0;

  if (shouldDeferMainShellForFirstLaunch(settingsQueryResult, { hasExistingUserData })) {
    return null;
  }

  if (shouldRenderFirstLaunchWizard(settingsQueryResult, {
    hasExistingUserData,
  })) {
    return (
      <FirstLaunchWizard
        ui={ui}
        grinderPickerValue={setupGrinderPickerValue}
        onGrinderPickerChange={setSetupGrinderPickerValue}
        customGrinderDraft={setupCustomGrinderDraft}
        onCustomGrinderDraftChange={setSetupCustomGrinderDraft}
        smartScaleDeviceId={setupSmartScaleDeviceId}
        onSmartScaleChange={setSetupSmartScaleDeviceId}
        useSmartScale={setupUseSmartScale}
        onUseSmartScaleChange={setSetupUseSmartScale}
        setupFlairEnabled={setupFlairEnabled}
        onSetupFlairChange={setSetupFlairEnabled}
        setupPreInfusionEnabled={setupPreInfusionEnabled}
        onSetupPreInfusionChange={setSetupPreInfusionEnabled}
        setupBrewGuideEnabled={setupBrewGuideEnabled}
        onSetupBrewGuideChange={setSetupBrewGuideEnabled}
        onComplete={() => { void handleFinishFirstLaunch(); }}
      />
    );
  }

  return (
    <ShotLabPressureProvider
      settings={settingsSetting}
      onSaveCalibration={handleSaveLabGaugeCalibration}
      timerRunning={timerRunning}
      timerSeconds={timerSeconds}
      weighingViewOpen={weighingViewOpen}
      metricsGetterRef={labPressureMetricsGetterRef}
      ui={ui}
      flairProfile={activeRecipe?.flairProfile}
      timerUsePreInfusion={timerUsePreInfusion}
      preInfusionPhase={preInfusionPhase}
      extractionElapsedS={scaleExtractionElapsedS}
      liveRelativeWeightG={timemoreScale.liveRelativeWeightG}
      scaleConnected={timemoreScale.isConnected}
      targetTimeMaxS={activeRecipe?.targetTimeMaxS}
      labShotsLogged={labShotsWithPressureLogged}
      calibrateRequest={labCalibrateRequest}
      registerOpenCalibrate={(fn) => {
        labPressureOpenCalibrateRef.current = fn;
      }}
      preShotDialCheckSurface={
        (activeTab === 'dial' && activeBeansList.length > 0 && !timerRunning) || weighingViewOpen
      }
      shotReplayCommitRef={labShotReplayCommitRef}
      shotReplayDiscardRef={labShotReplayDiscardRef}
      onLabShotReplayStored={refreshLabReplayShotId}
    >
    <div className={`min-h-screen ${ui.page} relative`}>
      <LabPressurePreShotConfirm
        open={labZeroConfirmOpen}
        ui={ui}
        onYes={() => {
          labZeroConfirmedSessionRef.current = true;
          setLabZeroConfirmOpen(false);
          const opts = labPendingStartOptsRef.current || {};
          labPendingStartOptsRef.current = null;
          requestStartTimer(opts);
        }}
        onRecalibrate={() => {
          setLabZeroConfirmOpen(false);
          labPendingStartOptsRef.current = null;
          void patchGlobalSettings(db, (row) => ({
            [LAB_GAUGE_TAP_CALIBRATION_KEY]: {
              ...(row?.[LAB_GAUGE_TAP_CALIBRATION_KEY] || {}),
              viewMoved: true,
            },
          }));
          setLabCalibrateRequest((n) => n + 1);
        }}
        onCancel={() => {
          setLabZeroConfirmOpen(false);
          labPendingStartOptsRef.current = null;
        }}
      />
      <PwaInstallBanner ui={ui} darkMode={darkMode} />

      <WeighingView
        open={weighingViewOpen}
        onClose={() => setWeighingViewOpen(false)}
        ui={ui}
        liveWeightG={timemoreScale.liveWeightG}
        targetDoseG={activeRecipe?.targetDoseG}
        batteryPercent={timemoreScale.batteryPercent}
        onTare={timemoreScale.tare}
      />

      {shotCountdownOverlayVisible && (
        <div className="fixed inset-0 z-[65] flex flex-col items-center justify-center bg-[#121212] select-none pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
          <p className="text-[11px] tracking-[0.2em] uppercase text-[#9a9690] mb-6">Get ready</p>
          <p className="text-[clamp(5rem,28vw,8rem)] font-black tabular-nums text-[#ede9e3] leading-none">
            {shotCountdownValue}
          </p>
          <button
            type="button"
            onClick={cancelShotCountdown}
            className="mt-10 px-5 py-2.5 rounded-xl border border-[#3a3a3a] text-[#9a9690] text-sm font-semibold"
          >
            Cancel
          </button>
        </div>
      )}

      {/* FULL-SCREEN ACTIVE TIMER — mobile-first, tap anywhere to advance */}
      {timerRunning && !brewTimerHost && !brewGuideTimerActive && (
        <div
          className={`shot-timer-fullscreen ${shotTimerLabCompactClass(labCameraPressureEnabled)} fixed inset-0 z-[60] flex flex-col bg-[#121212] cursor-pointer select-none pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]`}
          onClick={handleTimerSurfaceTap}
          role="presentation"
        >
          <div className="shot-timer-header h-14 px-4 flex items-center justify-between border-b border-[#1e1e1e] shrink-0">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${timerRunning ? 'bg-[#3dd68c] animate-pulse' : 'bg-[#5a5754]'}`} />
              <span className="text-[11px] tracking-[0.14em] font-semibold text-[#9a9690] uppercase">
                {timerUsePreInfusion && preInfusionPhase
                  ? 'Pre-infusion'
                  : timerUsePreInfusion
                    ? `Extraction · pre ${preInfusionSeconds.toFixed(1)}s`
                    : 'Extracting'}
              </span>
            </div>
            <button
              type="button"
              data-timer-dismiss
              onClick={(e) => { e.stopPropagation(); handleCancelTimer(); }}
              className="w-9 h-9 rounded-full bg-[#1e1e1e] border border-[#262626] flex items-center justify-center"
              aria-label="Cancel timer"
            >
              <X className="w-4 h-4 text-[#9a9690]" />
            </button>
          </div>

          <div className="shot-timer-mid flex-1 flex flex-col items-center justify-start pt-2 px-5 min-h-0 overflow-hidden pointer-events-none">
            {flairEnabled && activeRecipe?.flairProfile && (
              <div className="shot-timer-profile-wrap w-full max-w-sm mb-2 shrink-0 opacity-70 max-h-[22vh] overflow-hidden">
                <PressureProfileChart
                  profile={activeRecipe.flairProfile}
                  progress={timerProgress}
                  compact
                  liveFlowSamples={scaleLiveFlowOnProfile}
                  flowTimeOffsetSec={flowChartTimeOffsetSec}
                  scaleConnected={timemoreScale.isConnected}
                  extractionElapsedS={scaleExtractionElapsedS}
                  liveRelativeWeightG={timemoreScale.liveRelativeWeightG}
                  targetTimeMaxS={activeRecipe?.targetTimeMaxS}
                  targetYieldG={activeRecipe?.targetYieldG}
                  timerRunning={timerRunning}
                  timerUsePreInfusion={timerUsePreInfusion}
                  preInfusionPhase={preInfusionPhase}
                />
              </div>
            )}

            {timerUsePreInfusion && !preInfusionPhase && (
              <div className="flex flex-wrap gap-2 justify-center mb-4">
                <span className="px-3 py-1.5 rounded-full bg-[#1e1e1e] border border-[#262626] text-[11px] text-[#6b6457]">
                  Total <span className="text-[#f5f2eb] font-semibold tabular-nums">{timerSeconds.toFixed(1)}s</span>
                </span>
                <span className="px-3 py-1.5 rounded-full bg-[#1a2a1e] border border-[#2a3a2e] text-[11px] text-[#3dd68c] font-medium tabular-nums">
                  Shot {timerDisplaySeconds.toFixed(1)}s
                </span>
              </div>
            )}

            <div
              className={`shot-timer-main-time text-[clamp(3.75rem,20vw,5.25rem)] font-bold tabular-nums tracking-[-0.06em] leading-[0.9] ${
                timerUsePreInfusion && preInfusionPhase ? 'text-[#a09880]' : 'text-[#ede9e3]'
              }`}
            >
              {formatTimerLive(timerUsePreInfusion && !preInfusionPhase ? timerDisplaySeconds : timerSeconds)}
            </div>
            {scaleShowLiveReadout && (
              <ShotTimerWeightReadout
                variant="fullscreen"
                timerRunning={timerRunning}
                showFlow={scaleShowFlow}
                instantFlowGs={timemoreScale.instantFlowGs}
                yieldSettleActive={yieldSettleActive}
                frozenYieldG={frozenShotWeightG}
              />
            )}
            <ShotLabPressureIntegration variant="fullscreen" ui={ui} />
            <ShotTimerWeightGoalLine
              enabled={shotScreenWeightGoalsEnabled}
              scaleConnected={timemoreScale.isConnected}
              scaleFeatureEnabled={scaleFeatureEnabled}
              flairProfile={activeRecipe?.flairProfile}
              targetYieldG={activeRecipe?.targetYieldG}
              timerRunning={timerRunning}
              timerUsePreInfusion={timerUsePreInfusion}
              preInfusionPhase={preInfusionPhase}
              extractionElapsedS={scaleExtractionElapsedS}
              liveRelativeWeightG={timemoreScale.liveRelativeWeightG}
              targetTimeMaxS={activeRecipe?.targetTimeMaxS}
            />
            <p className="shot-timer-total-label text-[11px] text-[#6b6457] mt-2 text-center shrink-0">
              {timerUsePreInfusion && preInfusionPhase
                ? `Total ${timerSeconds.toFixed(1)}s · pre-infusing`
                : timerUsePreInfusion
                  ? `Total ${timerSeconds.toFixed(1)}s · extraction`
                  : 'Total extraction time'}
            </p>
          </div>

          <div className="shot-timer-footer px-4 pb-6 pt-1 space-y-3 max-w-md mx-auto w-full shrink-0">
            <div className="w-full h-1 bg-[#1e1e1e] rounded-full overflow-hidden pointer-events-none">
              <div
                className="h-full bg-[#c88a4b] transition-[width] duration-100 ease-linear"
                style={{ width: `${timerProgress * 100}%` }}
              />
            </div>

            <p className="shot-timer-hint text-center text-[11px] text-[#4a4846] pointer-events-none">
              {timerUsePreInfusion && preInfusionPhase
                ? 'Tap anywhere to end pre-infusion'
                : 'Tap anywhere to stop and fill shot time'}
            </p>

            <div className="flex flex-col gap-3 pointer-events-auto">
              {timerUsePreInfusion && preInfusionPhase ? (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handleEndPreInfusion(); }}
                  className="w-full min-h-[64px] rounded-[18px] bg-[#ede6dd] text-[#121212] font-bold text-[15px] active:scale-[0.99]"
                >
                  End pre-infusion
                </button>
              ) : (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handleStopTimer(); }}
                  className="shot-timer-stop-btn w-full min-h-[72px] rounded-[20px] bg-[#ede6dd] text-[#121212] font-bold text-base active:scale-[0.99] shadow-[0_12px_32px_rgba(237,230,221,0.2)]"
                >
                  Stop shot
                </button>
              )}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); handleCancelTimer(); }}
                className="shot-timer-cancel-btn w-full min-h-[48px] rounded-[14px] bg-[#1e1e1e] border border-[#262626] text-[13px] font-medium text-[#6b6457]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main scrollable content — padded for fixed bottom nav (+ log bar on dial) */}
      <div className={`max-w-xl mx-auto px-4 pt-5 ${
        activeTab === 'dial' && activeBeansList.length > 0
          ? 'pb-40'
          : activeTab === 'beans'
            ? 'pb-32'
            : 'pb-24'
      }`}>
        
        <header className={`flex items-center justify-between pb-5 mb-6 border-b ${ui.headerBorder}`}>
          <div
            className="flex items-center gap-3 cursor-pointer select-none"
            onClick={handleLogoClick}
            title="Espresso Dial-In"
            data-testid="app-header-logo"
          >
            <img
              src={darkMode ? '/logo-header-dark.svg' : '/logo-header-light.svg'}
              alt="Espresso Dial-In"
              width={32}
              height={32}
              className="w-8 h-8"
            />
            <div>
              <h1 className={`text-base font-bold ${ui.text} tracking-tight leading-none`}>Espresso Dial-In</h1>
              <p className={`text-[10px] ${ui.muted} tracking-widest uppercase mt-0.5`}>Precision dial-in</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsSettingsOpen(true)}
              className={`p-2 ${ui.ghostBtn} hover:text-[#c88a4b] transition-colors`}
              title="Settings"
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* ── TAB CONTENT ─────────────────────────────────────────────────── */}

        {activeTab === 'dial' && (
          <div className="space-y-4">
            {activeBeansList.length === 0 ? (
              <div className={`${ui.card} p-10 rounded-2xl text-center space-y-4`}>
                <p className="text-[#6b6457] text-sm">No active coffee bean profiles.</p>
                <button onClick={() => setActiveTab('beans')} className="bg-[#c88a4b] hover:bg-[#e0a660] text-[#121110] font-bold px-6 py-3 rounded-xl text-sm transition-colors">
                  Add Your First Bean
                </button>
              </div>
            ) : (
              <>
                {/* ── BEAN + RECIPE (top card) ─────────────────────────── */}
                <div className={`${ui.card} p-4 rounded-2xl space-y-3`} data-testid="dial-bean-card">
                  <select
                    data-testid="dial-bean-select"
                    value={effectiveBeanId}
                    onChange={(e) => selectActiveBean(e.target.value)}
                    className={`bg-transparent ${ui.text} font-bold text-base focus:outline-none w-full truncate`}
                  >
                    {activeBeansList.map(b => (
                      <option key={b.id} value={b.id} className="bg-[#1a1815]">
                        {formatBeanDisplayName(b)}{beanIsDecaf(b) ? ' · Decaf' : ''}{b.rating ? ` [${Number(b.rating).toFixed(1)}]` : ''}
                      </option>
                    ))}
                  </select>
                  <div
                    className="flex items-center justify-between gap-2 min-w-0"
                    data-testid="dial-bean-actions"
                  >
                    <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                      {activeBean?.storageType === 'frozen' && (
                        <button type="button" onClick={handleThawNewBag} className={`text-[10px] ${ui.accentText} font-semibold hover:underline shrink-0`}>
                          Thaw new bag
                        </button>
                      )}
                      {activeBean?.storageType === 'frozen' && activeBean.thawHistory?.length > 0 && (
                        <button type="button" onClick={handleReverseThaw} className={`text-[10px] ${ui.sub} flex items-center gap-1 shrink-0`}>
                          <RotateCcw className="w-3 h-3" /> Undo thaw
                        </button>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleToggleFinished(activeBean.id, activeBean.isFinished)}
                      data-testid="mark-bean-finished"
                      className={`text-[11px] font-semibold px-3 py-2 rounded-lg border min-h-[40px] shrink-0 ${
                        activeBean.isFinished
                          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                          : `${ui.secondaryBtn}`
                      }`}
                    >
                      {activeBean.isFinished ? 'Mark beans as active' : 'Mark beans as finished'}
                    </button>
                  </div>

                  {activeRecipe && (
                    <div className="grid grid-cols-3 gap-2 text-center">
                      {[
                        { label: 'Target dose', value: `${activeRecipe.targetDoseG || 18}g` },
                        { label: 'Yield', value: `${activeRecipe.targetYieldG || 36}g` },
                        { label: 'Time', value: `${activeRecipe.targetTimeMinS || 27}–${activeRecipe.targetTimeMaxS || 32}s` },
                      ].map((cell) => (
                        <div key={cell.label} className={`${ui.cardInset} rounded-xl p-3`}>
                          <p className={`text-[9px] uppercase tracking-wider ${ui.muted} mb-1`}>{cell.label}</p>
                          <p className={`text-lg font-black ${ui.text}`}>{cell.value}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span className={ui.sub}>
                      {activeBean?.storageType} • {activeBean?.roastType} roast
                      {beanIsDecaf(activeBean) ? ' • Decaf' : ''}
                      {activeRecipe?.brewTemperatureC ? ` • ${activeRecipe.brewTemperatureC}°C` : ''}
                    </span>
                    {beanAgeInfo && (
                      <span className={`${ui.badge} px-2 py-0.5 rounded-full text-[10px] font-semibold`}>
                        Effective age: {beanAgeInfo.daysOld} days
                      </span>
                    )}
                  </div>

                  {beanAgeInfo?.notice && (
                    <p className={`text-[10px] ${ui.accentText} ${ui.freezeHint} p-2.5 rounded-lg`}>{beanAgeInfo.notice}</p>
                  )}

                  {flairEnabled && activeRecipe && (
                    <div className={`pt-3 border-t ${ui.headerBorder} space-y-3`}>
                      <div className="flex items-end justify-between gap-2">
                        <p className={`text-[10px] uppercase tracking-wider ${ui.muted}`}>Pressure profile</p>
                        <button type="button" onClick={handleEditOnBeansFromDial} className={`text-[10px] ${ui.accentText} font-semibold`}>
                          Edit on Beans
                        </button>
                      </div>
                      <div className={`${ui.cardInset} rounded-xl px-3 py-2`}>
                        <PressureProfileChart
                          profile={activeRecipe.flairProfile}
                          progress={timerRunning ? timerProgress : null}
                          liveFlowSamples={scaleLiveFlowOnProfile}
                          flowTimeOffsetSec={flowChartTimeOffsetSec}
                          scaleConnected={timemoreScale.isConnected}
                          extractionElapsedS={scaleExtractionElapsedS}
                          liveRelativeWeightG={timemoreScale.liveRelativeWeightG}
                          targetTimeMaxS={activeRecipe?.targetTimeMaxS}
                          targetYieldG={activeRecipe?.targetYieldG}
                          timerRunning={timerRunning}
                          timerUsePreInfusion={timerUsePreInfusion}
                          preInfusionPhase={preInfusionPhase}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* ── GRIND ADJUSTMENT HERO ───────────────────────────── */}
                <div ref={recommendationRef} data-testid="grind-adjustment-card" className={`${ui.card} p-4 rounded-2xl space-y-3 shadow-[0_8px_28px_rgba(0,0,0,0.28)]`}>
                  <div className="flex justify-between items-center">
                    <p className={`text-[10px] font-bold uppercase tracking-[0.22em] ${ui.accentText}`}>Grind adjustment</p>
                    <span className={`text-[10px] ${ui.muted} tabular-nums`}>
                      {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                  </div>

                  {dynamicRec?.ageWarning && (
                    <div className={`flex items-start gap-2 text-xs ${ui.accentText} ${ui.freezeHint} p-3 rounded-xl`}>
                      <Flame className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>{dynamicRec.ageWarning}</span>
                    </div>
                  )}

                  <div className="flex items-end gap-3 flex-wrap">
                    <p className={`text-5xl sm:text-6xl font-black font-mono leading-none ${ui.text}`}>{recommendedGrindDisplay}</p>
                    <div className="flex flex-col gap-1.5 mb-1">
                      <span className={`text-[10px] ${ui.cardInset} px-2.5 py-1 rounded-lg font-semibold ${ui.sub}`}>{grinderBadgeLabel}</span>
                      {showHeldbackEstimatedStartingCard && (
                        <span
                          className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md text-center ${ui.cardInset} ${ui.accentText}`}
                        >
                          Estimated
                        </span>
                      )}
                      {lastShotOutcome?.statusLabel && (
                        <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md text-center ${lastShotOutcome.isDialledIn ? ui.badge : `${ui.cardInset} ${ui.muted}`}`}>
                          {lastShotOutcome.statusLabel}
                        </span>
                      )}
                    </div>
                  </div>

                  {dynamicRec?.previousRecipeDisclaimer && (
                    <p className={`text-[10px] ${ui.muted} leading-relaxed`}>{dynamicRec.previousRecipeDisclaimer}</p>
                  )}
                  {grindRecommendationSummary && (
                    <p className={`text-sm ${ui.sub} leading-relaxed`}>{grindRecommendationSummary}</p>
                  )}
                  {displayDynamicRec?.basketChangeNote && (
                    <p className={`text-[10px] ${ui.accentText} font-semibold`}>{displayDynamicRec.basketChangeNote}</p>
                  )}
                  {recommendationEvidenceContext && !nicheLearningBlocksEvidence && (
                    <p className={`text-[10px] ${ui.muted}`}>{recommendationEvidenceContext}</p>
                  )}
                  {dynamicRec?.nicheLearningNote && !dynamicRec?.outlierGrindHeld && (
                    <p className={`text-[10px] ${ui.muted} leading-relaxed`}>{dynamicRec.nicheLearningNote}</p>
                  )}
                  {dynamicRec?.nicheEmpiricalValidationNote && (
                    <p className={`text-[10px] ${ui.muted} leading-relaxed`}>{dynamicRec.nicheEmpiricalValidationNote}</p>
                  )}
                  {decafNote && (
                    <p className={`text-[10px] ${ui.accentText} ${ui.freezeHint} p-2.5 rounded-lg`}>{decafNote}</p>
                  )}
                  {!dynamicRec && beanShotsForGrinder.length === 0 && (
                    <>
                      <p className={`text-sm ${ui.sub}`}>Start here, then log your first shot to begin dialling in.</p>
                      {initialGrindHint && (
                        <p className={`text-[10px] ${ui.muted}`}>{initialGrindHint}</p>
                      )}
                      {initialGrindSetting && !initialGrindHint && (
                        <p className={`text-[10px] ${ui.muted}`}>Based on previous bean history</p>
                      )}
                    </>
                  )}

                  {dynamicRec?.flairWaterTempAdvice && (
                    <div className={`text-xs ${ui.accentText} ${ui.freezeHint} p-3 rounded-xl`}>
                      {dynamicRec.flairWaterTempAdvice}
                    </div>
                  )}
                  {dynamicRec?.warning && (
                    <div className="flex items-start gap-1.5 bg-[rgba(180,60,60,0.08)] border border-[rgba(180,60,60,0.2)] p-2 rounded-lg text-[10px] leading-snug text-[#d08080]">
                      <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                      <span className="min-w-0">{dynamicRec.warning}</span>
                    </div>
                  )}
                  {dynamicRec?.subRecommendation && (
                    <p className={`text-xs ${ui.sub}`}>{dynamicRec.subRecommendation}</p>
                  )}

                  {applyRecConfirmation && (
                    <p className={`text-xs font-semibold ${ui.accentText}`} role="status">
                      {applyRecConfirmation}
                    </p>
                  )}

                  <div className={`space-y-2 pt-3 border-t ${ui.headerBorder}`}>
                    <p
                      data-testid="grind-card-last-shot-note"
                      className={`text-xs ${ui.muted} min-w-0 w-full leading-snug`}
                    >
                      {lastLoggedShot
                        ? `Last shot ${lastLoggedShot.actualTimeS || 0}s (${tasteProfileDisplayLabel(lastLoggedShot.tasteProfile)})${lastShotOutcome?.statusLabel ? ` · ${lastShotOutcome.statusLabel}` : ''}${lastLoggedShot.excludeFromLearning ? ` · kept in history, not used for learning${lastLoggedShot.knownIssueReason ? ` (${knownIssueReasonLabel(lastLoggedShot.knownIssueReason)})` : ''}` : ''}${lastLearningShot && lastLearningShot.id !== lastLoggedShot?.id ? ' · grind from earlier shot' : ''}${formatLastShotUserNoteSuffix(lastLoggedShot.notes)} · logging ${currentGrindLabel}`
                        : `Logging grind ${currentGrindLabel}`}
                    </p>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setBasketChangePromptOpen(true)}
                        className={`text-[10px] px-3 py-2 rounded-lg ${ui.secondaryBtn} font-semibold opacity-80`}
                      >
                        Changed basket
                      </button>
                      {displayDynamicRec?.recommendedSetting && (
                        <button
                          type="button"
                          onClick={applyRecommendation}
                          className={`text-xs px-4 py-2.5 rounded-xl flex items-center gap-1 min-h-[44px] shrink-0 transition-colors ${ui.applyRec}`}
                        >
                          Apply rec <ArrowRight className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {basketChangePromptOpen && (
                  <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-4 bg-black/70">
                    <div className={`${ui.card} rounded-2xl max-w-sm w-full p-5 space-y-4 shadow-xl`}>
                      <h3 className={`text-sm font-bold ${ui.text}`}>Basket change</h3>
                      <p className={`text-xs ${ui.muted}`}>
                        Apply a one-time grind tweak to the next recommendation only (not saved to your learning model).
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setAppliedRecommendationDisplay(null);
                          setPendingBasketAdjustment(BASKET_FLOW_MORE_HOLES);
                          setBasketChangePromptOpen(false);
                        }}
                        className={`w-full text-left px-4 py-3 rounded-xl ${ui.secondaryBtn} text-sm font-semibold`}
                      >
                        More holes / faster flow
                        <span className={`block text-[10px] font-normal ${ui.muted} mt-0.5`}>Grind a little finer for the next suggestion</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAppliedRecommendationDisplay(null);
                          setPendingBasketAdjustment(BASKET_FLOW_FEWER_HOLES);
                          setBasketChangePromptOpen(false);
                        }}
                        className={`w-full text-left px-4 py-3 rounded-xl ${ui.secondaryBtn} text-sm font-semibold`}
                      >
                        Fewer holes / tighter flow
                        <span className={`block text-[10px] font-normal ${ui.muted} mt-0.5`}>Grind a little coarser for the next suggestion</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setBasketChangePromptOpen(false)}
                        className={`w-full py-2.5 text-xs font-bold ${ui.ghostBtn}`}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {showBrewGraduationPrompt && (
                  <BrewGraduationPrompt
                    ui={ui}
                    onUseQuickChecklist={handleUseQuickChecklist}
                    onKeepFullGuide={handleKeepFullBrewGuide}
                    onNoChecklist={handleNoBrewChecklist}
                    onDismiss={handleKeepFullBrewGuide}
                  />
                )}

                {brewGuideEnabled && brewGuidanceMode === BREW_GUIDANCE_MODES.quick && activeBean && activeRecipe && (
                  <QuickChecklistCard
                    ui={ui}
                    accessories={brewGuideAccessories}
                    dial={{
                      beanName: activeBean?.name || '',
                      doseG: activeRecipe?.targetDoseG,
                      yieldG: activeRecipe?.targetYieldG,
                      timeMinS: activeRecipe?.targetTimeMinS,
                      timeMaxS: activeRecipe?.targetTimeMaxS,
                      brewTemperatureC: activeRecipe?.brewTemperatureC,
                      grinderModel,
                      grindLabel: recommendedGrindDisplay || currentGrindLabel,
                      previousGrindLabel,
                    }}
                    onOpenFullGuide={() => setActiveTab('brew')}
                    onRevertToFullGuide={handleRevertToFullBrewGuide}
                    onNoChecklist={handleNoBrewChecklist}
                    onEditAccessories={handleOpenBrewAccessories}
                  />
                )}

                {/* ── SHOT LOG FORM ─────────────────────────────────────── */}
                <form onSubmit={handleLogShot} className="space-y-3">

                  {validationError && (
                    <div className="bg-[rgba(180,60,60,0.12)] border border-[rgba(180,60,60,0.3)] p-3 rounded-xl text-xs text-[#d08080] font-semibold flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>{validationError}</span>
                    </div>
                  )}

                  <div className={`${ui.card} p-4 rounded-2xl space-y-3`}>
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <p className={`text-[10px] uppercase tracking-widest ${ui.muted} mb-1.5`}>Live shot timer</p>
                        <span className={`text-4xl font-black font-mono tabular-nums ${ui.text}`}>{formatTime(timerSeconds)}</span>
                        {scaleShowLiveReadout && (
                          <ShotTimerWeightReadout
                            variant="dial-inline"
                            timerRunning={timerRunning}
                            showFlow={scaleShowFlow}
                            instantFlowGs={timemoreScale.instantFlowGs}
                            darkMode={darkMode}
                            ui={ui}
                            yieldSettleActive={yieldSettleActive}
                            frozenYieldG={frozenShotWeightG}
                          />
                        )}
                        {!timerRunning && (
                          <ShotLabPressureIntegration variant="inline" ui={ui} />
                        )}
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button type="button" onClick={() => requestStartTimerWithLab()} className="px-6 py-3.5 min-h-[48px] bg-[#c88a4b] hover:bg-[#e0a660] text-[#121110] rounded-xl font-bold flex items-center gap-2 transition-colors">
                          <Play className="w-4 h-4 fill-current" /> Start
                        </button>
                        <button type="button" onClick={handleResetTimer} className={`p-3.5 min-h-[48px] min-w-[48px] ${ui.secondaryBtn} rounded-xl`}>
                          <RotateCcw className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    {labCameraPressureEnabled && (
                      <LabPressureStartPanel
                        enabled={labCameraPressureEnabled}
                        calibrated={Boolean(labGaugeTapCalibrationFromSettings(settingsSetting))}
                        viewMoved={settingsSetting?.labGaugeTapCalibration?.viewMoved === true}
                        readerReady={true}
                        onRecalibrate={() => setLabCalibrateRequest((n) => n + 1)}
                        ui={ui}
                      />
                    )}
                    {scaleFeatureEnabled && !devUrlSimScaleActive && (
                      <ScaleTimerControls
                        ui={ui}
                        simAllowed={timemoreScale.simAllowed}
                        bleAvailable={timemoreScale.bleAvailable}
                        transportKind={timemoreScale.transportKind}
                        onTransportKindChange={timemoreScale.setTransportKind}
                        connectStatus={timemoreScale.connectStatus}
                        isConnected={timemoreScale.isConnected}
                        liveWeightG={timemoreScale.liveWeightG}
                        batteryPercent={timemoreScale.batteryPercent}
                        timerRunning={timerRunning}
                        onOpenWeighingView={() => setWeighingViewOpen(true)}
                        onConnect={timemoreScale.connect}
                        onDisconnect={() => {
                          setWeighingViewOpen(false);
                          timemoreScale.disconnect();
                        }}
                        onTare={timemoreScale.tare}
                        scaleDebugLines={scaleDebugLines}
                      />
                    )}
                    {labCameraPressureEnabled && (
                      <LabPreShotDialUnderScale
                        labEnabled={labCameraPressureEnabled}
                        calibrated={Boolean(labGaugeTapCalibrationFromSettings(settingsSetting))}
                        timerRunning={timerRunning}
                        ui={ui}
                      />
                    )}
                    <p className="text-[10px] text-[#6b6457]">Fullscreen timer: tap anywhere to end pre-infusion, then tap again to stop.</p>
                  </div>

                  {/* Grind setting */}
                  <div ref={grindSettingsRef} className={`${ui.card} p-4 rounded-2xl transition-all duration-300 ${highlightGrind ? 'ring-2 ring-[#c88a4b] border-[#c88a4b]/60' : ''}`}>
                    <div className="flex justify-between items-center mb-3">
                      <p className={`text-[10px] uppercase tracking-widest ${ui.muted}`}>Grind setting used</p>
                      <span className={`text-[10px] ${ui.accentText} font-semibold`}>{grinderModel}</span>
                    </div>

                    <GrinderGrindControls
                      grinderModel={grinderModel}
                      settings={appSettings}
                      setteMacro={setteMacro}
                      setteMicro={setteMicro}
                      sunbeamSetting={sunbeamSetting}
                      nicheZeroSetting={nicheZeroSetting}
                      customGrindValue={effectiveCustomGrindValue}
                      onSetteMacroChange={handleSetteMacroChange}
                      onSetteMicroChange={handleSetteMicroChange}
                      onSunbeamChange={handleSunbeamChange}
                      onCustomGrindChange={handleCustomGrindChange}
                      onNicheZeroChange={handleNicheZeroChange}
                      ui={ui}
                    />
                    <PresetGrinderAuxFields
                      grinderModel={grinderModel}
                      settings={appSettings}
                      inputClass={inputClass}
                      ui={ui}
                      onPatchSettings={(patch) => patchBrewGuidanceSettings(patch)}
                    />

                    <div className="mt-4 flex items-center justify-between pt-3 border-t border-[#2e2b26]">
                      <span className="text-sm text-[#a09880]">Grinder purged?</span>
                      <button
                        type="button"
                        onClick={() => setWasPurged(!wasPurged)}
                        className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors ${wasPurged ? 'bg-[rgba(200,138,75,0.12)] text-[#c88a4b] border border-[rgba(200,138,75,0.3)]' : 'bg-[rgba(180,60,60,0.1)] text-[#d08080] border border-[rgba(180,60,60,0.2)]'}`}
                      >
                        {wasPurged ? 'Yes — Purged' : 'No — Unpurged ⚠️'}
                      </button>
                    </div>
                  </div>

                  {/* Dose / Yield / Time */}
                  <div className="grid grid-cols-3 gap-2">
                    <div
                      ref={doseInputRef}
                      className={`${ui.card} p-3 rounded-2xl transition-all duration-300 ${shotFieldAttentionClass(shotFieldHighlights.dose)}`}
                    >
                      <label className={`${ui.fieldLabel} block mb-2`}>Dose (g)</label>
                      <input
                        type="number" step="0.1"
                        value={actualDoseG}
                        onChange={(e) => {
                          setActualDoseG(e.target.value);
                          setShotFieldHighlights((prev) => ({ ...prev, dose: false }));
                        }}
                        className={`w-full bg-transparent ${ui.text} text-center text-xl font-black focus:outline-none`}
                      />
                    </div>
                    <div
                      ref={yieldInputRef}
                      data-testid="dial-yield-tile"
                      className={`${ui.card} p-3 rounded-2xl transition-all duration-300 ${shotFieldAttentionClass(shotFieldHighlights.yield)}${perfectShotYieldRing ? ' perfect-shot-yield-ring' : ''}`}
                      style={
                        perfectShotYieldRing
                          ? {
                              '--perfect-shot-celebration-duration': `${PERFECT_SHOT_CELEBRATION_MS}ms`,
                            }
                          : undefined
                      }
                    >
                      <label className={`${ui.fieldLabel} block mb-2`}>Yield (g) *</label>
                      <input
                        type="number" step="0.1"
                        placeholder="36"
                        value={yieldDisplayValue}
                        readOnly={yieldTileCelebrating}
                        onChange={(e) => {
                          if (yieldSettleActive) yieldSettleUserEditedRef.current = true;
                          setActualYieldG(e.target.value);
                          setShotFieldHighlights((prev) => ({ ...prev, yield: false }));
                        }}
                        className={`w-full bg-transparent ${ui.text} text-center text-xl font-black focus:outline-none ${darkMode ? 'placeholder:text-[#6b6457]' : 'placeholder:text-[#8a8276]'}${yieldTileCelebrating ? ' perfect-shot-yield-value' : ''}`}
                      />
                      <p
                        className={`text-[9px] text-center mt-1 ${yieldTileCelebrating ? 'perfect-shot-yield-ratio' : ui.accentText}`}
                        data-testid="dial-yield-ratio"
                      >
                        {yieldRatioLine}
                      </p>
                      {yieldSettleActive && (
                        <p className={`text-[10px] ${ui.muted} text-center mt-2`} role="status">
                          Reading final weight…
                        </p>
                      )}
                    </div>
                    <div
                      ref={timeInputRef}
                      data-testid="dial-time-tile"
                      className={`${ui.card} p-3 rounded-2xl transition-all duration-300 ${shotFieldAttentionClass(shotFieldHighlights.time)}`}
                    >
                      <label className={`${ui.fieldLabel} block mb-2`}>Time (s) *</label>
                      <input
                        type="number"
                        placeholder="28"
                        value={actualTimeS}
                        onChange={(e) => {
                          setActualTimeS(e.target.value);
                          setShotFieldHighlights((prev) => ({ ...prev, time: false }));
                        }}
                        className={`w-full bg-transparent ${ui.text} text-center text-xl font-black focus:outline-none ${darkMode ? 'placeholder:text-[#6b6457]' : 'placeholder:text-[#8a8276]'}`}
                      />
                      {yieldTileCelebrating && (
                        <p className="text-[8px] perfect-shot-time-in-range text-center mt-1" data-testid="dial-time-in-range">
                          in range
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Taste selector */}
                  <div
                    className={`${ui.card} p-4 rounded-2xl space-y-3 transition-all duration-300 ${shotFieldAttentionClass(shotFieldHighlights.taste)}`}
                    ref={tasteInputRef}
                  >
                    <label className={ui.fieldLabel}>Extraction taste *</label>
                    <div className="grid grid-cols-5 gap-1.5">
                      {[
                        { id: 'very_sour', label: 'V.Sour' },
                        { id: 'sour', label: 'Sour' },
                        { id: BALANCED_TASTE_PROFILE, label: 'Balanced' },
                        { id: 'bitter', label: 'Bitter' },
                        { id: 'very_bitter', label: 'V.Bitter' }
                      ].map(f => (
                        <button
                          type="button"
                          key={f.id}
                          onClick={() => {
                            setTasteProfile(f.id);
                            setShotFieldHighlights((prev) => ({ ...prev, taste: false }));
                          }}
                          className={`py-3 text-[10px] font-bold rounded-xl border transition-all ${
                            tasteProfilesMatch(tasteProfile, f.id)
                              ? 'bg-[#c88a4b] border-[#c88a4b] text-[#121110]'
                              : 'bg-[#211e1a] text-[#a09880] border-[#2e2b26] hover:border-[#3d3830]'
                          }`}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>

                    {/* Star rating */}
                    <div className="flex items-center justify-between pt-2 border-t border-[#2e2b26]">
                      <span className="text-xs text-[#6b6457]">Shot rating (optional)</span>
                      <div className="flex gap-1">
                        {[1,2,3,4,5].map(star => (
                          <button
                            type="button"
                            key={star}
                            onClick={() => setShotRating(star)}
                            className={`p-1 transition-colors ${shotRating !== null && star <= shotRating ? 'text-[#c88a4b]' : 'text-[#3d3830] hover:text-[#6b6457]'}`}
                          >
                            <Star className="w-5 h-5 fill-current" />
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Notes */}
                  <div
                    ref={notesCardRef}
                    data-testid="dial-notes-card"
                    className={`${ui.card} rounded-2xl p-3 relative overflow-hidden`}
                  >
                    <input
                      type="text"
                      placeholder="Notes — puck prep, channeling, batch size…"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className={`w-full ${inputClass} rounded-xl p-3 text-sm bg-transparent border-0`}
                    />
                    {perfectShotCelebration && (
                      <div className="perfect-shot-cameo-slot" data-testid="perfect-shot-cameo-slot">
                        <PerfectShotCelebration
                          variant={perfectShotCelebration.variant}
                          onComplete={clearPerfectShotCelebration}
                        />
                      </div>
                    )}
                  </div>

                  <div className={`${ui.card} p-4 rounded-2xl space-y-3`}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <span className={`font-bold block text-sm ${ui.text}`}>Known issue — don&apos;t use for learning</span>
                        <span className={`text-[10px] ${ui.muted}`}>Keep this shot in history without changing future grind advice.</span>
                      </div>
                      <SettingsToggle
                        checked={excludeFromLearning}
                        onChange={setExcludeFromLearning}
                        label="Known issue — don't use for learning"
                      />
                    </div>
                    {excludeFromLearning && (
                      <div className="space-y-2 pt-1 border-t border-[#2e2b26]">
                        <label className={ui.fieldLabel}>What happened?</label>
                        <select
                          value={knownIssueReason}
                          onChange={(e) => setKnownIssueReason(e.target.value)}
                          className={`w-full ${inputClass} border rounded-xl px-3 py-2.5 text-sm`}
                        >
                          {Object.entries(KNOWN_ISSUE_REASONS).map(([key, label]) => (
                            <option key={key} value={key}>{label}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  {/* Submit — fixed above tab bar */}
                  <div className={`fixed bottom-[4.25rem] left-0 right-0 p-3 ${ui.dock} backdrop-blur z-40`}>
                    <div className="max-w-xl mx-auto">
                      <button
                        type="submit"
                        className="w-full bg-[#c88a4b] hover:bg-[#e0a660] text-[#121110] font-black py-4 rounded-xl shadow-lg transition-colors text-sm tracking-wide"
                      >
                        Log shot & calculate grind adjustment
                      </button>
                    </div>
                  </div>
                </form>
              </>
            )}
          </div>
        )}

        {activeTab === 'brew' && brewGuideEnabled && (
          <BrewGuide
            ui={ui}
            accessories={brewGuideAccessories}
            setupComplete={brewGuideSetupComplete}
            onSaveAccessories={handleSaveBrewAccessories}
            onOpenDial={() => setActiveTab('dial')}
            onOpenBeans={() => setActiveTab('beans')}
            hasActiveBean={activeBeansList.length > 0}
            onStartTimer={handleBrewStartTimer}
            onStopTimer={handleStopTimer}
            onResetTimer={handleBrewResetTimer}
            onEndPreInfusion={handleEndPreInfusion}
            onHandoff={handleBrewHandoff}
            onTimerHost={setBrewTimerHost}
            guidanceMode={brewGuidanceMode}
            onUseQuickChecklist={handleUseQuickChecklist}
            onNoChecklist={handleNoBrewChecklist}
            accessoriesOpenRequest={brewAccessoriesOpenRequest}
            accessoriesReturnTo={brewAccessoriesReturnTo}
            onAccessoriesExit={handleExitBrewAccessories}
            onAccessoriesOpenHandled={handleAccessoriesOpenHandled}
            scaleLiveReadoutEnabled={
              scaleFeatureEnabled && timemoreScale.isConnected
            }
            timer={{
              running: timerRunning,
              countdownActive: brewGuideExtractCountdownActive,
              countdownHandoffPending,
              yieldSettleActive,
              frozenShotWeightG,
              label: formatTimerLive(usePreInfusion && !preInfusionPhase ? timerDisplaySeconds : timerSeconds),
              usePreInfusion,
              preInfusionPhase,
            }}
            dial={buildBrewGuideDialPayload({
              beanName: activeBean?.name,
              targetDoseG: activeRecipe?.targetDoseG,
              targetYieldG: activeRecipe?.targetYieldG,
              targetTimeMinS: activeRecipe?.targetTimeMinS,
              targetTimeMaxS: activeRecipe?.targetTimeMaxS,
              brewTemperatureC: activeRecipe?.brewTemperatureC,
              grinderModel,
              grindLabel: recommendedGrindDisplay || currentGrindLabel,
              previousGrindLabel,
              flairEnabled,
              scaleConnected: scaleFeatureEnabled && timemoreScale.isConnected,
            })}
          />
        )}

        {activeTab === 'beans' && (
          <div className="space-y-6">
            <form onSubmit={handleSaveBean} className={`${ui.card} p-5 rounded-2xl space-y-4 relative overflow-hidden`}>
              {isEditingBean && (
                <div className="absolute top-0 left-0 right-0 bg-[#c88a4b] text-[#121110] text-[10px] font-black uppercase text-center py-1">
                  Editing Mode Active
                </div>
              )}
              
              <div className="flex justify-between items-center mb-2 pt-2">
                <h2 className={ui.pageTitle}>
                  {isEditingBean ? 'Edit coffee profile' : 'Configure new coffee profile'}
                </h2>
                {isEditingBean && (
                  <button type="button" onClick={cancelEditBean} className={`text-xs ${ui.ghostBtn} font-bold underline`}>
                    Cancel
                  </button>
                )}
              </div>
              
              <div>
                <label className={`${ui.fieldLabel} block mb-1`}>Bean name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. House Espresso Blend"
                  value={newBean.name}
                  onChange={(e) => setNewBean({ ...newBean, name: e.target.value })}
                  className={`w-full ${inputClass} border rounded-lg p-2.5 text-sm`}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={`text-xs uppercase font-bold ${labelClass} block mb-1`}>Roaster</label>
                  <input
                    type="text"
                    placeholder="e.g. Local Roaster"
                    value={newBean.roaster}
                    onChange={(e) => setNewBean({ ...newBean, roaster: e.target.value })}
                    className={`w-full ${inputClass} border rounded-lg p-2.5 text-sm`}
                  />
                </div>
                <div>
                  <label className={`text-xs uppercase font-bold ${labelClass} block mb-1`}>Roast Type</label>
                  <select
                    value={newBean.roastType}
                    onChange={(e) => setNewBean({ ...newBean, roastType: e.target.value })}
                    className={`w-full ${inputClass} border rounded-lg p-2.5 text-sm`}
                  >
                    <option value="Light">Light</option>
                    <option value="Medium">Medium</option>
                    <option value="Dark">Dark</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={`text-xs uppercase font-bold ${labelClass} block mb-1`}>Roast Date</label>
                  <input
                    type="date"
                    value={newBean.roastDate}
                    onChange={(e) => {
                      setNewBean({ ...newBean, roastDate: e.target.value });
                      if (e.target.value) setBeanFieldErrors((prev) => ({ ...prev, roastDate: '' }));
                    }}
                    aria-invalid={Boolean(beanFieldErrors.roastDate)}
                    aria-describedby={beanFieldErrors.roastDate ? 'roast-date-error' : undefined}
                    className={`w-full ${inputClass} border rounded-lg p-2.5 text-sm ${beanFieldErrors.roastDate ? 'border-[rgba(180,60,60,0.55)]' : ''}`}
                  />
                  {beanFieldErrors.roastDate && (
                    <p id="roast-date-error" className="text-[11px] text-[#d08080] mt-1 font-semibold">
                      {beanFieldErrors.roastDate}
                    </p>
                  )}
                </div>
                <div>
                  <label className={`text-xs uppercase font-bold ${labelClass} block mb-1`}>Storage Method</label>
                  <select
                    value={newBean.storageType}
                    onChange={(e) => setNewBean({ ...newBean, storageType: e.target.value })}
                    className={`w-full ${inputClass} border rounded-lg p-2.5 text-sm`}
                  >
                    <option value="bag">Standard Bag</option>
                    <option value="vacuum">Vacuum Sealed Bag</option>
                    <option value="frozen">Frozen Storage</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <div>
                  <span className={`font-bold block text-sm ${ui.text}`}>Decaf</span>
                  <span className={`text-[10px] ${ui.muted}`}>Caffeine has been removed. Grind advice still follows your shots.</span>
                </div>
                <SettingsToggle
                  checked={newBean.isDecaf === true}
                  onChange={(checked) => setNewBean({ ...newBean, isDecaf: checked })}
                  label="Decaf"
                />
              </div>

              {newBean.storageType === 'frozen' && (
                <div className={`space-y-3 ${ui.freezeHint} p-3 rounded-xl`}>
                  <div className="flex flex-col text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className={currentTheme.text}>💡 Ideal freezing window</span>
                      <strong className={ui.text}>{getIdealFreezeWindow(newBean.roastType).label}</strong>
                    </div>
                    <span className={`text-[9px] ${ui.sub} italic`}>Thaw to room temp while still sealed to prevent condensation.</span>
                  </div>
                  <div>
                    <label className={`text-[10px] uppercase font-bold ${labelClass} block mb-1`}>Freezing Date</label>
                    <input
                      type="date"
                      value={newBean.freezeDate}
                      onChange={(e) => setNewBean({ ...newBean, freezeDate: e.target.value })}
                      className={`w-full ${inputClass} border rounded-lg p-2 text-xs`}
                    />
                  </div>
                  <div>
                    <label className={`text-[10px] uppercase font-bold ${labelClass} block mb-1`}>Post-Thaw Storage Method</label>
                    <select
                      value={newBean.postThawStorage}
                      onChange={(e) => setNewBean({ ...newBean, postThawStorage: e.target.value })}
                      className={`w-full ${inputClass} border rounded-lg p-2 text-xs`}
                    >
                      <option value="bag">Standard Bag (After Thaw)</option>
                      <option value="vacuum">Vacuum Sealed Bag (After Thaw)</option>
                    </select>
                  </div>
                  <div>
                    <label className={`text-[10px] uppercase font-bold ${labelClass} block mb-1`}>Initial Thaw Date (Optional)</label>
                    <input
                      type="date"
                      value={newBean.thawDate}
                      onChange={(e) => setNewBean({ ...newBean, thawDate: e.target.value })}
                      className={`w-full ${inputClass} border rounded-lg p-2 text-xs`}
                    />
                  </div>
                </div>
              )}

              <div className={`border-t ${ui.modalDivider} pt-4 mt-2`}>
                <h3 className={`${ui.sectionTitle} mb-3`}>Target recipe profile</h3>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  {[
                    { label: 'Target dose', key: 'targetDoseG', value: newRecipe.targetDoseG, suffix: 'g', parse: parseRecipeFloatField },
                    { label: 'Yield', key: 'targetYieldG', value: newRecipe.targetYieldG, suffix: 'g', parse: parseRecipeFloatField },
                  ].map((field) => (
                    <div key={field.key} className={ui.metricCell}>
                      <span className={`${ui.fieldLabel} block mb-1`}>{field.label}</span>
                      <input
                        type="number"
                        step="0.1"
                        value={recipeFieldDisplayValue(field.value)}
                        onChange={(e) => setNewRecipe({ ...newRecipe, [field.key]: field.parse(e.target.value) })}
                        className={`w-full bg-transparent ${ui.text} text-center text-xl font-black focus:outline-none`}
                      />
                      <span className={`text-[9px] ${ui.muted} text-center block`}>{field.suffix}</span>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  {[
                    { label: 'Min time', key: 'targetTimeMinS', value: newRecipe.targetTimeMinS },
                    { label: 'Max time', key: 'targetTimeMaxS', value: newRecipe.targetTimeMaxS },
                  ].map((field) => (
                    <div key={field.key} className={ui.metricCell}>
                      <span className={`${ui.fieldLabel} block mb-1`}>{field.label}</span>
                      <input
                        type="number"
                        value={recipeFieldDisplayValue(field.value)}
                        onChange={(e) => setNewRecipe({ ...newRecipe, [field.key]: parseRecipeIntField(e.target.value) })}
                        className={`w-full bg-transparent ${ui.text} text-center text-xl font-black focus:outline-none`}
                      />
                      <span className={`text-[9px] ${ui.muted} text-center block`}>s</span>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className={ui.metricCell}>
                    <span className={`${ui.fieldLabel} block mb-1`}>Brew temp</span>
                    <input
                      type="number"
                      value={recipeFieldDisplayValue(newRecipe.brewTemperatureC)}
                      onChange={(e) => setNewRecipe({ ...newRecipe, brewTemperatureC: parseRecipeIntField(e.target.value) })}
                      className={`w-full bg-transparent ${ui.text} text-center text-xl font-black focus:outline-none`}
                    />
                    <span className={`text-[9px] ${ui.muted} text-center block`}>°C</span>
                    {isSunbeamGrinderModel(grinderModel) && (
                      <span className={`text-[10px] ${ui.muted} text-center block mt-1`}>92°C is the Barista Max&apos;s default temperature.</span>
                    )}
                  </div>
                </div>

                {flairEnabled && (() => {
                  const preEndTrigger = newRecipe.flairProfile?.preinfusionEndTrigger || 'manual';
                  const taperStartTrig = newRecipe.flairProfile?.taperStartTrigger || 'weight';
                  const showPeakEndYield =
                    !scaleFeatureEnabled || taperStartTrig === 'weight';
                  return (
                  <div ref={flairPressureProfileRef} className={`pt-4 mt-2 border-t ${ui.modalDivider} space-y-3`}>
                    <h3 className={`${ui.sectionTitle}`}>Flair pressure profile</h3>

                    <div className={`${ui.cardInset} rounded-xl p-3 space-y-2`}>
                      <p className={`text-[10px] font-bold uppercase tracking-wide ${ui.accentText}`}>Pre-infusion</p>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="min-w-0">
                          <span className={`text-[11px] leading-snug ${subTextClass} block mb-1`}>Pressure (bar)</span>
                          <input
                            type="number" step="0.1"
                            value={newRecipe.flairProfile?.preinfusionPressure || ''}
                            onChange={(e) => setNewRecipe({ ...newRecipe, flairProfile: { ...newRecipe.flairProfile, preinfusionPressure: e.target.value } })}
                            className={`w-full ${inputClass} border rounded-lg p-2 text-sm`}
                          />
                        </div>
                        <div className="min-w-0">
                          <span className={`text-[11px] leading-snug ${subTextClass} block mb-1`}>End trigger</span>
                          <select
                            value={preEndTrigger}
                            onChange={(e) => setNewRecipe({ ...newRecipe, flairProfile: { ...newRecipe.flairProfile, preinfusionEndTrigger: e.target.value } })}
                            className={`w-full ${inputClass} border rounded-lg p-2 text-sm`}
                          >
                            <option value="manual">Manual</option>
                            <option value="time">Time</option>
                            {scaleFeatureEnabled && <option value="weight">Weight</option>}
                          </select>
                        </div>
                        {preEndTrigger === 'time' && (
                          <div className="min-w-0 col-span-2 sm:col-span-1">
                            <span className={`text-[11px] leading-snug ${subTextClass} block mb-1`}>Time (s)</span>
                            <input
                              type="number" step="0.1"
                              value={newRecipe.flairProfile?.preinfusionTime || ''}
                              onChange={(e) => setNewRecipe({ ...newRecipe, flairProfile: { ...newRecipe.flairProfile, preinfusionTime: e.target.value } })}
                              className={`w-full ${inputClass} border rounded-lg p-2 text-sm`}
                            />
                          </div>
                        )}
                        {preEndTrigger === 'weight' && scaleFeatureEnabled && (
                          <div className="min-w-0 col-span-2 sm:col-span-1">
                            <span className={`text-[11px] leading-snug ${subTextClass} block mb-1`}>End at (g)</span>
                            <input
                              type="number" step="0.1"
                              value={newRecipe.flairProfile?.preinfusionEndWeightG || ''}
                              onChange={(e) => setNewRecipe({ ...newRecipe, flairProfile: { ...newRecipe.flairProfile, preinfusionEndWeightG: e.target.value } })}
                              className={`w-full ${inputClass} border rounded-lg p-2 text-sm`}
                            />
                          </div>
                        )}
                      </div>
                    </div>

                    <div className={`${ui.cardInset} rounded-xl p-3 space-y-2`}>
                      <p className={`text-[10px] font-bold uppercase tracking-wide ${ui.accentText}`}>Peak / hold</p>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="min-w-0">
                          <span className={`text-[11px] leading-snug ${subTextClass} block mb-1`}>Pressure (bar)</span>
                          <input
                            type="number" step="0.1"
                            value={newRecipe.flairProfile?.peakPressure || ''}
                            onChange={(e) => setNewRecipe({ ...newRecipe, flairProfile: { ...newRecipe.flairProfile, peakPressure: e.target.value } })}
                            className={`w-full ${inputClass} border rounded-lg p-2 text-sm`}
                          />
                        </div>
                        {showPeakEndYield && (
                          <div className="min-w-0">
                            <span className={`text-[11px] leading-snug ${subTextClass} block mb-1`}>Peak ends at (g)</span>
                            <input
                              type="number" step="0.1"
                              value={newRecipe.flairProfile?.peakEndYield || ''}
                              onChange={(e) => setNewRecipe({ ...newRecipe, flairProfile: { ...newRecipe.flairProfile, peakEndYield: e.target.value } })}
                              className={`w-full ${inputClass} border rounded-lg p-2 text-sm`}
                            />
                          </div>
                        )}
                      </div>
                    </div>

                    <div className={`${ui.cardInset} rounded-xl p-3 space-y-2`}>
                      <p className={`text-[10px] font-bold uppercase tracking-wide ${ui.accentText}`}>Taper</p>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="min-w-0">
                          <span className={`text-[11px] leading-snug ${subTextClass} block mb-1`}>Pressure (bar)</span>
                          <input
                            type="number" step="0.1"
                            value={newRecipe.flairProfile?.taperPressure || ''}
                            onChange={(e) => setNewRecipe({ ...newRecipe, flairProfile: { ...newRecipe.flairProfile, taperPressure: e.target.value } })}
                            className={`w-full ${inputClass} border rounded-lg p-2 text-sm`}
                          />
                        </div>
                        {scaleFeatureEnabled && (
                          <div className="min-w-0">
                            <span className={`text-[11px] leading-snug ${subTextClass} block mb-1`}>Start trigger</span>
                            <select
                              value={taperStartTrig}
                              onChange={(e) => setNewRecipe({ ...newRecipe, flairProfile: { ...newRecipe.flairProfile, taperStartTrigger: e.target.value } })}
                              className={`w-full ${inputClass} border rounded-lg p-2 text-sm`}
                            >
                              <option value="weight">Yield (g)</option>
                              <option value="time">Time (s)</option>
                            </select>
                          </div>
                        )}
                        {scaleFeatureEnabled && taperStartTrig === 'time' && (
                          <div className="min-w-0 col-span-2 sm:col-span-1">
                            <span className={`text-[11px] leading-snug ${subTextClass} block mb-1`}>Start at (s)</span>
                            <input
                              type="number" step="0.1"
                              value={newRecipe.flairProfile?.taperStartTimeS || ''}
                              onChange={(e) => setNewRecipe({ ...newRecipe, flairProfile: { ...newRecipe.flairProfile, taperStartTimeS: e.target.value } })}
                              className={`w-full ${inputClass} border rounded-lg p-2 text-sm`}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  );
                })()}
              </div>

              <button
                type="submit"
                className={`w-full ${currentTheme.primary} font-bold py-3.5 rounded-xl shadow-lg transition-colors mt-2`}
              >
                {isEditingBean ? 'Update Coffee Profile' : 'Save Coffee Profile'}
              </button>
            </form>

            <div className={`${ui.card} p-5 rounded-2xl space-y-4`}>
              <div className="flex items-center justify-between cursor-pointer select-none" onClick={() => setShowPastBeans(!showPastBeans)}>
                <h3 className={ui.sectionTitle}>Past logged beans & profiles</h3>
                {showPastBeans ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </div>

              {showPastBeans && (
                <div className={`space-y-3 pt-2 border-t ${ui.modalDivider}`}>
                  <PastBeansList
                    beans={beans}
                    finishedSectionOpen={finishedSectionOpen}
                    onToggleFinishedSection={toggleFinishedSection}
                    ui={ui}
                    subTextClass={subTextClass}
                    inputClass={inputClass}
                    currentTheme={currentTheme}
                    onEdit={startEditBean}
                    onToggleFinished={handleToggleFinished}
                    onMarkActive={handleMarkActive}
                    onDelete={handleDeleteBean}
                    onUpdateRating={handleUpdateBeanRating}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="space-y-4">
            <div className={`flex justify-between items-center gap-3 ${ui.card} p-3 rounded-2xl`}>
              <span className={ui.sectionTitle}>Filter history log</span>
              <select
                value={historyFilterBeanId}
                onChange={(e) => setHistoryFilterBeanId(e.target.value)}
                className={`${inputClass} border rounded-lg px-3 py-1.5 text-xs font-semibold min-w-[8.5rem]`}
              >
                <option value="all">All Coffees</option>
                {beans.map(b => (
                  <option key={b.id} value={b.id}>{formatBeanDisplayName(b)} {b.isFinished ? '(Finished)' : ''}</option>
                ))}
              </select>
            </div>

            {filteredShots.length === 0 ? (
              <p className={`text-sm ${subTextClass}`}>No shots logged yet.</p>
            ) : (
              filteredShots.map(s => {
                const bean = beans.find(b => b.id === s.beanId);
                const grindStr = formatShotGrindForHistory(s, appSettings);
                const recipeForShot = recipes.find(r => r.beanId === s.beanId);
                const minT = recipeForShot?.targetTimeMinS || 27;
                const maxT = recipeForShot?.targetTimeMaxS || 32;
                const preSec = preInfusionFromNotes(s.notes);
                const peakBar = s.flairProfile?.peakPressure;
                const shotOutcome = classifyShotOutcome(s, recipeContextForShot(s, recipeForShot || {}));
                const historyUserNote = formatHistoryShotUserNoteLine(s.notes);
                return (
                  <div key={s.id} className={`${ui.card} p-4 rounded-2xl space-y-3`} data-testid="history-shot-card">
                    <div className="flex justify-between items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <span className={`text-sm font-bold ${ui.accentText}`}>
                          {bean ? `${formatBeanDisplayName(bean)} [${bean.rating ? Number(bean.rating).toFixed(1) : 'N/A'}]` : 'Unknown bean'}
                        </span>
                        {shotOutcome.statusLabel && (
                          <span className={`ml-2 text-[9px] font-bold uppercase tracking-wide ${shotOutcome.isDialledIn ? ui.accentText : ui.muted}`}>
                            {shotOutcome.statusLabel}
                          </span>
                        )}
                        <p className={`text-[10px] ${ui.muted} mt-0.5 flex flex-wrap items-center gap-x-1 gap-y-0.5`}>
                          <span className="whitespace-nowrap">{formatShotWhen(s.timestamp)}</span>
                          <span aria-hidden="true">•</span>
                          <span className={`${ui.strong} font-mono whitespace-nowrap`}>{grindStr}</span>
                          {s.recommendationFollowed === false && (
                            <span className="text-rose-400 font-bold whitespace-nowrap">Rec not followed</span>
                          )}
                        </p>
                        {s.excludeFromLearning && (
                          <p className="mt-1">
                            <span
                              data-testid="history-learning-excluded-tag"
                              className={`${ui.chip} inline-block font-semibold px-1.5 py-0.5 rounded whitespace-nowrap text-[10px]`}
                            >
                              Not used for learning
                            </span>
                          </p>
                        )}
                        {historyUserNote && (
                          <p className={`text-[10px] ${ui.sub} mt-0.5`} data-testid="history-shot-user-note">
                            {historyUserNote}
                          </p>
                        )}
                        {s.excludeFromLearning && s.knownIssueReason && (
                          <p className={`text-[10px] ${ui.sub} mt-0.5`}>{knownIssueReasonLabel(s.knownIssueReason)}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {s.shotRating && (
                          <div className={`flex items-center ${ui.accentText} text-xs font-bold gap-0.5`}>
                            <Star className="w-3.5 h-3.5 fill-current" /> {s.shotRating}
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => handleToggleShotLearningExclusion(s)}
                          aria-pressed={s.excludeFromLearning ? 'true' : 'false'}
                          className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-md border ${
                            s.excludeFromLearning
                              ? 'bg-[rgba(200,138,75,0.12)] text-[#c88a4b] border-[rgba(200,138,75,0.35)]'
                              : `${ui.chip} ${ui.muted} border-[rgba(255,255,255,0.18)] hover:border-[rgba(255,255,255,0.28)]`
                          }`}
                          title={
                            s.excludeFromLearning
                              ? 'Turn learning back on for this shot'
                              : 'Mark as a known issue (puck prep, channeling, etc.) — exclude from learning'
                          }
                        >
                          {s.excludeFromLearning ? (
                            <>Include again</>
                          ) : (
                            <>
                              <Flag className="w-3 h-3 shrink-0 opacity-80" aria-hidden />
                              Mark as known issue
                            </>
                          )}
                        </button>
                        <button type="button" onClick={() => handleDeleteShot(s.id)} className={`${ui.muted} hover:text-rose-400 p-1`}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-4 gap-2 text-xs" data-testid="history-shot-metric-tiles">
                      {[
                        { label: 'Grind', value: grindStr, tone: ui.text, compact: false },
                        { label: 'Dose/Yield', value: `${s.actualDoseG || 0}/${s.actualYieldG || 0}g`, tone: ui.text, compact: false },
                        { label: 'Time', value: `${s.actualTimeS || 0}s`, tone: shotTimeTone(s.actualTimeS, minT, maxT), compact: false },
                        { label: 'Taste', value: tasteProfileDisplayLabel(s.tasteProfile), tone: `${ui.sub} capitalize`, compact: true },
                      ].map((cell) => (
                        <div
                          key={cell.label}
                          className={`${ui.metricCell} flex flex-col items-center justify-center text-center px-1.5 py-2 min-h-[3.25rem]`}
                        >
                          <span className={`block text-[8px] uppercase tracking-wider ${ui.muted} mb-1 w-full`}>{cell.label}</span>
                          <strong
                            className={`font-black leading-tight max-w-full break-words ${cell.compact ? 'text-[10px]' : 'text-sm'} ${cell.tone}`}
                          >
                            {cell.value}
                          </strong>
                        </div>
                      ))}
                    </div>

                    {shouldShowLabShotReplayPlay({
                      shotId: s.id,
                      newestShotId,
                      labReplayShotId,
                    }) && (
                      <div className="flex justify-end gap-3 -mb-1">
                        <button
                          type="button"
                          onClick={() => void openLabShotReplay()}
                          className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide ${ui.accentText} hover:opacity-90`}
                          data-testid="history-lab-shot-replay-play"
                          aria-label="Play shot replay"
                        >
                          <Play className="w-4 h-4 fill-current" />
                          Replay
                        </button>
                        <button
                          type="button"
                          onClick={() => void exportLabShotReplay(s)}
                          className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide ${ui.accentText} hover:opacity-90`}
                          data-testid="history-lab-shot-replay-export"
                          aria-label="Export shot replay"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Export replay
                        </button>
                      </div>
                    )}

                    {s.scaleFlowCurve?.length > 0 && (
                      <ScaleFlowChart
                        flowCurve={s.scaleFlowCurve}
                        averageFlowRateGs={s.scaleFlowRateGs}
                        compact
                        {...(s.labPressureCurve?.length > 0
                          ? {
                              pressureSamples: s.labPressureCurve.map((p) => ({
                                tS: p.tS,
                                bar: p.bar,
                                confident: true,
                              })),
                              pressurePeakBar: s.labPressurePeakBar ?? null,
                              flairProfile: s.flairProfile ?? null,
                            }
                          : {})}
                      />
                    )}
                    {s.labPressureCurve?.length > 0 && !s.scaleFlowCurve?.length && (
                      <ShotPressureChart
                        samples={s.labPressureCurve.map((p) => ({ tS: p.tS, bar: p.bar, confident: true }))}
                        compact
                        peakBar={s.labPressurePeakBar ?? null}
                        savedCurve
                      />
                    )}

                    <div className={`flex flex-wrap items-center gap-2 text-[10px] ${ui.muted}`}>
                      {preSec && <span className="italic">Pre-infusion: {preSec}s.</span>}
                      {s.scaleFlowCurve?.length > 0
                        && s.scaleFlowRateGs != null
                        && Number.isFinite(s.scaleFlowRateGs) && (
                        <span className={`${ui.accentText} font-semibold`}>
                          Scale flow {s.scaleFlowRateGs.toFixed(2)} g/s
                        </span>
                      )}
                      {(s.brewTemperatureC || recipeForShot?.brewTemperatureC) && (
                        <span className={`${ui.tempPill} px-2 py-0.5 rounded-full font-semibold`}>
                          {s.brewTemperatureC || recipeForShot?.brewTemperatureC}°C
                        </span>
                      )}
                      {peakBar && <span>{peakBar} bar</span>}
                    </div>

                    {statsForNerdsEnabled && (
                      <div className="pt-1">
                        <button
                          type="button"
                          onClick={() => toggleShotEngineStats(s.id)}
                          className={`inline-flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wide ${ui.muted} hover:text-[#c88a4b] ${ui.chip} px-2 py-1 rounded-md`}
                          aria-expanded={expandedShotStatsIds.has(s.id)}
                        >
                          <Info className="w-3 h-3" />
                          {expandedShotStatsIds.has(s.id) ? 'Hide logic' : 'View logic'}
                        </button>
                        {expandedShotStatsIds.has(s.id) && (
                          <div className="mt-2">
                            <ShotEngineStatsPanel shot={s} recipe={recipeForShot || {}} ui={ui} />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {activeTab === 'stats' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-1">
              <h2 className={ui.pageTitle}>Extraction analytics & statistics</h2>
              <div className={`flex ${ui.cardInset} p-0.5 rounded-lg text-[10px] font-semibold overflow-hidden`}>
                <button type="button" onClick={() => setChartType('timeline')} className={`px-2.5 py-1 rounded-md transition-colors ${chartType === 'timeline' ? ui.chartToggleActive : ui.chartToggleIdle}`}>Timeline</button>
                <button type="button" onClick={() => setChartType('scatter')} className={`px-2.5 py-1 rounded-md transition-colors ${chartType === 'scatter' ? ui.chartToggleActive : ui.chartToggleIdle}`}>Dose/Time</button>
                <button type="button" onClick={() => setChartType('taste')} className={`px-2.5 py-1 rounded-md transition-colors ${chartType === 'taste' ? ui.chartToggleActive : ui.chartToggleIdle}`}>Taste</button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Total', value: formatShotCount(totalShots) },
                { label: 'Target compliance', value: `${complianceRate}%` },
                { label: 'Avg extraction', value: `${avgExtractionTime}s` },
                { label: 'Active profiles', value: activeBeansList.length },
              ].map((stat) => (
                <div key={stat.label} className={`${ui.card} p-4 rounded-2xl`}>
                  <span className={`${ui.fieldLabel} block`}>{stat.label}</span>
                  <span className={`text-2xl font-black ${ui.text} mt-1 block tabular-nums`}>{stat.value}</span>
                </div>
              ))}
            </div>

            {chartType === 'timeline' && (
              <div className={`${ui.card} p-5 rounded-2xl space-y-3`}>
                <h3 className={ui.sectionTitle}>Recent extraction timeline (seconds)</h3>
                {shots.length < 2 ? (
                  <p className={`text-xs ${subTextClass}`}>Log at least 2 shots to view trend graph.</p>
                ) : (
                  <div className={`h-36 w-full overflow-hidden pt-6 px-1 border-b ${ui.headerBorder} pb-2`}>
                    <div
                      className="grid h-full items-end gap-1 min-w-0"
                      style={{ gridTemplateColumns: `repeat(${Math.min(shots.length, 15)}, minmax(0, 1fr))` }}
                    >
                      {shots.slice(0, 15).reverse().map((s, idx) => {
                        const heightPx = Math.min(Math.max(((s.actualTimeS || 0) / 45) * 110, 15), 110);
                        const recipeForShot = recipes.find(r => r.beanId === s.beanId);
                        const minT = recipeForShot?.targetTimeMinS || 27;
                        const maxT = recipeForShot?.targetTimeMaxS || 32;
                        const status = extractionTimeStatus(s.actualTimeS, minT, maxT);
                        const colors = EXTRACTION_TIME_COLORS[status];

                        return (
                          <div key={idx} className="flex min-w-0 flex-col items-center gap-1">
                            <span className={`text-[8px] font-mono tabular-nums truncate w-full text-center ${colors.label}`}>
                              {s.actualTimeS || 0}s
                            </span>
                            <div
                              style={{ height: `${heightPx}px` }}
                              className={`w-full max-w-full rounded-t transition-all ${colors.bar}`}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div className={`flex flex-wrap justify-end gap-x-3 gap-y-1 text-[9px] ${ui.muted} pt-1`}>
                  <span className="flex items-center gap-1"><span className={`w-2 h-2 rounded-full ${EXTRACTION_TIME_COLORS.under.dot}`} /> Under</span>
                  <span className="flex items-center gap-1"><span className={`w-2 h-2 rounded-full ${EXTRACTION_TIME_COLORS.inRange.dot}`} /> In range</span>
                  <span className="flex items-center gap-1"><span className={`w-2 h-2 rounded-full ${EXTRACTION_TIME_COLORS.over.dot}`} /> Over</span>
                </div>
              </div>
            )}

            {chartType === 'scatter' && (
              <div className={`${ui.card} p-5 rounded-2xl space-y-3`}>
                <h3 className={ui.sectionTitle}>Extraction time vs dose</h3>
                <div className={`h-36 w-full flex items-end gap-2 pt-6 px-2 border-b ${ui.headerBorder} pb-2`}>
                  {shots.slice(0, 12).map((s, idx) => (
                    <div key={idx} className="flex-1 flex flex-col items-center gap-1">
                      <span className="text-[9px] font-mono">{s.actualDoseG || 0}g</span>
                      <div style={{ height: `${Math.min((s.actualTimeS || 0) * 3, 110)}px` }} className="w-full bg-[#c88a4b] rounded-t" />
                      <span className={`text-[9px] ${ui.muted}`}>{s.actualTimeS || 0}s</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {chartType === 'taste' && (
              <div className={`${ui.card} p-5 rounded-2xl space-y-3`}>
                <h3 className={ui.sectionTitle}>Taste profile breakdown</h3>
                <div className="space-y-2 text-xs">
                  {[
                    { label: 'Very sour', count: tasteCounts.very_sour, color: TASTE_CHART_COLORS.very_sour },
                    { label: 'Sour', count: tasteCounts.sour, color: TASTE_CHART_COLORS.sour },
                    { label: 'Balanced', count: tasteCounts.balanced, color: TASTE_CHART_COLORS.balanced },
                    { label: 'Bitter', count: tasteCounts.bitter, color: TASTE_CHART_COLORS.bitter },
                    { label: 'Very bitter', count: tasteCounts.very_bitter, color: TASTE_CHART_COLORS.very_bitter },
                  ].map(item => {
                    const pct = totalShots > 0 ? Math.round((item.count / totalShots) * 100) : 0;
                    return (
                      <div key={item.label} className="space-y-1">
                        <div className="flex justify-between font-semibold">
                          <span className={subTextClass}>{item.label}</span>
                          <span>{formatShotCount(item.count)} ({pct}%)</span>
                        </div>
                        <div className={`h-2 w-full ${ui.progressTrack} rounded-full overflow-hidden`}>
                          <div style={{ width: `${pct}%` }} className={`h-full ${item.color} transition-all duration-500`} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className={`${ui.card} p-5 rounded-2xl space-y-4 overflow-hidden`}>
              <div className="flex items-center justify-between gap-2">
                <h3 className={ui.sectionTitle}>Bean rating leaderboard</h3>
                <select
                  value={leaderboardFilter}
                  onChange={(e) => setLeaderboardFilter(e.target.value)}
                  className={`${inputClass} border rounded-lg px-2.5 py-1 text-xs font-semibold`}
                >
                  <option value="All">All Roasts</option>
                  <option value="Light">Light Roast</option>
                  <option value="Medium">Medium Roast</option>
                  <option value="Dark">Dark Roast</option>
                </select>
              </div>

              {beans.length === 0 ? (
                <p className={`text-xs ${subTextClass}`}>No beans configured yet.</p>
              ) : (
                <div className="space-y-2">
                  {[...beans]
                    .filter(b => leaderboardFilter === 'All' || b.roastType === leaderboardFilter)
                    .sort((a, b) => (b.rating || 0) - (a.rating || 0))
                    .map((b, idx) => (
                      <div key={b.id} className={`flex items-center justify-between p-3 rounded-xl overflow-hidden ${ui.inset} text-xs`}>
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`font-black ${ui.accentText} shrink-0`}>#{idx + 1}</span>
                          <div className="min-w-0">
                            <span className={`font-bold ${ui.text} block truncate`}>{b.name}</span>
                            <span className={`text-[10px] ${subTextClass}`}>{formatBeanRoasterRoastLine(b)}</span>
                          </div>
                        </div>
                        <span className={`text-sm font-black ${ui.badge} px-2.5 py-1 rounded-lg shrink-0`}>
                          ⭐ {b.rating ? Number(b.rating).toFixed(1) : 'N/A'}
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        )}

        <HowItWorksModal open={isHowItWorksOpen} onClose={() => setIsHowItWorksOpen(false)} ui={ui} />
        <BrewGuideIntroModal
          open={activeTab === 'brew' && showBrewGuideIntro}
          onContinue={handleDismissBrewGuideIntro}
          ui={ui}
          machineSettingsLine={brewGuideIntroMachineSettingsLine(grinderModel)}
        />

        {isSettingsOpen && (
          <div className="fixed inset-0 bg-black/70 flex items-end sm:items-center justify-center p-4 pb-24 sm:pb-4 z-50">
            <div className={`${ui.card} rounded-2xl max-w-sm w-full shadow-xl max-h-[min(85dvh,calc(100dvh-7rem))] flex flex-col overflow-hidden`}>
              <div className={`flex items-center justify-between border-b p-6 pb-3 shrink-0 ${ui.modalDivider}`}>
                <div className="flex items-center gap-2">
                  <Sliders className={`w-5 h-5 ${ui.accentText}`} />
                  <h3 className={`text-base font-bold ${ui.text}`}>Preferences & Settings</h3>
                </div>
                <button type="button" onClick={() => setIsSettingsOpen(false)} className={`${ui.ghostBtn} text-sm font-bold`}>✕</button>
              </div>

              <div className="space-y-4 text-xs overflow-y-auto flex-1 px-6 py-4">
                <div className={`${ui.cardInset} rounded-xl p-3 space-y-3`}>
                  <label className={`block ${ui.fieldLabel}`}>Primary grinder</label>
                  <select
                    value={settingsGrinderPickerValue || grinderPickerValueForSettings(settingsSetting)}
                    onChange={(e) => { void handleSettingsGrinderPickerChange(e.target.value); }}
                    className={`w-full ${inputClass} border rounded-lg p-2.5 font-semibold`}
                  >
                    {listGrinderPickerOptions().map((option) => (
                      <option key={option.id} value={option.id}>{option.label}</option>
                    ))}
                  </select>
                  {(settingsGrinderPickerValue || grinderPickerValueForSettings(settingsSetting))
                    === NICHE_ZERO_GRINDER_ID && (
                    <div className="space-y-2 border-t border-[rgba(255,255,255,0.06)] pt-3">
                      <p className={`text-[10px] font-bold uppercase tracking-wide ${ui.muted}`}>Niche Zero dial calibration</p>
                      <label className={`block ${ui.fieldLabel}`}>Dial zero offset (optional)</label>
                      <input
                        type="number"
                        step="0.1"
                        value={settingsSetting?.nicheZeroDialZeroOffset ?? ''}
                        onChange={(e) => {
                          const raw = e.target.value;
                          void patchBrewGuidanceSettings({
                            nicheZeroDialZeroOffset: raw === '' ? undefined : Number(raw),
                          });
                        }}
                        placeholder="0"
                        className={`w-full ${inputClass} border rounded-lg p-2.5 font-semibold`}
                      />
                      <p className={`text-[10px] ${ui.muted}`}>
                        Negative values allow dial readings below 0; positive values extend past 50. Leave blank for the default 0–50 range.
                      </p>
                    </div>
                  )}
                  {(settingsGrinderPickerValue || grinderPickerValueForSettings(settingsSetting))
                    === BCG820_GRINDER_ID && (
                    <div className="space-y-2 border-t border-[rgba(255,255,255,0.06)] pt-3">
                      <label className={`block ${ui.fieldLabel}`}>Upper burr position (optional)</label>
                      <input
                        type="number"
                        min={1}
                        max={10}
                        value={settingsSetting?.bcg820UpperBurr ?? ''}
                        onChange={(e) => {
                          const raw = e.target.value;
                          void patchBrewGuidanceSettings({
                            bcg820UpperBurr: raw === '' ? undefined : Number(raw),
                          });
                        }}
                        placeholder="Factory default ~6"
                        className={`w-full ${inputClass} border rounded-lg p-2.5 font-semibold`}
                      />
                    </div>
                  )}
                  {(settingsGrinderPickerValue || grinderPickerValueForSettings(settingsSetting))
                    === ENCORE_ESP_GRINDER_ID && (
                    <div className="space-y-2 border-t border-[rgba(255,255,255,0.06)] pt-3">
                      <label className={`block ${ui.fieldLabel}`}>Shims installed (optional diagnostic)</label>
                      <input
                        type="number"
                        min={0}
                        max={4}
                        value={settingsSetting?.encoreEspShims ?? ''}
                        onChange={(e) => {
                          const raw = e.target.value;
                          void patchBrewGuidanceSettings({
                            encoreEspShims: raw === '' ? undefined : Number(raw),
                          });
                        }}
                        placeholder="0"
                        className={`w-full ${inputClass} border rounded-lg p-2.5 font-semibold`}
                      />
                      <p className={`text-[10px] ${ui.muted}`}>Each shim shifts the effective range by about five settings.</p>
                    </div>
                  )}
                  <PresetGrinderAuxFields
                    grinderModel={
                      settingsGrinderPickerValue || grinderPickerValueForSettings(settingsSetting)
                    }
                    settings={settingsSetting}
                    inputClass={inputClass}
                    ui={ui}
                    onPatchSettings={(patch) => patchBrewGuidanceSettings(patch)}
                  />
                  {settingsGrinderPickerValue === CUSTOM_GRINDER_PICKER_ID && (
                    <div className="space-y-2">
                      <CustomGrinderForm
                        value={settingsCustomGrinderDraft}
                        onChange={handleSettingsCustomGrinderDraftChange}
                        ui={ui}
                      />
                      <button
                        type="button"
                        onClick={() => { void handleSaveCustomGrinderFromSettings(); }}
                        disabled={!isCustomGrinderFormValid(settingsCustomGrinderDraft)}
                        className={`w-full font-bold py-2.5 rounded-xl ${ui.secondaryBtn} disabled:opacity-40`}
                      >
                        Save custom grinder
                      </button>
                    </div>
                  )}
                </div>

                <div className={`${ui.cardInset} rounded-xl p-3 space-y-2`}>
                  <label className={`block ${ui.fieldLabel}`}>Smart scale</label>
                  <select
                    value={resolveSmartScalePickerValue(settingsSetting, {
                      devUrlSimActive: devUrlSimScaleActive,
                      scaleConnected: timemoreScale.isConnected,
                    })}
                    onChange={(e) => { void handleSmartScaleDeviceChange(e.target.value); }}
                    className={`w-full ${inputClass} border rounded-lg p-2.5 font-semibold`}
                  >
                    {listSmartScalePickerOptions().map((opt) => (
                      <option key={opt.id} value={opt.id}>{opt.label}</option>
                    ))}
                  </select>
                  <p className={`text-[10px] ${ui.muted}`}>
                    Active: {smartScaleActiveSummary(settingsSetting, {
                      devUrlSimActive: devUrlSimScaleActive,
                      scaleConnected: timemoreScale.isConnected,
                    })}. Manual shot logging always works.
                  </p>
                  {timemoreScale.isConnected && (
                    <div className={`border-t ${ui.modalDivider} pt-3 flex items-center justify-between gap-3`}>
                      <div>
                        <span className={`font-bold block ${ui.text}`}>Auto-stop timer when flow ends</span>
                        <span className={`text-[10px] ${ui.muted}`}>
                          Stops at flow tail-off; yield still settles from drips
                        </span>
                      </div>
                      <SettingsToggle
                        checked={normalizeScaleFlowAutoStopEnabled(settingsSetting?.scaleFlowAutoStopEnabled)}
                        onChange={handleToggleScaleFlowAutoStop}
                        label="Auto-stop timer when flow ends"
                      />
                    </div>
                  )}
                  {scaleFeatureEnabled && (
                    <div className={`border-t ${ui.modalDivider} pt-3 flex items-center justify-between gap-3`}>
                      <div>
                        <span className={`font-bold block ${ui.text}`}>Show weight goals on shot screen</span>
                        <span className={`text-[10px] ${ui.muted}`}>
                          Compact stage targets on the full-screen timer when a scale is connected
                        </span>
                      </div>
                      <SettingsToggle
                        checked={shotScreenWeightGoalsEnabled}
                        onChange={handleToggleShotScreenWeightGoals}
                        label="Show weight goals on shot screen"
                      />
                    </div>
                  )}
                </div>

                <div className={`${ui.cardInset} rounded-xl p-3 space-y-3`}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <span className={`font-bold block ${ui.text}`}>Enable Flair manual profile</span>
                      <span className={`text-[10px] ${ui.muted}`}>Pressure chart & water temp on Dial</span>
                    </div>
                    <SettingsToggle checked={flairEnabled} onChange={handleToggleFlairSetting} label="Enable Flair manual profile" />
                  </div>
                  <div className={`border-t ${ui.modalDivider} pt-3 flex items-center justify-between gap-3`}>
                    <div>
                      <span className={`font-bold block ${ui.text}`}>Track pre-infusion time</span>
                      <span className={`text-[10px] ${ui.muted}`}>Two-phase timer: pre → shot</span>
                    </div>
                    <SettingsToggle checked={usePreInfusion} onChange={handleTogglePreInfusion} label="Track pre-infusion time" />
                  </div>
                  <div className={`border-t ${ui.modalDivider} pt-3 space-y-2`}>
                    <label className={`block ${ui.fieldLabel}`}>Shot start countdown</label>
                    <select
                      value={normalizeShotStartCountdown(settingsSetting?.shotStartCountdown)}
                      onChange={(e) => { void handleShotStartCountdownChange(e.target.value); }}
                      className={`w-full ${inputClass} border rounded-lg p-2.5 font-semibold text-xs`}
                    >
                      <option value={SHOT_START_COUNTDOWN_OFF}>Off</option>
                      <option value={SHOT_START_COUNTDOWN_ON}>On</option>
                      <option value={SHOT_START_COUNTDOWN_FLAIR_ONLY}>Flair only (default)</option>
                    </select>
                    <p className={`text-[10px] ${ui.muted}`}>
                      Optional 3-2-1 before the timer; tares the scale during the countdown when connected.
                    </p>
                  </div>
                  <div className={`border-t ${ui.modalDivider} pt-3 flex items-center justify-between gap-3`}>
                    <div>
                      <span className={`font-bold block ${ui.text}`}>Brew Guide</span>
                      <span className={`text-[10px] ${ui.muted}`}>{brewGuideSettingsToggleDetail(grinderModel)}</span>
                    </div>
                    <SettingsToggle checked={brewGuideEnabled} onChange={handleToggleBrewGuide} label="Brew Guide" />
                  </div>
                  {brewGuideEnabled && (
                    <div className={`border-t ${ui.modalDivider} pt-3 space-y-2`}>
                      <label className={`block ${ui.fieldLabel}`}>Brew guidance on Dial-In</label>
                      <select
                        value={brewGuidanceMode}
                        onChange={(e) => handleBrewGuidanceModeChange(e.target.value)}
                        className={`w-full ${inputClass} border rounded-lg p-2.5 font-semibold text-xs`}
                      >
                        <option value={BREW_GUIDANCE_MODES.full}>Full guide (Brew Guide tab)</option>
                        <option value={BREW_GUIDANCE_MODES.quick}>Quick checklist on Dial-In</option>
                        <option value={BREW_GUIDANCE_MODES.none}>No checklist</option>
                      </select>
                      <p className={`text-[10px] ${ui.muted}`}>
                        Quick checklist is a short reminder only. Detailed steps stay in Brew Guide.
                      </p>
                    </div>
                  )}
                </div>

                <div className={`${ui.cardInset} rounded-xl p-3 space-y-3`}>
                  <p className={`text-[10px] font-bold uppercase tracking-wider ${ui.muted}`}>Lab</p>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <span className={`font-bold block ${ui.text}`}>Pressure from camera (beta)</span>
                      <span className={`text-[10px] ${ui.muted}`}>
                        Experimental camera-only Flair gauge reading on the shot screen. Display smoothing only; raw
                        samples are stored with logged shots.
                      </span>
                      {labCameraPressureEnabled && (
                        <div className="mt-2">
                          <ShotLabPressureIntegration variant="settings-hint" ui={ui} />
                        </div>
                      )}
                    </div>
                    <SettingsToggle
                      checked={labCameraPressureEnabled}
                      onChange={handleToggleLabCameraPressure}
                      label="Pressure from camera (beta)"
                    />
                  </div>
                  {labCameraPressureEnabled && (
                    <>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <span className={`font-bold block ${ui.text}`}>Gauge camera preview</span>
                        <span className={`text-[10px] ${ui.muted}`}>
                          Optional small preview during calibration and shots (off by default).
                        </span>
                      </div>
                      <SettingsToggle
                        checked={settingsSetting?.[LAB_PRESSURE_CAMERA_PREVIEW_KEY] === true}
                        onChange={handleToggleLabPressurePreview}
                        label="Gauge camera preview"
                      />
                    </div>
                    <div>
                      <span className={`font-bold block ${ui.text}`}>Pressure reader</span>
                      <span className={`text-[10px] ${ui.muted}`}>
                        Current stops the hub jumping onto another circle. v4.13.17 is the previous tracker.
                      </span>
                      <select
                        value={labPressureReaderLegacy(settingsSetting) ? LAB_PRESSURE_READER_LEGACY : 'current'}
                        onChange={(e) => handleLabPressureReader(e.target.value)}
                        className={`mt-2 w-full ${inputClass} border rounded-lg p-2.5 font-semibold text-xs`}
                      >
                        <option value="current">Current</option>
                        <option value={LAB_PRESSURE_READER_LEGACY}>v4.13.17</option>
                      </select>
                    </div>
                    </>
                  )}
                </div>

                <div className={`flex items-center justify-between pt-2 border-t ${ui.modalDivider}`}>
                  <div>
                    <span className={`font-bold block ${labelClass}`}>Interface appearance</span>
                    <span className={`text-[10px] ${ui.muted}`}>Charcoal instrument (dark) or warm paper (light)</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleToggleDarkMode}
                    className={`px-3 py-1.5 rounded-lg flex items-center gap-1 font-bold border ${ui.secondaryBtn}`}
                  >
                    {darkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                    {darkMode ? 'Dark' : 'Light'}
                  </button>
                </div>

                <div className={`${ui.cardInset} rounded-xl p-3 space-y-3`}>
                  <button
                    type="button"
                    onClick={() => {
                      setIsHowItWorksOpen(true);
                      setIsSettingsOpen(false);
                    }}
                    className={`w-full font-bold py-2.5 rounded-xl flex items-center justify-center gap-2 ${ui.secondaryBtn}`}
                  >
                    <Coffee className="w-4 h-4" /> How the Engine Works
                  </button>
                  <div className={`border-t ${ui.modalDivider} pt-3 flex items-center justify-between gap-3`}>
                    <div>
                      <span className={`font-bold block ${ui.text}`}>Stats for Nerds</span>
                      <span className={`text-[10px] ${ui.muted}`}>Show recommendation logic on shot history cards</span>
                    </div>
                    <SettingsToggle checked={statsForNerdsEnabled} onChange={handleToggleStatsForNerds} label="Stats for Nerds" />
                  </div>
                </div>

                <div className={`pt-2 border-t ${ui.modalDivider} space-y-2`}>
                  <button
                    type="button"
                    onClick={exportDataCSV}
                    className={`w-full font-bold py-2.5 rounded-xl flex items-center justify-center gap-2 ${ui.secondaryBtn}`}
                  >
                    <Download className="w-4 h-4" /> Export All Shots to CSV
                  </button>
                  <input
                    ref={csvImportInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(e) => { void handleImportCsvFile(e); }}
                  />
                  <button
                    type="button"
                    onClick={() => csvImportInputRef.current?.click()}
                    className={`w-full font-bold py-2.5 rounded-xl flex items-center justify-center gap-2 ${ui.secondaryBtn}`}
                  >
                    <PlusCircle className="w-4 h-4" /> Import Shots from CSV
                  </button>
                  {csvImportSummary && (
                    <p className={`text-[11px] ${ui.muted} text-center px-2`}>{csvImportSummary}</p>
                  )}
                </div>

                <div className="pt-3 border-t border-rose-900/40 space-y-2">
                  <span className="font-bold text-rose-500 uppercase tracking-wider block">Danger Zone</span>
                  <button
                    onClick={() => setShowResetConfirm(true)}
                    className="w-full bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white font-bold py-2 rounded-xl border border-rose-800 transition-colors"
                  >
                    Perform Factory Reset
                  </button>
                </div>
              </div>

              <div className={`shrink-0 p-6 pt-3 border-t ${ui.modalDivider} ${ui.card}`}>
                <button
                  type="button"
                  onClick={() => {
                    if (
                      settingsGrinderPickerValue === CUSTOM_GRINDER_PICKER_ID
                      && isCustomGrinderFormValid(settingsCustomGrinderDraft)
                    ) {
                      void handleSaveCustomGrinderFromSettings();
                    }
                    setIsSettingsOpen(false);
                  }}
                  className={`w-full ${currentTheme.primary} font-bold py-3 rounded-xl text-sm shadow`}
                >
                  Save & Close
                </button>
              </div>
            </div>
          </div>
        )}

        {showResetConfirm && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
            <div className={`${currentTheme.card} border p-6 rounded-2xl max-w-sm w-full space-y-4 shadow-xl`}>
              <div className={`flex items-center gap-2 text-rose-500 border-b pb-3 ${ui.modalDivider}`}>
                <AlertTriangle className="w-5 h-5" />
                <h3 className="text-base font-bold">Confirm Factory Reset</h3>
              </div>
              <p className={`text-xs ${ui.sub} leading-relaxed font-medium`}>
                Warning: This action will permanently delete all logged shots, recipes, and coffee bean profiles. Data cannot be recovered once deleted.
              </p>
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setShowResetConfirm(false)}
                  className={`flex-1 ${ui.secondaryBtn} font-bold py-2.5 rounded-xl text-xs`}
                >
                  Cancel
                </button>
                <button
                  onClick={handleFactoryReset}
                  className="flex-1 bg-rose-600 hover:bg-rose-500 text-white font-bold py-2.5 rounded-xl text-xs shadow"
                >
                  Yes, Delete All
                </button>
              </div>
            </div>
          </div>
        )}

        <footer className="text-center pt-8 pb-4">
          <span className={`text-[10px] ${subTextClass} tracking-widest uppercase opacity-60 font-mono`}>
            Espresso Dial-In • {APP_VERSION_LABEL}
          </span>
        </footer>

      </div>

      {finishUndoToast?.snapshot && (
        <FinishBeanToast
          beanName={finishUndoToast.snapshot.name || 'Bean'}
          onUndo={() => void handleUndoMarkFinished()}
          ui={ui}
        />
      )}

      {/* Fixed bottom tab bar */}
      <nav className={`fixed bottom-0 left-0 right-0 z-50 ${ui.nav} backdrop-blur safe-area-pb`}>
        <div className="max-w-xl mx-auto flex items-stretch gap-1 p-1.5">
          {[
            { id: 'dial', label: 'Dial', icon: Coffee, onClick: () => setActiveTab('dial') },
            ...(brewGuideEnabled
              ? [{ id: 'brew', label: 'Brew Guide', icon: ClipboardList, onClick: () => setActiveTab('brew') }]
              : []),
            { id: 'beans', label: 'Beans', icon: PlusCircle, onClick: () => setActiveTab('beans') },
            { id: 'history', label: 'History', icon: History, onClick: () => setActiveTab('history') },
            { id: 'stats', label: 'Stats', icon: BarChart2, onClick: () => setActiveTab('stats') },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={tab.onClick}
                className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 py-2 min-h-[52px] rounded-xl transition-colors ${
                  isActive ? ui.tabActive : ui.muted
                }`}
              >
                {isActive && (
                  <span className="absolute top-1.5 left-3 w-1.5 h-1.5 rounded-full bg-[#c88a4b]" aria-hidden />
                )}
                <Icon className={`w-5 h-5 ${isActive ? 'stroke-[2.5px]' : ''}`} />
                <span className={brewGuideEnabled ? 'text-[9px] font-bold uppercase tracking-wide text-center leading-tight' : 'text-[10px] font-bold uppercase tracking-wide'}>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      <Analytics />
      <LabShotReplayScreen
        open={labReplayOpen}
        onClose={() => {
          setLabReplayOpen(false);
          setLabReplayPayload(null);
        }}
        onDeleted={() => {
          setLabReplayShotId(null);
          setLabReplayPayload(null);
        }}
        blob={labReplayPayload?.blob ?? null}
        meta={labReplayPayload?.meta ?? null}
        ui={ui}
      />
    </div>
    </ShotLabPressureProvider>
  );
}