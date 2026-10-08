import React, { useState, useEffect, useRef } from 'react';
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
  KNOWN_ISSUE_REASONS,
  knownIssueReasonLabel,
} from './utils/grinderLogic';
import { useLiveQuery } from 'dexie-react-hooks';
import { History, PlusCircle, AlertTriangle, Download, Trash2, ArrowRight, Sun, Moon, BarChart2, Shield, Star, Flame, ChevronDown, ChevronUp, Settings, Sliders, Coffee, Play, RotateCcw, Edit2, X, CheckCircle, ClipboardList, Info } from 'lucide-react';
import { HowItWorksModal } from './components/HowItWorksModal';
import { ShotEngineStatsPanel } from './components/ShotEngineStatsPanel';
import { PressureProfileChart } from './components/PressureProfileChart';
import { GrinderGrindControls } from './components/GrindControls';
import {
  GRINDER_SETUP_OPTIONS,
  defaultBrewTemperatureForGrinder,
  formatCurrentGrindLabel,
  formatInitialGrindDisplay,
  formatPreviousGrindLabel,
  formatRecommendedGrindDisplay,
  formatShotGrindForHistory,
  getUiGrinderPresentation,
  grindMatchesStoredRecommendation,
  isSunbeamGrinderModel,
  parseGrindForShotSave,
  persistedSettingsPatchFromRecommendation,
  uiStateFromInitialRecommendation,
  uiStateFromLastShot,
  uiStateFromRecommendedSetting,
} from './grinders/grinderRegistry.js';
import { SettingsToggle } from './components/SettingsToggle';
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
import { normalizeBrewAccessories } from './brewGuide/steps';
import { getAppTheme } from './theme';
import { Analytics } from '@vercel/analytics/react';

const EXTRACTION_TIME_COLORS = {
  inRange: { bar: 'bg-[#8a9d72]', dot: 'bg-[#8a9d72]', label: 'text-[#9cb088]' },
  under: { bar: 'bg-[#c88a4b]', dot: 'bg-[#c88a4b]', label: 'text-[#d4a060]' },
  over: { bar: 'bg-[#b86b5c]', dot: 'bg-[#b86b5c]', label: 'text-[#c97868]' },
};

const TASTE_CHART_COLORS = {
  very_sour: 'bg-[#9a8a4a]',
  sour: 'bg-[#c4a04b]',
  good: 'bg-[#8a9d72]',
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

  const [logoClickCount, setLogoClickCount] = useState(0);
  const [isAdminOpen, setIsAdminOpen] = useState(false);
  const [mockDate, setMockDate] = useState('');

  const [statsClickCount, setStatsClickCount] = useState(0);
  const [easterEggActive, setEasterEggActive] = useState(false);
  const [chartType, setChartType] = useState('timeline');

  const [showPastBeans, setShowPastBeans] = useState(true);
  const [showFinishedBeans, setShowFinishedBeans] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [leaderboardFilter, setLeaderboardFilter] = useState('All');

  const beans = useLiveQuery(() => db.beans.toArray(), []) || [];
  const recipes = useLiveQuery(() => db.recipes.toArray(), []) || [];
  const shots = useLiveQuery(() => db.shots.orderBy('timestamp').reverse().toArray(), []) || [];
  const settingsSetting = useLiveQuery(() => db.settings.get('global'), []) || null;
  const brewGuideEnabled = Boolean(settingsSetting?.brewGuideEnabled);
  const brewGuideSetupComplete = Boolean(settingsSetting?.brewGuideSetupComplete);
  const brewGuideAccessories = normalizeBrewAccessories(settingsSetting?.brewGuideAccessories);
  const brewGuidanceMode = normalizeBrewGuidanceMode(settingsSetting?.brewGuideGuidanceMode);
  const loggedShotCount = countLoggedShots(shots);
  const showBrewGuideIntro = brewGuideEnabled && shouldShowBrewGuideIntro(settingsSetting, loggedShotCount);
  const showBrewGraduationPrompt = brewGuideEnabled
    && shouldShowGraduationPrompt(settingsSetting, loggedShotCount);
  const statsForNerdsEnabled = settingsSetting?.statsForNerdsEnabled === true;

  const [selectedBeanId, setSelectedBeanId] = useState('');
  const [historyFilterBeanId, setHistoryFilterBeanId] = useState('all');
  
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
  
  const [newRecipe, setNewRecipe] = useState({ 
    targetDoseG: 18, 
    targetYieldG: '', 
    targetTimeMinS: 27, 
    targetTimeMaxS: 32,
    brewTemperatureC: 93,
    flairProfile: {
      preinfusionPressure: '',
      preinfusionTime: '',
      peakPressure: '',
      peakEndYield: '',
      taperPressure: ''
    }
  });

  const [grinderModel, setGrinderModel] = useState('');
  const [flairEnabled, setFlairEnabled] = useState(false);

  const [setteMacro, setSetteMacro] = useState(13);
  const [setteMicro, setSetteMicro] = useState('E');
  const [sunbeamSetting, setSunbeamSetting] = useState(15);
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
  const tasteInputRef = useRef(null);
  const recommendationRef = useRef(null);
  const grindSettingsRef = useRef(null);
  const brewTempDefaultRef = useRef('');
  const [validationError, setValidationError] = useState('');
  const [highlightGrind, setHighlightGrind] = useState(false);
  const [shotFieldHighlights, setShotFieldHighlights] = useState(EMPTY_SHOT_FIELD_HIGHLIGHTS);
  const [setupBrewGuideEnabled, setSetupBrewGuideEnabled] = useState(true);
  const [brewAccessoriesOpenRequest, setBrewAccessoriesOpenRequest] = useState(0);
  const [brewAccessoriesReturnTo, setBrewAccessoriesReturnTo] = useState('brew');

  useEffect(() => {
    if (settingsSetting) {
      if (settingsSetting.grinderModel) {
        setGrinderModel(settingsSetting.grinderModel);
        if (!isEditingBean && brewTempDefaultRef.current !== settingsSetting.grinderModel) {
          brewTempDefaultRef.current = settingsSetting.grinderModel;
          const nextTemp = defaultBrewTemperatureForGrinder(settingsSetting.grinderModel);
          setNewRecipe((prev) => {
            const current = prev.brewTemperatureC;
            const isUnset = current === '' || current === null || current === undefined;
            const isFactoryDefault = current === 92 || current === 93;
            if (!isUnset && !isFactoryDefault) return prev;
            return current === nextTemp ? prev : { ...prev, brewTemperatureC: nextTemp };
          });
        }
      }
      if (settingsSetting.flairEnabled !== undefined) setFlairEnabled(settingsSetting.flairEnabled);
      if (settingsSetting.preInfusionEnabled !== undefined) setUsePreInfusion(settingsSetting.preInfusionEnabled);
      if (settingsSetting.darkMode !== undefined) setDarkMode(settingsSetting.darkMode);
    }
  }, [settingsSetting, isEditingBean]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
    document.body.style.backgroundColor = darkMode ? '#121110' : '#ebe6dc';
    document.body.style.color = darkMode ? '#f5f2eb' : '#2a261f';
  }, [darkMode]);

  const activeBeansList = beans.filter(b => !b?.isFinished);
  const activeBean = beans.find(b => b.id === selectedBeanId) || activeBeansList[0] || beans[0];
  const activeRecipe = recipes.find(r => r.beanId === activeBean?.id);
  const lastLoggedShot = shots.find(s => s.beanId === activeBean?.id);
  const lastLearningShot = shots.find((s) => s.beanId === activeBean?.id && shotEligibleForLearning(s));
  const beanShots = shots.filter(s => s.beanId === activeBean?.id);

  const brewRatio = actualDoseG > 0 && actualYieldG > 0 ? (parseFloat(actualYieldG) / parseFloat(actualDoseG)).toFixed(1) : '0.0';

  // Timer Logic (0.1s resolution for mobile fullscreen display)
  useEffect(() => {
    if (!timerRunning) return undefined;
    const interval = setInterval(() => {
      setTimerTicks((t) => t + 1);
    }, 100);
    return () => clearInterval(interval);
  }, [timerRunning]);

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

  const handleStartTimer = () => {
    setTimerTicks(0);
    setPreInfusionSeconds(0);
    if (usePreInfusion) setPreInfusionPhase(true);
    setTimerRunning(true);
  };

  const handleEndPreInfusion = () => {
    setPreInfusionSeconds(timerSeconds);
    setPreInfusionPhase(false);
  };

  const handleStopTimer = () => {
    setTimerRunning(false);
    let finalExtractionTime = timerSeconds;
    if (usePreInfusion && !preInfusionPhase) {
      finalExtractionTime = Math.max(0, timerSeconds - preInfusionSeconds);
    }
    const rounded = Math.round(finalExtractionTime);
    setActualTimeS(rounded);
    return rounded;
  };

  const handleCancelTimer = () => {
    setTimerRunning(false);
    setTimerTicks(0);
    setPreInfusionSeconds(0);
    setPreInfusionPhase(false);
  };

  const handleResetTimer = () => {
    setTimerRunning(false);
    setTimerTicks(0);
    setPreInfusionSeconds(0);
    setPreInfusionPhase(false);
  };

  const handleTimerSurfaceTap = (e) => {
    if (e.target.closest('[data-timer-dismiss]')) return;
    if (usePreInfusion && preInfusionPhase) handleEndPreInfusion();
    else handleStopTimer();
  };

  useEffect(() => {
    if (activeRecipe?.targetYieldG && !actualYieldG) {
      setActualYieldG(activeRecipe.targetYieldG);
    }
  }, [activeRecipe?.id]);

  useEffect(() => {
    if (activeBean && grinderModel) {
      const currentBeanShots = shots.filter(
        (s) => s.beanId === activeBean.id && s.grinderModel === grinderModel && shotEligibleForLearning(s)
      );
      
      if (currentBeanShots.length > 0) {
        const last = currentBeanShots[0];
        const adjustedRec = getAgeAdjustedRecommendation(last, activeBean, mockDate);
        
        if (adjustedRec && adjustedRec.recommendedSetting) {
          const uiState = uiStateFromRecommendedSetting(grinderModel, adjustedRec.recommendedSetting);
          if (uiState?.setteMacro != null) setSetteMacro(uiState.setteMacro);
          if (uiState?.setteMicro != null) setSetteMicro(uiState.setteMicro);
          if (uiState?.sunbeamSetting != null) setSunbeamSetting(uiState.sunbeamSetting);
        } else {
          const uiState = uiStateFromLastShot(grinderModel, last);
          if (uiState.setteMacro != null) setSetteMacro(uiState.setteMacro);
          if (uiState.setteMicro != null) setSetteMicro(uiState.setteMicro);
          if (uiState.sunbeamSetting != null) setSunbeamSetting(uiState.sunbeamSetting);
        }
      } else {
        const recParams = getInitialGrindRecommendation(grinderModel, activeBean.roastType, activeBean, recipes, shots, beans, mockDate);
        const uiState = uiStateFromInitialRecommendation(grinderModel, recParams);
        if (uiState.setteMacro != null) setSetteMacro(uiState.setteMacro);
        if (uiState.setteMicro != null) setSetteMicro(uiState.setteMicro);
        if (uiState.sunbeamSetting != null) setSunbeamSetting(uiState.sunbeamSetting);
      }
    }
  }, [selectedBeanId, activeBean?.id, grinderModel, beans.length, mockDate, activeBean?.thawDate]);

  const handleSaveGrinderSetup = async (model, options = {}) => {
    const { brewGuideEnabled: brewGuideChoice } = options;
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
    const currentSettings = await db.settings.get('global') || { id: 'global' };
    await db.settings.put({
      ...currentSettings,
      grinderModel: model,
      ...(typeof brewGuideChoice === 'boolean' ? { brewGuideEnabled: brewGuideChoice } : {}),
    });
  };

  const handleToggleFlairSetting = async (val) => {
    setFlairEnabled(val);
    const currentSettings = await db.settings.get('global') || { id: 'global' };
    await db.settings.put({ ...currentSettings, flairEnabled: val });
  };

  const handleTogglePreInfusion = async (val) => {
    setUsePreInfusion(val);
    const currentSettings = await db.settings.get('global') || { id: 'global' };
    await db.settings.put({ ...currentSettings, preInfusionEnabled: val });
  };

  const handleToggleDarkMode = async () => {
    const next = !darkMode;
    setDarkMode(next);
    const currentSettings = await db.settings.get('global') || { id: 'global' };
    await db.settings.put({ ...currentSettings, darkMode: next });
  };

  const handleToggleBrewGuide = async (val) => {
    if (!val && activeTab === 'brew') setActiveTab('dial');
    const currentSettings = await db.settings.get('global') || { id: 'global' };
    await db.settings.put({ ...currentSettings, brewGuideEnabled: val });
  };

  const handleToggleStatsForNerds = async (val) => {
    if (!val) setExpandedShotStatsIds(new Set());
    const currentSettings = await db.settings.get('global') || { id: 'global' };
    await db.settings.put({ ...currentSettings, statsForNerdsEnabled: val });
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
    const currentSettings = await db.settings.get('global') || { id: 'global' };
    await db.settings.put({
      ...currentSettings,
      brewGuideAccessories: normalizeBrewAccessories(accessories),
      brewGuideSetupComplete: true,
    });
  };

  const patchBrewGuidanceSettings = async (patch) => {
    const currentSettings = await db.settings.get('global') || { id: 'global' };
    await db.settings.put({ ...currentSettings, ...patch });
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
    const nextCount = logoClickCount + 1;
    setLogoClickCount(nextCount);
    if (nextCount >= 5) {
      setIsAdminOpen(true);
      setLogoClickCount(0);
    }
  };

  const handleStatsTabClick = () => {
    setActiveTab('stats');
    const nextCount = statsClickCount + 1;
    setStatsClickCount(nextCount);
    if (nextCount >= 5) {
      setEasterEggActive(true);
      setStatsClickCount(0);
      setTimeout(() => setEasterEggActive(false), 8000);
    }
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

    try {
      const sanitized = sanitizeRating(newBean.rating);
      const beanToSave = { ...newBean, rating: sanitized !== '' ? sanitized : null, isDecaf: beanIsDecaf(newBean) };
      
      if (isEditingBean && newBean.id) {
        await db.beans.update(newBean.id, beanToSave);
        const existingRecipe = recipes.find(r => r.beanId === newBean.id);
        if (existingRecipe) {
          await db.recipes.update(existingRecipe.id, { ...newRecipe, targetYieldG: parseFloat(newRecipe.targetYieldG) || 36 });
        }
      } else {
        const isFirstBeanAdd = beans.length === 0;
        const beanId = generateId();
        await db.beans.add({ ...beanToSave, id: beanId, isFinished: false, thawHistory: [], createdAt: new Date().toISOString() });
        await db.recipes.add({ ...newRecipe, targetYieldG: parseFloat(newRecipe.targetYieldG) || 36, id: generateId(), beanId });
        setSelectedBeanId(beanId);

        const currentSettings = await db.settings.get('global') || { id: 'global' };
        if (shouldNavigateToBrewAfterFirstBean(currentSettings, isFirstBeanAdd, Boolean(currentSettings.brewGuideEnabled))) {
          await patchBrewGuidanceSettings({ brewGuideFirstBeanNavDone: true });
          setIsEditingBean(false);
          setNewBean({ name: '', roaster: '', roastType: 'Medium', roastDate: '', storageType: 'bag', postThawStorage: 'bag', freezeDate: '', thawDate: '', thawHistory: [], rating: '', isFinished: false, isDecaf: false });
          setActiveTab('brew');
          return;
        }
      }

      setNewBean({ name: '', roaster: '', roastType: 'Medium', roastDate: '', storageType: 'bag', postThawStorage: 'bag', freezeDate: '', thawDate: '', thawHistory: [], rating: '', isFinished: false, isDecaf: false });
      setIsEditingBean(false);
      setActiveTab('dial');
    } catch (err) {
      console.error("Failed to save bean profile:", err);
      setValidationError("Failed to save bean: " + err.message);
    }
  };

  const startEditBean = (bean) => {
    const recipe = recipes.find(r => r.beanId === bean.id);
    setNewBean(bean);
    if (recipe) setNewRecipe(recipe);
    setIsEditingBean(true);
    setActiveTab('beans');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cancelEditBean = () => {
    setIsEditingBean(false);
    setNewBean({ name: '', roaster: '', roastType: 'Medium', roastDate: '', storageType: 'bag', postThawStorage: 'bag', freezeDate: '', thawDate: '', thawHistory: [], rating: '', isFinished: false, isDecaf: false });
    setNewRecipe({ 
      targetDoseG: 18, 
      targetYieldG: '', 
      targetTimeMinS: 27, 
      targetTimeMaxS: 32,
      brewTemperatureC: defaultBrewTemperatureForGrinder(grinderModel),
      flairProfile: { preinfusionPressure: '', preinfusionTime: '', peakPressure: '', peakEndYield: '', taperPressure: '' }
    });
  };

  const handleUpdateBeanRating = async (beanId, val) => {
    const sanitized = sanitizeRating(val);
    await db.beans.update(beanId, { rating: sanitized !== '' ? sanitized : null });
  };

  const handleToggleFinished = async (beanId, currentStatus) => {
    await db.beans.update(beanId, { isFinished: !currentStatus });
    if (!currentStatus && selectedBeanId === beanId) {
      const remaining = beans.filter(b => b.id !== beanId && !b?.isFinished);
      setSelectedBeanId(remaining.length > 0 ? remaining[0].id : '');
    }
  };

  const handleDeleteBean = async (beanId) => {
    if (window.confirm("Are you sure you want to delete this coffee profile? This will permanently remove its recipe and all associated shot history.")) {
      await db.beans.delete(beanId);
      
      const associatedRecipes = await db.recipes.where('beanId').equals(beanId).toArray();
      for (const r of associatedRecipes) await db.recipes.delete(r.id);
      
      const associatedShots = await db.shots.where('beanId').equals(beanId).toArray();
      for (const s of associatedShots) await db.shots.delete(s.id);

      if (selectedBeanId === beanId) {
        const remaining = beans.filter(b => b.id !== beanId && !b?.isFinished);
        setSelectedBeanId(remaining.length > 0 ? remaining[0].id : '');
      }
    }
  };

  const handleThawNewBag = async () => {
    if (!activeBean) return;
    const todayStr = mockDate || new Date().toISOString().slice(0, 10);
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
      knownIssueReason: nextExcluded ? (shot.knownIssueReason || 'other') : undefined,
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

    const parsedGrind = parseGrindForShotSave(grinderModel, { setteMacro, setteMicro, sunbeamSetting });
    if (!parsedGrind.ok) {
      setValidationError(parsedGrind.error);
      return;
    }
    const { setteMacro: finalMacro, setteMicro: finalMicro, sunbeamSetting: finalSunbeam } = parsedGrind;

    if (!activeBean || !activeRecipe) {
      setValidationError('Missing active coffee profile or recipe.');
      return;
    }

    let recommendationFollowed = true;
    if (lastLearningShot && lastLearningShot.recommendation?.recommendedSetting) {
      // Use age-adjusted recommendation for comparison so thaw/freshness shifts don't cause false flags
      const adjustedRec = getAgeAdjustedRecommendation(lastLearningShot, activeBean, mockDate);
      const rec = adjustedRec?.recommendedSetting || lastLearningShot.recommendation.recommendedSetting;

      if (!grindMatchesStoredRecommendation(
        lastLearningShot.grinderModel,
        { setteMacro: finalMacro, setteMicro: finalMicro, sunbeamSetting: finalSunbeam },
        rec
      )) {
        recommendationFollowed = false;
      }
    }

    const lastShotGrind = lastLearningShot ? {
      setteMacro: lastLearningShot.setteMacro,
      setteMicro: lastLearningShot.setteMicro,
      sunbeamSetting: lastLearningShot.sunbeamSetting
    } : null;

    let referenceNow = new Date();
    if (mockDate) {
      const parsedMock = new Date(mockDate);
      if (!isNaN(parsedMock.getTime())) {
        referenceNow = parsedMock;
      }
    }

    const ageData = calculateEffectiveBeanAge(activeBean, mockDate);
    const recentBeanShots = shots.filter((s) => s.beanId === activeBean.id && shotEligibleForLearning(s));

    const rec = calculateRecommendation(
      { 
        grinderModel, 
        setteMacro: finalMacro, 
        setteMicro: finalMicro, 
        sunbeamSetting: finalSunbeam, 
        wasPurged, 
        actualTime: parsedTime, 
        actualDose: parsedDose, 
        actualYield: parsedYield, 
        tasteProfile, 
        lastShotGrind,
        recommendationFollowed,
        previousShot: lastLearningShot || null,
      },
      activeRecipe,
      recentBeanShots,
      flairEnabled
    );

    const shotRecord = {
      id: generateId(),
      beanId: activeBean.id,
      timestamp: referenceNow.toISOString(),
      grinderModel,
      setteMacro: finalMacro,
      setteMicro: finalMicro,
      sunbeamSetting: finalSunbeam,
      wasPurged,
      actualDoseG: parsedDose,
      actualYieldG: parsedYield,
      actualTimeS: parsedTime,
      tasteProfile,
      shotRating: shotRating !== null ? shotRating : undefined,
      brewRatio: `1:${brewRatio}`,
      beanAgeDays: ageData.daysOld,
      storageType: activeBean.storageType || 'bag',
      recommendationFollowed,
      targetTimeMinS: activeRecipe.targetTimeMinS,
      targetTimeMaxS: activeRecipe.targetTimeMaxS,
      brewTemperatureC: activeRecipe.brewTemperatureC || null,
      flairProfile: flairEnabled && activeRecipe.flairProfile ? { ...activeRecipe.flairProfile } : null,
      recommendation: rec,
      notes: usePreInfusion && preInfusionSeconds > 0 ? `Pre-infusion: ${preInfusionSeconds}s. ${notes}` : notes,
      ...(excludeFromLearning
        ? { excludeFromLearning: true, knownIssueReason: knownIssueReason || 'other' }
        : {}),
    };

    try {
      await db.shots.add(shotRecord);
      
      setActualTimeS('');
      setActualYieldG(activeRecipe?.targetYieldG || '');
      setShotRating(null);
      setNotes('');
      setTasteProfile('');
      setExcludeFromLearning(false);
      setKnownIssueReason('puck_prep');
      handleResetTimer();

      setTimeout(() => {
        recommendationRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    } catch (err) {
      console.error("Database save failed:", err);
      setValidationError(`Error saving to database: ${err.message || 'Unknown IndexedDB Error.'}`);
    }
  };

  const dynamicRec = lastLearningShot ? getAgeAdjustedRecommendation(lastLearningShot, activeBean, mockDate) : null;
  const lastShotOutcome =
    lastLoggedShot && activeRecipe
      ? classifyShotOutcome(lastLoggedShot, recipeContextForShot(lastLoggedShot, activeRecipe))
      : null;
  const recommendationEvidenceContext =
    dynamicRec?.evidenceContext ||
    (activeRecipe && beanShots.some(shotEligibleForLearning)
      ? getRecommendationEvidenceContext(beanShots, activeRecipe, flairEnabled)
      : null);

  const beanShotsForGrinder = activeBean
    ? shots.filter((s) => s.beanId === activeBean.id && s.grinderModel === grinderModel && shotEligibleForLearning(s))
    : [];
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
    ? getInitialGrindRecommendation(grinderModel, activeBean.roastType, activeBean, recipes, shots, beans, mockDate)
    : null;

  const currentGrindLabel = formatCurrentGrindLabel(grinderModel, { setteMacro, setteMicro, sunbeamSetting });

  const timerWindowSeconds =
    (usePreInfusion ? Number(activeRecipe?.flairProfile?.preinfusionTime) || 12 : 0) +
    (activeRecipe?.targetTimeMaxS || 32) +
    6;
  const timerDisplaySeconds =
    usePreInfusion && timerRunning && !preInfusionPhase
      ? Math.max(0, timerSeconds - preInfusionSeconds)
      : timerSeconds;
  const timerProgress = timerRunning ? Math.min(1, timerSeconds / timerWindowSeconds) : 0;

  const formatFlairRecipeLines = (profile) => {
    if (!profile) return [];
    const lines = [];
    if (profile.preinfusionPressure) {
      lines.push(`Pre-infusion: ${profile.preinfusionPressure} bar · ${profile.preinfusionTime || '—'}s`);
    }
    if (profile.peakPressure) {
      lines.push(`Hold: ${profile.peakPressure} bar → ${profile.peakEndYield || '—'}g`);
    }
    if (profile.taperPressure) {
      lines.push(`Taper: ${profile.taperPressure} bar`);
    }
    return lines;
  };

  const applyRecommendation = async () => {
    if (!dynamicRec || !dynamicRec.recommendedSetting) return;
    const recSet = dynamicRec.recommendedSetting;
    
    const currentSettings = await db.settings.get('global') || { id: 'global' };

    const applyGrinder = lastLearningShot.grinderModel;
    const uiState = uiStateFromRecommendedSetting(applyGrinder, recSet);
    if (uiState) {
      setGrinderModel(applyGrinder);
      if (uiState.setteMacro != null) setSetteMacro(uiState.setteMacro);
      if (uiState.setteMicro != null) setSetteMicro(uiState.setteMicro);
      if (uiState.sunbeamSetting != null) setSunbeamSetting(uiState.sunbeamSetting);
      await db.settings.put({
        ...currentSettings,
        ...persistedSettingsPatchFromRecommendation(applyGrinder, recSet),
      });
    }

    if (grindSettingsRef.current) {
      grindSettingsRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightGrind(true);
      setTimeout(() => setHighlightGrind(false), 1500);
    }
  };

  const exportDataCSV = () => {
    const headers = ['Timestamp', 'Bean', 'Grinder', 'Grind Setting', 'Purged', 'Dose(g)', 'Yield(g)', 'Ratio', 'Time(s)', 'Taste', 'Rating', 'Bean Age (Days)', 'Storage', 'Rec Followed', 'Excluded From Learning', 'Known Issue Reason', 'Notes'];
    const rows = shots.map(s => {
      const bean = beans.find(b => b.id === s.beanId);
      const grind = formatShotGrindForHistory(s);
      return [
        new Date(s.timestamp).toLocaleString(),
        bean ? bean.name : 'Unknown',
        s.grinderModel,
        grind,
        s.wasPurged ? 'Yes' : 'No',
        s.actualDoseG,
        s.actualYieldG,
        s.brewRatio || '',
        s.actualTimeS,
        s.tasteProfile,
        s.shotRating || '',
        s.beanAgeDays || 0,
        s.storageType || 'bag',
        s.recommendationFollowed !== false ? 'Yes' : 'No',
        s.excludeFromLearning ? 'Yes' : 'No',
        s.excludeFromLearning ? knownIssueReasonLabel(s.knownIssueReason) : '',
        `"${s.notes || ''}"`
      ];
    });

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `espresso_shots_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const beanAgeInfo = activeBean ? calculateEffectiveBeanAge(activeBean, mockDate) : null;
  const filteredShots = historyFilterBeanId === 'all' ? shots : shots.filter(s => s.beanId === historyFilterBeanId);

  const referenceNow = mockDate ? new Date(mockDate) : new Date();
  const lastBrewDaysAgo = lastLoggedShot ? Math.max(0, Math.floor((referenceNow - new Date(lastLoggedShot.timestamp)) / (1000 * 60 * 60 * 24))) : 0;

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
    good: shots.filter(s => s.tasteProfile === 'good' || s.tasteProfile === 'balanced').length,
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
    return formatPreviousGrindLabel(grinderModel, shot);
  })();

  const recommendedGrindDisplay = (() => {
    if (lastLearningShot && dynamicRec?.recommendedSetting) {
      return formatRecommendedGrindDisplay(lastLearningShot.grinderModel, dynamicRec.recommendedSetting);
    }
    if (!hasLoggedShotForBean && initialGrindSetting) {
      return formatInitialGrindDisplay(grinderModel, initialGrindSetting);
    }
    return currentGrindLabel;
  })();

  const grinderBadgeLabel = getUiGrinderPresentation(grinderModel).shortBadgeLabel;

  const formatShotWhen = (timestamp) => {
    const d = new Date(timestamp);
    const now = mockDate ? new Date(mockDate) : new Date();
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
    handleStartTimer();
  };

  const handleBrewResetTimer = () => {
    handleResetTimer();
    setActualTimeS('');
  };

  const handleBrewHandoff = ({ timeS, yieldG } = {}) => {
    if (activeRecipe && activeRecipe.targetDoseG != null && activeRecipe.targetDoseG !== '') {
      setActualDoseG(activeRecipe.targetDoseG);
    }
    if (timeS != null && timeS !== '') setActualTimeS(timeS);
    if (yieldG != null && yieldG !== '' && Number(yieldG) > 0) setActualYieldG(yieldG);
    setWasPurged(true);
    if (lastLearningShot && dynamicRec?.recommendedSetting && lastLearningShot.grinderModel === grinderModel) {
      const uiState = uiStateFromRecommendedSetting(grinderModel, dynamicRec.recommendedSetting);
      if (uiState?.setteMacro != null) setSetteMacro(uiState.setteMacro);
      if (uiState?.setteMicro != null) setSetteMicro(uiState.setteMicro);
      if (uiState?.sunbeamSetting != null) setSunbeamSetting(uiState.sunbeamSetting);
    }
    setBrewTimerHost(false);
    setShotFieldHighlights({ ...EMPTY_SHOT_FIELD_HIGHLIGHTS, taste: true });
    setActiveTab('dial');
    window.setTimeout(() => {
      tasteInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      tasteInputRef.current?.querySelector('button')?.focus();
    }, 200);
  };

  if (!grinderModel) {
    return (
      <div className={`min-h-screen ${ui.page} flex items-center justify-center p-6`}>
        <div className={`${ui.card} p-8 rounded-2xl max-w-sm w-full space-y-8 shadow-2xl`}>
          <div className="flex flex-col items-center gap-4">
            <img src="/logo.jpg" alt="Espresso Dial-In" className="w-16 h-16 rounded-full object-cover ring-2 ring-[#2e2b26]" />
            <div className="text-center">
              <h1 className="text-xl font-bold text-[#f5f2eb] tracking-tight">Espresso Dial-In</h1>
              <p className="text-xs text-[#6b6457] mt-1 tracking-wide uppercase">Precision dial-in assistant</p>
            </div>
          </div>
          <div>
            <p className="text-sm text-[#a09880] text-center mb-6">Select your grinder to configure your calibration baseline.</p>
            <div className="space-y-4 mb-4">
              <div className={`bg-[#211e1a] border border-[#2e2b26] rounded-xl p-4 flex items-center justify-between gap-3`}>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-[#f5f2eb]">Would you like to use the Brew Guide?</p>
                  <p className="text-[11px] text-[#6b6457] mt-1">You can change these settings later in Settings.</p>
                </div>
                <SettingsToggle
                  checked={setupBrewGuideEnabled}
                  onChange={setSetupBrewGuideEnabled}
                  label="Brew Guide"
                />
              </div>
            </div>
            <div className="space-y-3">
              {GRINDER_SETUP_OPTIONS.map((option, index) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => handleSaveGrinderSetup(option.id, { brewGuideEnabled: setupBrewGuideEnabled })}
                  className={`w-full font-bold py-4 rounded-xl text-sm transition-colors ${
                    index === 0
                      ? 'bg-[#c88a4b] hover:bg-[#e0a660] text-[#121110]'
                      : 'bg-[#211e1a] hover:bg-[#2e2b26] text-[#f5f2eb] border border-[#2e2b26]'
                  }`}
                >
                  {option.setupCardLabel}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${ui.page} relative`}>
      
      {/* FULL-SCREEN ACTIVE TIMER — mobile-first, tap anywhere to advance */}
      {timerRunning && !brewTimerHost && (
        <div
          className="fixed inset-0 z-[60] flex flex-col bg-[#121212] cursor-pointer select-none pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
          onClick={handleTimerSurfaceTap}
          role="presentation"
        >
          <div className="h-14 px-4 flex items-center justify-between border-b border-[#1e1e1e] shrink-0">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${timerRunning ? 'bg-[#3dd68c] animate-pulse' : 'bg-[#5a5754]'}`} />
              <span className="text-[11px] tracking-[0.14em] font-semibold text-[#9a9690] uppercase">
                {usePreInfusion && preInfusionPhase
                  ? 'Pre-infusion'
                  : usePreInfusion
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

          <div className="flex-1 flex flex-col items-center justify-center px-5 min-h-0 pointer-events-none">
            {flairEnabled && activeRecipe?.flairProfile && (
              <div className="w-full max-w-sm mb-6 opacity-35">
                <PressureProfileChart profile={activeRecipe.flairProfile} progress={timerProgress} compact />
              </div>
            )}

            {usePreInfusion && !preInfusionPhase && (
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
              className={`text-[clamp(3.75rem,20vw,5.25rem)] font-bold tabular-nums tracking-[-0.06em] leading-[0.9] ${
                usePreInfusion && preInfusionPhase ? 'text-[#a09880]' : 'text-[#ede9e3]'
              }`}
            >
              {formatTimerLive(usePreInfusion && !preInfusionPhase ? timerDisplaySeconds : timerSeconds)}
            </div>
            <p className="text-[13px] text-[#6b6457] mt-4 text-center">
              {usePreInfusion && preInfusionPhase
                ? `Total ${timerSeconds.toFixed(1)}s · pre-infusing`
                : usePreInfusion
                  ? `Total ${timerSeconds.toFixed(1)}s · extraction`
                  : 'Total extraction time'}
            </p>
          </div>

          <div className="px-4 pb-6 pt-2 space-y-4 max-w-md mx-auto w-full">
            <div className="w-full h-1 bg-[#1e1e1e] rounded-full overflow-hidden pointer-events-none">
              <div
                className="h-full bg-[#c88a4b] transition-[width] duration-100 ease-linear"
                style={{ width: `${timerProgress * 100}%` }}
              />
            </div>

            <p className="text-center text-[11px] text-[#4a4846] pointer-events-none">
              {usePreInfusion && preInfusionPhase
                ? 'Tap anywhere to end pre-infusion'
                : 'Tap anywhere to stop and fill shot time'}
            </p>

            <div className="flex flex-col gap-3 pointer-events-auto">
              {usePreInfusion && preInfusionPhase ? (
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
                  className="w-full min-h-[72px] rounded-[20px] bg-[#ede6dd] text-[#121212] font-bold text-base active:scale-[0.99] shadow-[0_12px_32px_rgba(237,230,221,0.2)]"
                >
                  Stop shot
                </button>
              )}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); handleCancelTimer(); }}
                className="w-full min-h-[48px] rounded-[14px] bg-[#1e1e1e] border border-[#262626] text-[13px] font-medium text-[#6b6457]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {easterEggActive && (
        <div className="fixed inset-0 z-50 pointer-events-none bg-black/95 flex flex-col items-center justify-center p-6 text-center animate-pulse overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-red-600 via-emerald-500 to-blue-600 opacity-40 animate-spin" style={{ animationDuration: '2s' }} />
          <div className="relative z-10 space-y-6">
            <h1 className="text-4xl md:text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-300 via-rose-500 to-cyan-400 animate-bounce">
              ⚡ QUANTUM ESPRESSO SINGULARITY ⚡
            </h1>
            <p className="text-lg font-mono text-emerald-300">MOLECULAR COFFEE EXTRACTION AT 50,000 RPM. REALITY DISTORTED.</p>
            <div className="text-7xl animate-spin">☕🌀⚛️💥</div>
          </div>
        </div>
      )}

      {/* Main scrollable content — padded for fixed bottom nav (+ log bar on dial) */}
      <div className={`max-w-xl mx-auto px-4 pt-5 ${activeTab === 'dial' && activeBeansList.length > 0 ? 'pb-40' : 'pb-24'}`}>
        
        <header className={`flex items-center justify-between pb-5 mb-6 border-b ${ui.headerBorder}`}>
          <div className="flex items-center gap-3 cursor-pointer select-none" onClick={handleLogoClick} title="Espresso Dial-In">
            <img src="/logo.jpg" alt="Logo" className="w-8 h-8 rounded-full object-cover ring-1 ring-[#2e2b26]" />
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
          <div className="space-y-6">
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
                <div className={`${ui.card} p-4 rounded-2xl space-y-4`}>
                  <div className="flex justify-between items-start gap-2 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <select
                        value={activeBean?.id || ''}
                        onChange={(e) => setSelectedBeanId(e.target.value)}
                        className={`bg-transparent ${ui.text} font-bold text-base focus:outline-none w-full truncate`}
                      >
                        {activeBeansList.map(b => (
                          <option key={b.id} value={b.id} className="bg-[#1a1815]">
                            {b.name} ({b.roaster}){beanIsDecaf(b) ? ' · Decaf' : ''}{b.rating ? ` [${Number(b.rating).toFixed(1)}]` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                      {activeBean?.storageType === 'frozen' && (
                        <button type="button" onClick={handleThawNewBag} className={`text-[10px] ${ui.accentText} font-semibold hover:underline`}>
                          Thaw new bag
                        </button>
                      )}
                      {activeBean?.storageType === 'frozen' && activeBean.thawHistory?.length > 0 && (
                        <button type="button" onClick={handleReverseThaw} className={`text-[10px] ${ui.sub} flex items-center gap-1`}>
                          <RotateCcw className="w-3 h-3" /> Undo thaw
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleToggleFinished(activeBean.id, activeBean.isFinished)}
                        className={`text-[11px] font-bold px-3 py-2 rounded-lg border min-h-[40px] shrink-0 ${
                          activeBean.isFinished
                            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                            : `${ui.secondaryBtn}`
                        }`}
                      >
                        {activeBean.isFinished ? 'Mark beans as active' : 'Mark beans as finished'}
                      </button>
                    </div>
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
                        <button type="button" onClick={() => setActiveTab('beans')} className={`text-[10px] ${ui.accentText} font-semibold`}>
                          Edit on Beans
                        </button>
                      </div>
                      <div className={`${ui.cardInset} rounded-xl px-3 py-2`}>
                        <PressureProfileChart profile={activeRecipe.flairProfile} />
                      </div>
                    </div>
                  )}
                </div>

                {/* ── GRIND ADJUSTMENT HERO ───────────────────────────── */}
                <div ref={recommendationRef} className={`${ui.card} p-5 rounded-2xl space-y-4 shadow-[0_8px_28px_rgba(0,0,0,0.28)]`}>
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
                      {lastShotOutcome?.statusLabel && (
                        <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md text-center ${lastShotOutcome.isDialledIn ? ui.badge : `${ui.cardInset} ${ui.muted}`}`}>
                          {lastShotOutcome.statusLabel}
                        </span>
                      )}
                    </div>
                  </div>

                  {dynamicRec?.originalReason && (
                    <p className={`text-sm ${ui.sub} leading-relaxed`}>
                      {dynamicRec.originalReason.includes('—')
                        ? dynamicRec.originalReason.split('—').slice(1).join('—').trim() || dynamicRec.originalReason
                        : dynamicRec.originalReason}
                    </p>
                  )}
                  {recommendationEvidenceContext && (
                    <p className={`text-[10px] ${ui.muted}`}>{recommendationEvidenceContext}</p>
                  )}
                  {decafNote && (
                    <p className={`text-[10px] ${ui.accentText} ${ui.freezeHint} p-2.5 rounded-lg`}>{decafNote}</p>
                  )}
                  {!dynamicRec && !hasLoggedShotForBean && (
                    <>
                      <p className={`text-sm ${ui.sub}`}>Start here, then log your first shot to begin dialling in.</p>
                      {initialGrindSetting && (
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
                    <div className="flex items-start gap-2 bg-[rgba(180,60,60,0.08)] border border-[rgba(180,60,60,0.2)] p-3 rounded-xl text-xs text-[#d08080]">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>{dynamicRec.warning}</span>
                    </div>
                  )}
                  {dynamicRec?.subRecommendation && (
                    <p className={`text-xs ${ui.sub}`}>{dynamicRec.subRecommendation}</p>
                  )}

                  <div className={`flex items-center justify-between gap-3 pt-3 border-t ${ui.headerBorder}`}>
                    <p className={`text-xs ${ui.muted}`}>
                      {lastLoggedShot
                        ? `Last shot ${lastLoggedShot.actualTimeS || 0}s (${lastLoggedShot.tasteProfile?.replace('_', ' ') || '—'})${lastShotOutcome?.statusLabel ? ` · ${lastShotOutcome.statusLabel}` : ''}${lastLoggedShot.excludeFromLearning ? ` · kept in history, not used for learning${lastLoggedShot.knownIssueReason ? ` (${knownIssueReasonLabel(lastLoggedShot.knownIssueReason)})` : ''}` : ''}${lastLearningShot && lastLearningShot.id !== lastLoggedShot?.id ? ' · grind from earlier shot' : ''} · logging ${currentGrindLabel}`
                        : `Logging grind ${currentGrindLabel}`}
                    </p>
                    {lastLearningShot && dynamicRec?.recommendedSetting && (
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
                      grindLabel: recommendedGrindDisplay,
                      previousGrindLabel,
                    }}
                    onOpenFullGuide={() => setActiveTab('brew')}
                    onRevertToFullGuide={handleRevertToFullBrewGuide}
                    onNoChecklist={handleNoBrewChecklist}
                    onEditAccessories={handleOpenBrewAccessories}
                  />
                )}

                {/* ── SHOT LOG FORM ─────────────────────────────────────── */}
                <form onSubmit={handleLogShot} className="space-y-4">

                  {validationError && (
                    <div className="bg-[rgba(180,60,60,0.12)] border border-[rgba(180,60,60,0.3)] p-3 rounded-xl text-xs text-[#d08080] font-semibold flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>{validationError}</span>
                    </div>
                  )}

                  <div className={`${ui.card} p-5 rounded-2xl space-y-4`}>
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className={`text-[10px] uppercase tracking-widest ${ui.muted} mb-2`}>Live shot timer</p>
                        <span className="text-4xl font-black font-mono text-[#f5f2eb] tabular-nums">{formatTime(timerSeconds)}</span>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button type="button" onClick={handleStartTimer} className="px-6 py-3.5 min-h-[48px] bg-[#c88a4b] hover:bg-[#e0a660] text-[#121110] rounded-xl font-bold flex items-center gap-2 transition-colors">
                          <Play className="w-4 h-4 fill-current" /> Start
                        </button>
                        <button type="button" onClick={handleResetTimer} className={`p-3.5 min-h-[48px] min-w-[48px] ${ui.secondaryBtn} rounded-xl`}>
                          <RotateCcw className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
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
                      setteMacro={setteMacro}
                      setteMicro={setteMicro}
                      sunbeamSetting={sunbeamSetting}
                      onSetteMacroChange={setSetteMacro}
                      onSetteMicroChange={setSetteMicro}
                      onSunbeamChange={setSunbeamSetting}
                      ui={ui}
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
                      className={`${ui.card} p-3 rounded-2xl transition-all duration-300 ${shotFieldAttentionClass(shotFieldHighlights.yield)}`}
                    >
                      <label className={`${ui.fieldLabel} block mb-2`}>Yield (g) *</label>
                      <input
                        type="number" step="0.1"
                        placeholder="36"
                        value={actualYieldG}
                        onChange={(e) => {
                          setActualYieldG(e.target.value);
                          setShotFieldHighlights((prev) => ({ ...prev, yield: false }));
                        }}
                        className={`w-full bg-transparent ${ui.text} text-center text-xl font-black focus:outline-none ${darkMode ? 'placeholder:text-[#6b6457]' : 'placeholder:text-[#8a8276]'}`}
                      />
                      <p className={`text-[9px] ${ui.accentText} text-center mt-1`}>1:{brewRatio}</p>
                    </div>
                    <div
                      ref={timeInputRef}
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
                        { id: 'good', label: 'Balanced' },
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
                            tasteProfile === f.id
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
                  <input
                    type="text"
                    placeholder="Notes — puck prep, channeling, batch size…"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className={`w-full ${inputClass} rounded-xl p-3 text-sm`}
                  />

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
            timer={{
              running: timerRunning,
              label: formatTimerLive(usePreInfusion && !preInfusionPhase ? timerDisplaySeconds : timerSeconds),
              usePreInfusion,
              preInfusionPhase,
            }}
            dial={{
              beanName: activeBean?.name || '',
              doseG: activeRecipe?.targetDoseG,
              yieldG: activeRecipe?.targetYieldG,
              timeMinS: activeRecipe?.targetTimeMinS,
              timeMaxS: activeRecipe?.targetTimeMaxS,
              brewTemperatureC: activeRecipe?.brewTemperatureC,
              grinderModel,
              grindLabel: recommendedGrindDisplay,
              previousGrindLabel,
            }}
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
                    required
                    value={newBean.roastDate}
                    onChange={(e) => setNewBean({ ...newBean, roastDate: e.target.value })}
                    className={`w-full ${inputClass} border rounded-lg p-2.5 text-sm`}
                  />
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
                    { label: 'Target dose', key: 'targetDoseG', value: newRecipe.targetDoseG, suffix: 'g', parse: (v) => parseFloat(v) },
                    { label: 'Yield', key: 'targetYieldG', value: newRecipe.targetYieldG, suffix: 'g', parse: (v) => v },
                  ].map((field) => (
                    <div key={field.key} className={ui.metricCell}>
                      <span className={`${ui.fieldLabel} block mb-1`}>{field.label}</span>
                      <input
                        type="number"
                        step="0.1"
                        value={field.value}
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
                        value={field.value}
                        onChange={(e) => setNewRecipe({ ...newRecipe, [field.key]: parseInt(e.target.value, 10) })}
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
                      value={newRecipe.brewTemperatureC || ''}
                      onChange={(e) => setNewRecipe({ ...newRecipe, brewTemperatureC: parseInt(e.target.value, 10) })}
                      className={`w-full bg-transparent ${ui.text} text-center text-xl font-black focus:outline-none`}
                    />
                    <span className={`text-[9px] ${ui.muted} text-center block`}>°C</span>
                    {isSunbeamGrinderModel(grinderModel) && (
                      <span className={`text-[10px] ${ui.muted} text-center block mt-1`}>92°C is the Barista Max&apos;s default temperature.</span>
                    )}
                  </div>
                </div>

                {flairEnabled && (
                  <div className={`pt-4 mt-2 border-t ${ui.modalDivider}`}>
                    <h3 className={`${ui.sectionTitle} mb-3`}>Flair pressure profile</h3>
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <div>
                        <span className={`text-[10px] ${subTextClass}`}>Pre-infuse Pressure (bar)</span>
                        <input
                          type="number" step="0.1"
                          value={newRecipe.flairProfile?.preinfusionPressure || ''}
                          onChange={(e) => setNewRecipe({ ...newRecipe, flairProfile: { ...newRecipe.flairProfile, preinfusionPressure: e.target.value } })}
                          className={`w-full ${inputClass} border rounded-lg p-2 text-sm`}
                        />
                      </div>
                      <div>
                        <span className={`text-[10px] ${subTextClass}`}>Pre-infuse Time (s)</span>
                        <input
                          type="number" step="0.1"
                          value={newRecipe.flairProfile?.preinfusionTime || ''}
                          onChange={(e) => setNewRecipe({ ...newRecipe, flairProfile: { ...newRecipe.flairProfile, preinfusionTime: e.target.value } })}
                          className={`w-full ${inputClass} border rounded-lg p-2 text-sm`}
                        />
                      </div>
                      <div>
                        <span className={`text-[10px] ${subTextClass}`}>Peak/Hold Pressure (bar)</span>
                        <input
                          type="number" step="0.1"
                          value={newRecipe.flairProfile?.peakPressure || ''}
                          onChange={(e) => setNewRecipe({ ...newRecipe, flairProfile: { ...newRecipe.flairProfile, peakPressure: e.target.value } })}
                          className={`w-full ${inputClass} border rounded-lg p-2 text-sm`}
                        />
                      </div>
                      <div>
                        <span className={`text-[10px] ${subTextClass}`}>Peak Ends at Yield (g)</span>
                        <input
                          type="number" step="0.1"
                          value={newRecipe.flairProfile?.peakEndYield || ''}
                          onChange={(e) => setNewRecipe({ ...newRecipe, flairProfile: { ...newRecipe.flairProfile, peakEndYield: e.target.value } })}
                          className={`w-full ${inputClass} border rounded-lg p-2 text-sm`}
                        />
                      </div>
                      <div>
                        <span className={`text-[10px] ${subTextClass}`}>Taper Pressure (bar)</span>
                        <input
                          type="number" step="0.1"
                          value={newRecipe.flairProfile?.taperPressure || ''}
                          onChange={(e) => setNewRecipe({ ...newRecipe, flairProfile: { ...newRecipe.flairProfile, taperPressure: e.target.value } })}
                          className={`w-full ${inputClass} border rounded-lg p-2 text-sm`}
                        />
                      </div>
                    </div>
                  </div>
                )}
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
                  <div className="flex justify-between items-center text-xs">
                    <span className={subTextClass}>Show finished bags</span>
                    <button
                      type="button"
                      onClick={() => setShowFinishedBeans(!showFinishedBeans)}
                      className={`px-2 py-1 rounded border font-semibold ${showFinishedBeans ? `${ui.primary} border-[#c88a4b]` : `${ui.chip}`}`}
                    >
                      {showFinishedBeans ? 'Hiding Finished' : 'Showing Active Only'}
                    </button>
                  </div>

                  {beans.filter(b => showFinishedBeans || !b?.isFinished).length === 0 ? (
                    <p className={`text-xs ${subTextClass}`}>No beans logged yet.</p>
                  ) : (
                    beans.filter(b => showFinishedBeans || !b?.isFinished).map(b => (
                      <div key={b.id} className={`flex items-center justify-between p-3 rounded-xl ${ui.inset} text-xs ${b.isFinished ? 'opacity-60' : ''}`}>
                        <div className="flex items-center gap-2">
                          <button onClick={() => startEditBean(b)} className={`${currentTheme.text} hover:opacity-70 p-1 bg-amber-500/10 rounded-md`} title="Edit Bean">
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button onClick={() => handleToggleFinished(b.id, b.isFinished)} className={`p-1 rounded-md ${b.isFinished ? 'bg-emerald-500/20 text-emerald-400' : ui.chip}`} title={b.isFinished ? 'Mark Active' : 'Mark Finished'}>
                            <CheckCircle className="w-4 h-4" />
                          </button>
                          <button onClick={() => handleDeleteBean(b.id)} className="text-rose-500 hover:opacity-70 p-1 bg-rose-500/10 rounded-md" title="Delete Bean Profile">
                            <Trash2 className="w-4 h-4" />
                          </button>
                          <div>
                            <span className={`font-bold ${ui.text} block`}>
                              {b.name} {b.isFinished && <span className={`text-[9px] ${ui.chip} px-1.5 py-0.5 rounded ml-1`}>Finished</span>}
                            </span>
                            <span className={`text-[10px] ${subTextClass}`}>{b.roaster} • {b.roastType} Roast ({b.storageType}){beanIsDecaf(b) ? ' • Decaf' : ''}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] uppercase font-bold ${ui.muted}`}>Rating:</span>
                          <input
                            type="number"
                            step="0.1"
                            min="1.0"
                            max="10.0"
                            placeholder="e.g. 9.2"
                            value={b.rating !== null && b.rating !== undefined ? b.rating : ''}
                            onChange={(e) => handleUpdateBeanRating(b.id, e.target.value)}
                            className={`w-16 ${inputClass} border rounded-lg p-1.5 text-center text-xs font-bold text-amber-500`}
                          />
                        </div>
                      </div>
                    ))
                  )}
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
                  <option key={b.id} value={b.id}>{b.name} {b.isFinished ? '(Finished)' : ''}</option>
                ))}
              </select>
            </div>

            {filteredShots.length === 0 ? (
              <p className={`text-sm ${subTextClass}`}>No shots logged yet.</p>
            ) : (
              filteredShots.map(s => {
                const bean = beans.find(b => b.id === s.beanId);
                const grindStr = formatShotGrindForHistory(s);
                const recipeForShot = recipes.find(r => r.beanId === s.beanId);
                const minT = recipeForShot?.targetTimeMinS || 27;
                const maxT = recipeForShot?.targetTimeMaxS || 32;
                const preSec = preInfusionFromNotes(s.notes);
                const peakBar = s.flairProfile?.peakPressure;
                const shotOutcome = classifyShotOutcome(s, recipeContextForShot(s, recipeForShot || {}));
                return (
                  <div key={s.id} className={`${ui.card} p-4 rounded-2xl space-y-3`}>
                    <div className="flex justify-between items-start gap-2">
                      <div className="min-w-0">
                        <span className={`text-sm font-bold ${ui.accentText}`}>
                          {bean ? `${bean.name} [${bean.rating ? Number(bean.rating).toFixed(1) : 'N/A'}]` : 'Unknown bean'}
                        </span>
                        {shotOutcome.statusLabel && (
                          <span className={`ml-2 text-[9px] font-bold uppercase tracking-wide ${shotOutcome.isDialledIn ? ui.accentText : ui.muted}`}>
                            {shotOutcome.statusLabel}
                          </span>
                        )}
                        <p className={`text-[10px] ${ui.muted} mt-0.5`}>
                          {formatShotWhen(s.timestamp)} • <span className={`${ui.strong} font-mono`}>{grindStr}</span>
                          {s.recommendationFollowed === false && <span className="text-rose-400 font-bold ml-2">Rec not followed</span>}
                          {s.excludeFromLearning && (
                            <span className={`${ui.chip} font-semibold ml-2 px-1.5 py-0.5 rounded`}>
                              Not used for learning
                            </span>
                          )}
                        </p>
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
                          className={`text-[9px] font-bold uppercase tracking-wide px-2 py-1 rounded-md ${s.excludeFromLearning ? 'bg-[rgba(200,138,75,0.15)] text-[#c88a4b]' : `${ui.chip} ${ui.muted}`}`}
                          title={s.excludeFromLearning ? 'Include in grind learning again' : 'Mark as known issue — exclude from learning'}
                        >
                          {s.excludeFromLearning ? 'Use for learning' : 'Known issue'}
                        </button>
                        <button type="button" onClick={() => handleDeleteShot(s.id)} className={`${ui.muted} hover:text-rose-400 p-1`}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-4 gap-2 text-xs">
                      {[
                        { label: 'Grind', value: grindStr, tone: ui.text },
                        { label: 'Dose/Yield', value: `${s.actualDoseG || 0}/${s.actualYieldG || 0}g`, tone: ui.text },
                        { label: 'Time', value: `${s.actualTimeS || 0}s`, tone: shotTimeTone(s.actualTimeS, minT, maxT) },
                        { label: 'Taste', value: (s.tasteProfile?.replace('_', ' ') || '—'), tone: `${ui.sub} capitalize` },
                      ].map((cell) => (
                        <div key={cell.label} className={`${ui.metricCell} text-center`}>
                          <span className={`block text-[8px] uppercase tracking-wider ${ui.muted} mb-1`}>{cell.label}</span>
                          <strong className={`font-black text-sm ${cell.tone}`}>{cell.value}</strong>
                        </div>
                      ))}
                    </div>

                    <div className={`flex flex-wrap items-center gap-2 text-[10px] ${ui.muted}`}>
                      {preSec && <span className="italic">Pre-infusion: {preSec}s.</span>}
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
                { label: 'Total shots', value: totalShots },
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
                    { label: 'Balanced', count: tasteCounts.good, color: TASTE_CHART_COLORS.good },
                    { label: 'Bitter', count: tasteCounts.bitter, color: TASTE_CHART_COLORS.bitter },
                    { label: 'Very bitter', count: tasteCounts.very_bitter, color: TASTE_CHART_COLORS.very_bitter },
                  ].map(item => {
                    const pct = totalShots > 0 ? Math.round((item.count / totalShots) * 100) : 0;
                    return (
                      <div key={item.label} className="space-y-1">
                        <div className="flex justify-between font-semibold">
                          <span className={subTextClass}>{item.label}</span>
                          <span>{item.count} shots ({pct}%)</span>
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
                            <span className={`text-[10px] ${subTextClass}`}>{b.roaster} • {b.roastType} Roast</span>
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
                  <label className={`block ${ui.fieldLabel}`}>Primary grinder setup</label>
                  <select
                    value={grinderModel}
                    onChange={(e) => handleSaveGrinderSetup(e.target.value)}
                    className={`w-full ${inputClass} border rounded-lg p-2.5 font-semibold`}
                  >
                    {GRINDER_SETUP_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>{option.settingsSelectLabel}</option>
                    ))}
                  </select>
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
                  <div className={`border-t ${ui.modalDivider} pt-3 flex items-center justify-between gap-3`}>
                    <div>
                      <span className={`font-bold block ${ui.text}`}>Brew Guide</span>
                      <span className={`text-[10px] ${ui.muted}`}>Shot steps from Dial-In, plus Barista Max guides</span>
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

                <div className={`pt-2 border-t ${ui.modalDivider}`}>
                  <button
                    type="button"
                    onClick={exportDataCSV}
                    className={`w-full font-bold py-2.5 rounded-xl flex items-center justify-center gap-2 ${ui.secondaryBtn}`}
                  >
                    <Download className="w-4 h-4" /> Export All Shots to CSV
                  </button>
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
                  onClick={() => setIsSettingsOpen(false)}
                  className={`w-full ${currentTheme.primary} font-bold py-3 rounded-xl text-sm shadow`}
                >
                  Save & Close
                </button>
              </div>
            </div>
          </div>
        )}

        {isAdminOpen && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
            <div className={`${currentTheme.card} border p-6 rounded-2xl max-w-sm w-full space-y-4 shadow-xl`}>
              <div className={`flex items-center gap-2 border-b pb-3 ${ui.modalDivider}`}>
                <Shield className={`w-5 h-5 ${currentTheme.text}`} />
                <h3 className={`text-base font-bold ${ui.text}`}>Admin Panel (Testing Mode)</h3>
              </div>
              
              <div>
                <label className={`text-xs uppercase font-bold ${labelClass} block mb-1`}>Mock Todays Date</label>
                <input
                  type="date"
                  value={mockDate}
                  onChange={(e) => setMockDate(e.target.value)}
                  className={`w-full ${inputClass} border rounded-lg p-2.5 text-sm`}
                />
                <p className={`text-[10px] ${subTextClass} mt-1`}>Leave blank to use actual live system date.</p>
              </div>

              <button
                onClick={() => setIsAdminOpen(false)}
                className={`w-full ${currentTheme.primary} font-bold py-2.5 rounded-xl text-sm shadow`}
              >
                Close Admin Panel
              </button>
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
            Espresso Dial-In • v4.3
          </span>
        </footer>

      </div>

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
            { id: 'stats', label: 'Stats', icon: BarChart2, onClick: handleStatsTabClick },
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
    </div>
  );
}