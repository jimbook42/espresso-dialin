import React, { useState, useEffect, useRef } from 'react';
import { db, generateId, calculateRecommendation, calculateEffectiveBeanAge, getInitialGrindRecommendation, getAgeAdjustedRecommendation, getIdealFreezeWindow } from './utils/grinderLogic';
import { useLiveQuery } from 'dexie-react-hooks';
import { History, PlusCircle, AlertTriangle, Download, Trash2, ArrowRight, Sun, Moon, BarChart2, Shield, Star, Flame, ChevronDown, ChevronUp, Settings, Sliders, Coffee, Play, RotateCcw, Edit2, X, CheckCircle } from 'lucide-react';
import { PressureProfileChart } from './components/PressureProfileChart';
import { Analytics } from '@vercel/analytics/react';

export default function App() {
  const [activeTab, setActiveTab] = useState('dial');
  const [darkMode, setDarkMode] = useState(true);
  const [accentColor, setAccentColor] = useState('amber');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

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

  const [selectedBeanId, setSelectedBeanId] = useState('');
  const [historyFilterBeanId, setHistoryFilterBeanId] = useState('all');
  
  // Timer State
  const [timerRunning, setTimerRunning] = useState(false);
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
    isFinished: false
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

  const timeInputRef = useRef(null);
  const yieldInputRef = useRef(null);
  const tasteInputRef = useRef(null);
  const recommendationRef = useRef(null);
  const grindSettingsRef = useRef(null);
  
  const [validationError, setValidationError] = useState('');
  const [highlightGrind, setHighlightGrind] = useState(false);

  useEffect(() => {
    if (settingsSetting) {
      if (settingsSetting.grinderModel) setGrinderModel(settingsSetting.grinderModel);
      if (settingsSetting.flairEnabled !== undefined) setFlairEnabled(settingsSetting.flairEnabled);
      if (settingsSetting.preInfusionEnabled !== undefined) setUsePreInfusion(settingsSetting.preInfusionEnabled);
    }
  }, [settingsSetting]);

  const activeBeansList = beans.filter(b => !b?.isFinished);
  const activeBean = beans.find(b => b.id === selectedBeanId) || activeBeansList[0] || beans[0];
  const activeRecipe = recipes.find(r => r.beanId === activeBean?.id);
  const lastShot = shots.find(s => s.beanId === activeBean?.id);
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
    setActualTimeS(Math.round(finalExtractionTime));
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
      const currentBeanShots = shots.filter(s => s.beanId === activeBean.id && s.grinderModel === grinderModel);
      
      if (currentBeanShots.length > 0) {
        const last = currentBeanShots[0];
        const adjustedRec = getAgeAdjustedRecommendation(last, activeBean, mockDate);
        
        if (adjustedRec && adjustedRec.recommendedSetting) {
          if (grinderModel === 'Sette 270Wi') {
            setSetteMacro(adjustedRec.recommendedSetting.macro);
            setSetteMicro(adjustedRec.recommendedSetting.micro);
          } else {
            setSunbeamSetting(adjustedRec.recommendedSetting.setting);
          }
        } else {
          if (grinderModel === 'Sette 270Wi') {
            setSetteMacro(last.setteMacro || 13);
            setSetteMicro(last.setteMicro || 'E');
          } else {
            setSunbeamSetting(last.sunbeamSetting || 15);
          }
        }
      } else {
        const recParams = getInitialGrindRecommendation(grinderModel, activeBean.roastType, activeBean, recipes, shots, beans, mockDate);
        if (grinderModel === 'Sette 270Wi') {
          setSetteMacro(recParams.macro);
          setSetteMicro(recParams.micro);
        } else {
          setSunbeamSetting(recParams.setting);
        }
      }
    }
  }, [selectedBeanId, activeBean?.id, grinderModel, beans.length, mockDate, activeBean?.thawDate]);

  const handleSaveGrinderSetup = async (model) => {
    setGrinderModel(model);
    const currentSettings = await db.settings.get('global') || { id: 'global' };
    await db.settings.put({ ...currentSettings, grinderModel: model });
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
      
      if (isEditingBean && newBean.id) {
        await db.beans.update(newBean.id, { ...newBean, rating: sanitized !== '' ? sanitized : null });
        const existingRecipe = recipes.find(r => r.beanId === newBean.id);
        if (existingRecipe) {
          await db.recipes.update(existingRecipe.id, { ...newRecipe, targetYieldG: parseFloat(newRecipe.targetYieldG) || 36 });
        }
      } else {
        const beanId = generateId();
        await db.beans.add({ ...newBean, rating: sanitized !== '' ? sanitized : null, id: beanId, isFinished: false, thawHistory: [], createdAt: new Date().toISOString() });
        await db.recipes.add({ ...newRecipe, targetYieldG: parseFloat(newRecipe.targetYieldG) || 36, id: generateId(), beanId });
        setSelectedBeanId(beanId);
      }

      setNewBean({ name: '', roaster: '', roastType: 'Medium', roastDate: '', storageType: 'bag', postThawStorage: 'bag', freezeDate: '', thawDate: '', thawHistory: [], rating: '', isFinished: false });
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
    setNewBean({ name: '', roaster: '', roastType: 'Medium', roastDate: '', storageType: 'bag', postThawStorage: 'bag', freezeDate: '', thawDate: '', thawHistory: [], rating: '', isFinished: false });
    setNewRecipe({ 
      targetDoseG: 18, 
      targetYieldG: '', 
      targetTimeMinS: 27, 
      targetTimeMaxS: 32,
      brewTemperatureC: 93,
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

  const handleLogShot = async (e) => {
    e.preventDefault();
    setValidationError('');

    const parsedTime = parseInt(actualTimeS, 10);
    const parsedYield = parseFloat(actualYieldG);
    const parsedDose = parseFloat(actualDoseG);

    if (isNaN(parsedDose)) {
      setValidationError('Dose is required and must be a number.');
      return;
    }
    if (isNaN(parsedYield)) {
      setValidationError('Yield is required and must be a number.');
      yieldInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      yieldInputRef.current?.focus();
      return;
    }
    if (isNaN(parsedTime)) {
      setValidationError('Extraction time is required and must be a number.');
      timeInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      timeInputRef.current?.focus();
      return;
    }
    if (!tasteProfile) {
      setValidationError('Taste profile selection is required.');
      tasteInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    let finalMacro = null;
    let finalMicro = null;
    let finalSunbeam = null;

    if (grinderModel === 'Sette 270Wi') {
      finalMacro = parseInt(setteMacro, 10);
      if (isNaN(finalMacro)) {
        setValidationError('Sette Macro setting must be a valid number.');
        return;
      }
      finalMicro = setteMicro || 'E';
    } else {
      finalSunbeam = parseInt(sunbeamSetting, 10);
      if (isNaN(finalSunbeam)) {
        setValidationError('Sunbeam dial setting must be a valid number.');
        return;
      }
    }

    if (!activeBean || !activeRecipe) {
      setValidationError('Missing active coffee profile or recipe.');
      return;
    }

    let recommendationFollowed = true;
    if (lastShot && lastShot.recommendation?.recommendedSetting) {
      // Use age-adjusted recommendation for comparison so thaw/freshness shifts don't cause false flags
      const adjustedRec = getAgeAdjustedRecommendation(lastShot, activeBean, mockDate);
      const rec = adjustedRec?.recommendedSetting || lastShot.recommendation.recommendedSetting;

      if (lastShot.grinderModel === 'Sette 270Wi') {
        if (finalMacro !== rec.macro || finalMicro !== rec.micro) {
          recommendationFollowed = false;
        }
      } else if (lastShot.grinderModel === 'Sunbeam Barista Max') {
        if (finalSunbeam !== rec.setting) {
          recommendationFollowed = false;
        }
      }
    }

    const lastShotGrind = lastShot ? {
      setteMacro: lastShot.setteMacro,
      setteMicro: lastShot.setteMicro,
      sunbeamSetting: lastShot.sunbeamSetting
    } : null;

    let referenceNow = new Date();
    if (mockDate) {
      const parsedMock = new Date(mockDate);
      if (!isNaN(parsedMock.getTime())) {
        referenceNow = parsedMock;
      }
    }

    const ageData = calculateEffectiveBeanAge(activeBean, mockDate);
    const recentBeanShots = shots.filter(s => s.beanId === activeBean.id);

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
        recommendationFollowed 
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
      notes: usePreInfusion && preInfusionSeconds > 0 ? `Pre-infusion: ${preInfusionSeconds}s. ${notes}` : notes
    };

    try {
      await db.shots.add(shotRecord);
      
      setActualTimeS('');
      setActualYieldG(activeRecipe?.targetYieldG || '');
      setShotRating(null);
      setNotes('');
      setTasteProfile('');
      handleResetTimer();

      setTimeout(() => {
        recommendationRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    } catch (err) {
      console.error("Database save failed:", err);
      setValidationError(`Error saving to database: ${err.message || 'Unknown IndexedDB Error.'}`);
    }
  };

  const dynamicRec = lastShot ? getAgeAdjustedRecommendation(lastShot, activeBean, mockDate) : null;

  const beanShotsForGrinder = activeBean
    ? shots.filter(s => s.beanId === activeBean.id && s.grinderModel === grinderModel)
    : [];
  const hasLoggedShotForBean = beanShots.length > 0;
  const initialGrindSetting = activeBean && grinderModel && beanShotsForGrinder.length === 0
    ? getInitialGrindRecommendation(grinderModel, activeBean.roastType, activeBean, recipes, shots, beans, mockDate)
    : null;

  const currentGrindLabel = grinderModel === 'Sette 270Wi'
    ? `${setteMacro}-${setteMicro}`
    : `${sunbeamSetting}`;

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

    if (lastShot.grinderModel === 'Sette 270Wi' && recSet.macro) {
      setGrinderModel('Sette 270Wi');
      setSetteMacro(recSet.macro);
      setSetteMicro(recSet.micro);
      await db.settings.put({ ...currentSettings, lastSetteMacro: recSet.macro, lastSetteMicro: recSet.micro });
    } else if (lastShot.grinderModel === 'Sunbeam Barista Max' && recSet.setting) {
      setGrinderModel('Sunbeam Barista Max');
      setSunbeamSetting(recSet.setting);
      await db.settings.put({ ...currentSettings, lastSunbeamSetting: recSet.setting });
    }

    if (grindSettingsRef.current) {
      grindSettingsRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightGrind(true);
      setTimeout(() => setHighlightGrind(false), 1500);
    }
  };

  const exportDataCSV = () => {
    const headers = ['Timestamp', 'Bean', 'Grinder', 'Grind Setting', 'Purged', 'Dose(g)', 'Yield(g)', 'Ratio', 'Time(s)', 'Taste', 'Rating', 'Bean Age (Days)', 'Storage', 'Rec Followed', 'Notes'];
    const rows = shots.map(s => {
      const bean = beans.find(b => b.id === s.beanId);
      const grind = s.grinderModel === 'Sette 270Wi' ? `${s.setteMacro}-${s.setteMicro}` : s.sunbeamSetting;
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
  const lastBrewDaysAgo = lastShot ? Math.max(0, Math.floor((referenceNow - new Date(lastShot.timestamp)) / (1000 * 60 * 60 * 24))) : 0;

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

  // Keep accentColor state for settings UI but treat all as amber premium
  const themes = {
    amber: {
      primary: 'bg-[#c88a4b] hover:bg-[#e0a660] text-[#121110] font-bold',
      badge: 'bg-[rgba(200,138,75,0.12)] text-[#c88a4b] border-[rgba(200,138,75,0.25)]',
      text: 'text-[#c88a4b]',
      bgWash: 'bg-[#121110] text-[#f5f2eb]',
      card: 'bg-[#1a1815] border-[#2e2b26] text-[#f5f2eb] shadow-sm',
    },
    emerald: {
      primary: 'bg-[#c88a4b] hover:bg-[#e0a660] text-[#121110] font-bold',
      badge: 'bg-[rgba(200,138,75,0.12)] text-[#c88a4b] border-[rgba(200,138,75,0.25)]',
      text: 'text-[#c88a4b]',
      bgWash: 'bg-[#121110] text-[#f5f2eb]',
      card: 'bg-[#1a1815] border-[#2e2b26] text-[#f5f2eb] shadow-sm',
    },
    indigo: {
      primary: 'bg-[#c88a4b] hover:bg-[#e0a660] text-[#121110] font-bold',
      badge: 'bg-[rgba(200,138,75,0.12)] text-[#c88a4b] border-[rgba(200,138,75,0.25)]',
      text: 'text-[#c88a4b]',
      bgWash: 'bg-[#121110] text-[#f5f2eb]',
      card: 'bg-[#1a1815] border-[#2e2b26] text-[#f5f2eb] shadow-sm',
    },
    rose: {
      primary: 'bg-[#c88a4b] hover:bg-[#e0a660] text-[#121110] font-bold',
      badge: 'bg-[rgba(200,138,75,0.12)] text-[#c88a4b] border-[rgba(200,138,75,0.25)]',
      text: 'text-[#c88a4b]',
      bgWash: 'bg-[#121110] text-[#f5f2eb]',
      card: 'bg-[#1a1815] border-[#2e2b26] text-[#f5f2eb] shadow-sm',
    },
  };

  const currentTheme = themes[accentColor] || themes.amber;
  const inputClass = 'bg-[#211e1a] border-[#2e2b26] text-[#f5f2eb] placeholder-[#6b6457] focus:border-[#c88a4b] focus:outline-none transition-colors';
  const labelClass = 'text-[#a09880] font-semibold tracking-wide';
  const subTextClass = 'text-[#a09880]';

  if (!grinderModel) {
    return (
      <div className="min-h-screen bg-[#121110] text-[#f5f2eb] flex items-center justify-center p-6">
        <div className="bg-[#1a1815] border border-[#2e2b26] p-8 rounded-2xl max-w-sm w-full space-y-8 shadow-2xl">
          <div className="flex flex-col items-center gap-4">
            <img src="/logo.jpg" alt="Espresso Dial-In" className="w-16 h-16 rounded-xl object-cover" />
            <div className="text-center">
              <h1 className="text-xl font-bold text-[#f5f2eb] tracking-tight">Espresso Dial-In</h1>
              <p className="text-xs text-[#6b6457] mt-1 tracking-wide uppercase">Precision dial-in assistant</p>
            </div>
          </div>
          <div>
            <p className="text-sm text-[#a09880] text-center mb-6">Select your grinder to configure your calibration baseline.</p>
            <div className="space-y-3">
              <button
                onClick={() => handleSaveGrinderSetup('Sette 270Wi')}
                className="w-full bg-[#c88a4b] hover:bg-[#e0a660] text-[#121110] font-bold py-4 rounded-xl text-sm transition-colors"
              >
                Baratza Sette 270Wi
              </button>
              <button
                onClick={() => handleSaveGrinderSetup('Sunbeam Barista Max')}
                className="w-full bg-[#211e1a] hover:bg-[#2e2b26] text-[#f5f2eb] font-bold py-4 rounded-xl text-sm transition-colors border border-[#2e2b26]"
              >
                Sunbeam Barista Max
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-[#121110] text-[#f5f2eb] relative`}>
      
      {/* FULL-SCREEN ACTIVE TIMER — mobile-first, tap anywhere to advance */}
      {timerRunning && (
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
        
        <header className="flex items-center justify-between pb-5 mb-6 border-b border-[#2e2b26]">
          <div className="flex items-center gap-3 cursor-pointer select-none" onClick={handleLogoClick} title="Espresso Dial-In">
            <img src="/logo.jpg" alt="Logo" className="w-8 h-8 rounded-lg object-cover" />
            <div>
              <h1 className="text-base font-bold text-[#f5f2eb] tracking-tight leading-none">Espresso Dial-In</h1>
              <p className="text-[10px] text-[#6b6457] tracking-widest uppercase mt-0.5">Precision dial-in</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="p-2 text-[#6b6457] hover:text-[#c88a4b] transition-colors"
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
              <div className="bg-[#1a1815] border border-[#2e2b26] p-10 rounded-2xl text-center space-y-4">
                <p className="text-[#6b6457] text-sm">No active coffee bean profiles.</p>
                <button onClick={() => setActiveTab('beans')} className="bg-[#c88a4b] hover:bg-[#e0a660] text-[#121110] font-bold px-6 py-3 rounded-xl text-sm transition-colors">
                  Add Your First Bean
                </button>
              </div>
            ) : (
              <>
                {/* ── BEAN ─────────────────────────────────────────────── */}
                <div className="bg-[#1a1815] border border-[#2e2b26] p-4 rounded-2xl space-y-3">
                  <div className="flex justify-between items-start gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] uppercase tracking-widest text-[#6b6457] mb-0.5">Bean</p>
                      <select
                        value={activeBean?.id || ''}
                        onChange={(e) => setSelectedBeanId(e.target.value)}
                        className="bg-transparent text-[#f5f2eb] font-bold text-sm focus:outline-none w-full truncate"
                      >
                        {activeBeansList.map(b => (
                          <option key={b.id} value={b.id} className="bg-[#1a1815]">{b.name} — {b.roaster}</option>
                        ))}
                      </select>
                      {activeBean && (
                        <p className="text-[10px] text-[#6b6457] mt-0.5">
                          {activeBean.roastType} roast · {activeBean.storageType}
                          {beanAgeInfo ? ` · ${beanAgeInfo.daysOld}d effective` : ''}
                          {lastBrewDaysAgo > 0 ? ` · last shot ${lastBrewDaysAgo}d ago` : ''}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {activeBean?.storageType === 'frozen' && (
                        <button
                          type="button"
                          onClick={handleThawNewBag}
                          className="text-[10px] bg-[#211e1a] border border-[#3d3830] px-2.5 py-1.5 rounded-lg text-[#c88a4b] font-semibold hover:border-[#c88a4b]/50 transition-colors"
                        >
                          Thaw New Bag
                        </button>
                      )}
                      {activeBean?.storageType === 'frozen' && activeBean.thawHistory?.length > 0 && (
                        <button
                          type="button"
                          onClick={handleReverseThaw}
                          className="text-[10px] bg-[#211e1a] border border-[#3d3830] px-2 py-1.5 rounded-lg text-[#a09880] hover:text-[#f5f2eb] transition-colors flex items-center gap-1"
                        >
                          <RotateCcw className="w-3 h-3" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleToggleFinished(activeBean.id, activeBean.isFinished)}
                        className="text-[10px] bg-[#211e1a] border border-[#3d3830] px-2.5 py-1.5 rounded-lg text-[#6b6457] font-semibold hover:text-[#a09880] transition-colors"
                      >
                        Mark Finished
                      </button>
                    </div>
                  </div>

                  {beanAgeInfo?.notice && (
                    <p className="text-[10px] text-[#c88a4b] bg-[rgba(200,138,75,0.08)] border border-[rgba(200,138,75,0.2)] p-2.5 rounded-lg">
                      {beanAgeInfo.notice}
                    </p>
                  )}
                </div>

                {/* ── RECIPE ───────────────────────────────────────────── */}
                {activeRecipe && (
                  <div className="bg-[#1a1815] border border-[#2e2b26] p-5 rounded-2xl space-y-4">
                    <p className="text-[10px] uppercase tracking-widest text-[#6b6457]">Recipe</p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                      <div className="bg-[#211e1a] border border-[#2e2b26] rounded-xl p-3">
                        <p className="text-[10px] text-[#6b6457] uppercase tracking-wider mb-1">Dose</p>
                        <p className="text-[#f5f2eb] font-bold text-lg">{activeRecipe.targetDoseG || 18}g</p>
                      </div>
                      <div className="bg-[#211e1a] border border-[#2e2b26] rounded-xl p-3">
                        <p className="text-[10px] text-[#6b6457] uppercase tracking-wider mb-1">Yield</p>
                        <p className="text-[#f5f2eb] font-bold text-lg">{activeRecipe.targetYieldG || 36}g</p>
                      </div>
                      <div className="bg-[#211e1a] border border-[#2e2b26] rounded-xl p-3">
                        <p className="text-[10px] text-[#6b6457] uppercase tracking-wider mb-1">Time</p>
                        <p className="text-[#f5f2eb] font-bold text-lg">{activeRecipe.targetTimeMinS || 27}–{activeRecipe.targetTimeMaxS || 32}s</p>
                      </div>
                      <div className="bg-[#211e1a] border border-[#2e2b26] rounded-xl p-3">
                        <p className="text-[10px] text-[#6b6457] uppercase tracking-wider mb-1">Temp</p>
                        <p className="text-[#f5f2eb] font-bold text-lg">{activeRecipe.brewTemperatureC ? `${activeRecipe.brewTemperatureC}°C` : '—'}</p>
                      </div>
                    </div>
                    {flairEnabled && (
                      <div className="pt-1 border-t border-[#2e2b26] space-y-3">
                        <div className="flex items-end justify-between gap-2">
                          <p className="text-[10px] text-[#6b6457] uppercase tracking-wider">Pressure profile</p>
                          <button
                            type="button"
                            onClick={() => setActiveTab('beans')}
                            className="text-[10px] text-[#c88a4b] font-semibold hover:text-[#e0a660]"
                          >
                            Edit on Beans
                          </button>
                        </div>
                        <div className="bg-[#211e1a]/80 border border-[#2e2b26] rounded-xl px-3 py-2">
                          <PressureProfileChart profile={activeRecipe.flairProfile} />
                        </div>
                        {formatFlairRecipeLines(activeRecipe.flairProfile).length > 0 ? (
                          <div className="space-y-1.5">
                            {formatFlairRecipeLines(activeRecipe.flairProfile).map((line) => (
                              <p key={line} className="text-[11px] text-[#a09880]">{line}</p>
                            ))}
                          </div>
                        ) : (
                          <p className="text-[11px] text-[#6b6457]">Add pre-infusion, hold, and taper on the Beans tab to populate this chart.</p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* ── CURRENT GRIND ────────────────────────────────────── */}
                <div className="bg-[#1a1815] border border-[#2e2b26] p-4 rounded-2xl flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-[#6b6457] mb-1">Current grind</p>
                    <p className="text-2xl font-black text-[#f5f2eb] font-mono leading-none">{currentGrindLabel}</p>
                  </div>
                  <span className="text-[10px] bg-[rgba(200,138,75,0.12)] text-[#c88a4b] border border-[rgba(200,138,75,0.25)] px-2.5 py-1 rounded-full font-semibold text-center max-w-[9rem]">
                    {grinderModel}
                  </span>
                </div>

                {/* ── LATEST SHOT ──────────────────────────────────────── */}
                {lastShot && (
                  <div className="bg-[#211e1a] border border-[#2e2b26] p-4 rounded-2xl">
                    <div className="flex justify-between items-center mb-2">
                      <p className="text-[10px] uppercase tracking-widest text-[#6b6457]">Latest shot</p>
                      <p className="text-[10px] text-[#6b6457]">
                        {new Date(lastShot.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                      <span className="font-bold text-[#f5f2eb]">{lastShot.actualTimeS || 0}s</span>
                      <span className="text-[#a09880]">·</span>
                      <span className="font-bold text-[#f5f2eb]">{lastShot.actualYieldG || 0}g</span>
                      <span className="text-[#a09880]">·</span>
                      <span className="font-semibold text-[#c88a4b] capitalize">{lastShot.tasteProfile?.replace('_', ' ') || 'no taste logged'}</span>
                    </div>
                  </div>
                )}

                {/* ── NEXT SHOT RECOMMENDATION HERO ─────────────────────── */}
                {lastShot && dynamicRec ? (
                  <div ref={recommendationRef} className="bg-[#1a1815] border-2 border-[rgba(200,138,75,0.45)] p-6 rounded-2xl space-y-5 shadow-[0_8px_32px_rgba(0,0,0,0.35)]">
                    <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-[#c88a4b]">Next shot</p>

                    <div>
                      <p className="text-2xl sm:text-3xl font-black text-[#f5f2eb] leading-tight tracking-tight uppercase">
                        {dynamicRec.originalReason?.split('—')[0]?.trim() || dynamicRec.originalReason}
                      </p>
                      {dynamicRec.originalReason?.includes('—') && (
                        <p className="text-sm text-[#a09880] mt-2">
                          {dynamicRec.originalReason.split('—').slice(1).join('—').trim()}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center justify-between bg-[#211e1a] border border-[#2e2b26] rounded-xl px-4 py-3">
                      <div>
                        <p className="text-[10px] text-[#6b6457] uppercase tracking-wider mb-0.5">Set grinder to</p>
                        <p className="text-3xl font-black text-[#f5f2eb] font-mono">
                          {lastShot.grinderModel === 'Sette 270Wi'
                            ? `${dynamicRec.recommendedSetting?.macro || 13}-${dynamicRec.recommendedSetting?.micro || 'E'}`
                            : `${dynamicRec.recommendedSetting?.setting || 15}`}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={applyRecommendation}
                        className="text-xs bg-[#c88a4b] hover:bg-[#e0a660] text-[#121110] font-bold px-4 py-2.5 rounded-lg flex items-center gap-1 transition-colors min-h-[44px]"
                      >
                        Apply <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>

                    {dynamicRec.ageWarning && (
                      <div className="flex items-start gap-2 bg-[rgba(200,138,75,0.06)] border border-[rgba(200,138,75,0.2)] p-3 rounded-xl text-xs text-[#c88a4b]">
                        <Flame className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span>{dynamicRec.ageWarning}</span>
                      </div>
                    )}
                    {dynamicRec.warning && (
                      <div className="flex items-start gap-2 bg-[rgba(180,60,60,0.08)] border border-[rgba(180,60,60,0.2)] p-3 rounded-xl text-xs text-[#d08080]">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span>{dynamicRec.warning}</span>
                      </div>
                    )}

                    {dynamicRec.flairWaterTempAdvice && (
                      <div className="border-t border-[#2e2b26] pt-3 space-y-1">
                        <p className="text-[10px] uppercase tracking-widest text-[#6b6457] font-semibold">Temperature</p>
                        <p className="text-xs text-[#a09880]">{dynamicRec.flairWaterTempAdvice}</p>
                      </div>
                    )}

                    {dynamicRec.subRecommendation && (
                      <p className="text-xs text-[#a09880] bg-[#211e1a] border border-[#2e2b26] p-3 rounded-xl">
                        {dynamicRec.subRecommendation}
                      </p>
                    )}
                  </div>
                ) : (
                  !hasLoggedShotForBean && initialGrindSetting && (
                    <div ref={recommendationRef} className="bg-[#1a1815] border-2 border-[rgba(200,138,75,0.35)] p-5 rounded-2xl space-y-3">
                      <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-[#c88a4b]">Next shot</p>
                      <p className="text-sm text-[#a09880]">Start with your initial grind recommendation</p>
                      <p className="text-2xl font-black text-[#f5f2eb] font-mono">
                        {grinderModel === 'Sette 270Wi'
                          ? `${initialGrindSetting.macro}-${initialGrindSetting.micro}`
                          : initialGrindSetting.setting}
                      </p>
                      <p className="text-xs text-[#6b6457]">Record your first shot to start dialling in.</p>
                    </div>
                  )
                )}

                {/* ── SHOT LOG FORM ─────────────────────────────────────── */}
                <form onSubmit={handleLogShot} className="space-y-4">

                  {validationError && (
                    <div className="bg-[rgba(180,60,60,0.12)] border border-[rgba(180,60,60,0.3)] p-3 rounded-xl text-xs text-[#d08080] font-semibold flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>{validationError}</span>
                    </div>
                  )}

                  <div className="bg-[#1a1815] border border-[#2e2b26] p-5 rounded-2xl space-y-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-[10px] uppercase tracking-widest text-[#6b6457] mb-2">Shot timer</p>
                        <span className="text-4xl font-black font-mono text-[#f5f2eb] tabular-nums">{formatTime(timerSeconds)}</span>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button type="button" onClick={handleStartTimer} className="px-6 py-3.5 min-h-[48px] bg-[#c88a4b] hover:bg-[#e0a660] text-[#121110] rounded-xl font-bold flex items-center gap-2 transition-colors">
                          <Play className="w-4 h-4 fill-current" /> Start
                        </button>
                        <button type="button" onClick={handleResetTimer} className="p-3.5 min-h-[48px] min-w-[48px] bg-[#211e1a] border border-[#2e2b26] text-[#a09880] rounded-xl hover:text-[#f5f2eb] transition-colors">
                          <RotateCcw className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <p className="text-[10px] text-[#6b6457]">Fullscreen timer: tap anywhere to end pre-infusion, then tap again to stop.</p>
                  </div>

                  {/* Grind setting */}
                  <div ref={grindSettingsRef} className={`bg-[#1a1815] border border-[#2e2b26] p-4 rounded-2xl transition-all duration-300 ${highlightGrind ? 'ring-2 ring-[#c88a4b] border-[#c88a4b]/60' : ''}`}>
                    <div className="flex justify-between items-center mb-3">
                      <p className="text-[10px] uppercase tracking-widest text-[#6b6457]">Grind Setting Used</p>
                      <span className="text-[10px] text-[#c88a4b] font-semibold">{grinderModel}</span>
                    </div>

                    {grinderModel === 'Sette 270Wi' ? (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs text-[#6b6457] block mb-1.5">Macro (1–31)</label>
                          <input
                            type="number"
                            min="1" max="31"
                            value={setteMacro}
                            onChange={(e) => setSetteMacro(e.target.value)}
                            className="w-full bg-[#211e1a] border border-[#2e2b26] text-[#f5f2eb] rounded-xl p-3 text-center text-2xl font-black focus:border-[#c88a4b] focus:outline-none transition-colors"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-[#6b6457] block mb-1.5">Micro (A–I)</label>
                          <select
                            value={setteMicro}
                            onChange={(e) => setSetteMicro(e.target.value)}
                            className="w-full bg-[#211e1a] border border-[#2e2b26] text-[#f5f2eb] rounded-xl p-3 text-center text-2xl font-black focus:border-[#c88a4b] focus:outline-none transition-colors"
                          >
                            {['A','B','C','D','E','F','G','H','I'].map(m => (
                              <option key={m} value={m} className="bg-[#1a1815]">{m}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <label className="text-xs text-[#6b6457] block mb-1.5">Dial Setting (1–30)</label>
                        <input
                          type="number"
                          min="1" max="30"
                          value={sunbeamSetting}
                          onChange={(e) => setSunbeamSetting(e.target.value)}
                          className="w-full bg-[#211e1a] border border-[#2e2b26] text-[#f5f2eb] rounded-xl p-3 text-center text-2xl font-black focus:border-[#c88a4b] focus:outline-none transition-colors"
                        />
                      </div>
                    )}

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
                    <div className="bg-[#1a1815] border border-[#2e2b26] p-3 rounded-2xl">
                      <label className="text-[10px] uppercase tracking-widest text-[#6b6457] block mb-2">Dose (g)</label>
                      <input
                        type="number" step="0.1"
                        value={actualDoseG}
                        onChange={(e) => setActualDoseG(e.target.value)}
                        className="w-full bg-transparent text-[#f5f2eb] text-center text-xl font-black focus:outline-none"
                      />
                    </div>
                    <div className="bg-[#1a1815] border border-[#2e2b26] p-3 rounded-2xl" ref={yieldInputRef}>
                      <label className="text-[10px] uppercase tracking-widest text-[#6b6457] block mb-2">Yield (g) *</label>
                      <input
                        type="number" step="0.1"
                        placeholder="36"
                        value={actualYieldG}
                        onChange={(e) => setActualYieldG(e.target.value)}
                        className="w-full bg-transparent text-[#f5f2eb] placeholder-[#6b6457] text-center text-xl font-black focus:outline-none"
                      />
                      <p className="text-[9px] text-[#c88a4b] text-center mt-1">1:{brewRatio}</p>
                    </div>
                    <div className="bg-[#1a1815] border border-[#2e2b26] p-3 rounded-2xl" ref={timeInputRef}>
                      <label className="text-[10px] uppercase tracking-widest text-[#6b6457] block mb-2">Time (s) *</label>
                      <input
                        type="number"
                        placeholder="28"
                        value={actualTimeS}
                        onChange={(e) => setActualTimeS(e.target.value)}
                        className="w-full bg-transparent text-[#f5f2eb] placeholder-[#6b6457] text-center text-xl font-black focus:outline-none"
                      />
                    </div>
                  </div>

                  {flairEnabled && activeRecipe?.flairProfile && (
                    <div className="bg-[#1a1815] border border-[#2e2b26] p-5 rounded-2xl space-y-3">
                      <div className="flex justify-between items-center gap-2">
                        <p className="text-[10px] uppercase tracking-widest text-[#6b6457]">Shot target</p>
                        {activeRecipe.brewTemperatureC && (
                          <span className="text-xs font-bold text-[#f5f2eb]">{activeRecipe.brewTemperatureC}°C</span>
                        )}
                      </div>
                      <div className="bg-[#211e1a] border border-[#2e2b26] rounded-xl px-3 py-2">
                        <PressureProfileChart profile={activeRecipe.flairProfile} compact />
                      </div>
                      {formatFlairRecipeLines(activeRecipe.flairProfile).map((line) => (
                        <p key={line} className="text-[11px] text-[#a09880]">{line}</p>
                      ))}
                    </div>
                  )}

                  {/* Taste selector */}
                  <div className="bg-[#1a1815] border border-[#2e2b26] p-4 rounded-2xl space-y-3" ref={tasteInputRef}>
                    <label className="text-[10px] uppercase tracking-widest text-[#6b6457]">Extraction Taste *</label>
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
                          onClick={() => setTasteProfile(f.id)}
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
                    className="w-full bg-[#1a1815] border border-[#2e2b26] rounded-xl p-3 text-sm text-[#f5f2eb] placeholder-[#6b6457] focus:border-[#c88a4b] focus:outline-none transition-colors"
                  />

                  {/* Submit — fixed above tab bar */}
                  <div className="fixed bottom-[4.25rem] left-0 right-0 p-3 bg-[#121110]/95 border-t border-[#2e2b26] backdrop-blur z-40">
                    <div className="max-w-xl mx-auto">
                      <button
                        type="submit"
                        className="w-full bg-[#c88a4b] hover:bg-[#e0a660] text-[#121110] font-black py-4 rounded-xl shadow-lg transition-colors text-sm tracking-wide"
                      >
                        Log Shot
                      </button>
                    </div>
                  </div>
                </form>
              </>
            )}
          </div>
        )}

        {activeTab === 'beans' && (
          <div className="space-y-6">
            <form onSubmit={handleSaveBean} className={`${currentTheme.card} p-5 rounded-2xl border space-y-4 relative overflow-hidden`}>
              {isEditingBean && (
                <div className="absolute top-0 left-0 right-0 bg-[#c88a4b] text-[#121110] text-[10px] font-black uppercase text-center py-1">
                  Editing Mode Active
                </div>
              )}
              
              <div className="flex justify-between items-center mb-2 pt-2">
                <h2 className="text-base font-bold">{isEditingBean ? 'Edit Coffee Profile' : 'Configure New Coffee Profile'}</h2>
                {isEditingBean && (
                  <button type="button" onClick={cancelEditBean} className="text-xs text-slate-400 hover:text-white font-bold underline">
                    Cancel
                  </button>
                )}
              </div>
              
              <div>
                <label className={`text-xs uppercase font-bold ${labelClass} block mb-1`}>Bean Name</label>
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

              {newBean.storageType === 'frozen' && (
                <div className={`space-y-3 ${darkMode ? 'bg-slate-950 border-slate-800' : 'bg-slate-100 border-slate-300'} p-3 rounded-xl border`}>
                  <div className="flex flex-col text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className={currentTheme.text}>💡 Ideal Freezing Window:</span>
                      <strong className={darkMode ? 'text-slate-100' : 'text-slate-900'}>{getIdealFreezeWindow(newBean.roastType).label}</strong>
                    </div>
                    <span className="text-[9px] text-slate-500 italic">Thaw to room temp while still sealed to prevent condensation.</span>
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

              <div className={`border-t ${darkMode ? 'border-slate-800' : 'border-slate-200'} pt-4 mt-2`}>
                <h3 className={`text-xs uppercase font-bold ${currentTheme.text} mb-3`}>Target Recipe Profile</h3>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div>
                    <span className={`text-xs ${subTextClass}`}>Target Dose (g)</span>
                    <input
                      type="number"
                      step="0.1"
                      value={newRecipe.targetDoseG}
                      onChange={(e) => setNewRecipe({ ...newRecipe, targetDoseG: parseFloat(e.target.value) })}
                      className={`w-full ${inputClass} border rounded-lg p-2 text-sm`}
                    />
                  </div>
                  <div>
                    <span className={`text-xs ${subTextClass}`}>Target Yield (g)</span>
                    <input
                      type="number"
                      step="0.1"
                      placeholder="e.g. 36"
                      value={newRecipe.targetYieldG}
                      onChange={(e) => setNewRecipe({ ...newRecipe, targetYieldG: e.target.value })}
                      className={`w-full ${inputClass} border rounded-lg p-2 text-sm`}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div>
                    <span className={`text-xs ${subTextClass}`}>Min Time (s)</span>
                    <input
                      type="number"
                      value={newRecipe.targetTimeMinS}
                      onChange={(e) => setNewRecipe({ ...newRecipe, targetTimeMinS: parseInt(e.target.value, 10) })}
                      className={`w-full ${inputClass} border rounded-lg p-2 text-sm`}
                    />
                  </div>
                  <div>
                    <span className={`text-xs ${subTextClass}`}>Max Time (s)</span>
                    <input
                      type="number"
                      value={newRecipe.targetTimeMaxS}
                      onChange={(e) => setNewRecipe({ ...newRecipe, targetTimeMaxS: parseInt(e.target.value, 10) })}
                      className={`w-full ${inputClass} border rounded-lg p-2 text-sm`}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className={`text-xs ${subTextClass}`}>Brew Temp (°C)</span>
                    <input
                      type="number"
                      value={newRecipe.brewTemperatureC || ''}
                      onChange={(e) => setNewRecipe({ ...newRecipe, brewTemperatureC: parseInt(e.target.value, 10) })}
                      className={`w-full ${inputClass} border rounded-lg p-2 text-sm`}
                    />
                  </div>
                </div>

                {flairEnabled && (
                  <div className={`pt-4 mt-2 border-t ${darkMode ? 'border-slate-800' : 'border-slate-200'}`}>
                    <h3 className={`text-xs uppercase font-bold ${currentTheme.text} mb-3`}>Flair Pressure Profile</h3>
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

            <div className={`${currentTheme.card} p-5 rounded-2xl border space-y-4`}>
              <div className="flex items-center justify-between cursor-pointer select-none" onClick={() => setShowPastBeans(!showPastBeans)}>
                <h3 className={`text-sm font-bold uppercase ${currentTheme.text}`}>Past Logged Beans & Profiles</h3>
                {showPastBeans ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </div>

              {showPastBeans && (
                <div className="space-y-3 pt-2 border-t border-slate-700/40">
                  <div className="flex justify-between items-center text-xs">
                    <span className={subTextClass}>Show finished bags</span>
                    <button
                      type="button"
                      onClick={() => setShowFinishedBeans(!showFinishedBeans)}
                      className={`px-2 py-1 rounded border font-semibold ${showFinishedBeans ? 'bg-amber-600 text-white border-amber-500' : 'bg-slate-800 text-slate-300 border-slate-700'}`}
                    >
                      {showFinishedBeans ? 'Hiding Finished' : 'Showing Active Only'}
                    </button>
                  </div>

                  {beans.filter(b => showFinishedBeans || !b?.isFinished).length === 0 ? (
                    <p className={`text-xs ${subTextClass}`}>No beans logged yet.</p>
                  ) : (
                    beans.filter(b => showFinishedBeans || !b?.isFinished).map(b => (
                      <div key={b.id} className={`flex items-center justify-between p-3 rounded-xl ${darkMode ? 'bg-slate-950 border-slate-800' : 'bg-slate-100 border-slate-300'} border text-xs ${b.isFinished ? 'opacity-60' : ''}`}>
                        <div className="flex items-center gap-2">
                          <button onClick={() => startEditBean(b)} className={`${currentTheme.text} hover:opacity-70 p-1 bg-amber-500/10 rounded-md`} title="Edit Bean">
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button onClick={() => handleToggleFinished(b.id, b.isFinished)} className={`p-1 rounded-md ${b.isFinished ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-400'}`} title={b.isFinished ? 'Mark Active' : 'Mark Finished'}>
                            <CheckCircle className="w-4 h-4" />
                          </button>
                          <button onClick={() => handleDeleteBean(b.id)} className="text-rose-500 hover:opacity-70 p-1 bg-rose-500/10 rounded-md" title="Delete Bean Profile">
                            <Trash2 className="w-4 h-4" />
                          </button>
                          <div>
                            <span className={`font-bold ${darkMode ? 'text-slate-100' : 'text-slate-900'} block`}>
                              {b.name} {b.isFinished && <span className="text-[9px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded ml-1">Finished</span>}
                            </span>
                            <span className={`text-[10px] ${subTextClass}`}>{b.roaster} • {b.roastType} Roast ({b.storageType})</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] uppercase font-bold text-slate-400">Rating:</span>
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
            {activeBean && (
              <div className="bg-[#211e1a] border border-[#2e2b26] p-3 rounded-xl text-xs text-[#a09880] flex justify-between gap-2">
                <span>{beanShots.length} shot{beanShots.length === 1 ? '' : 's'} on {activeBean.name}</span>
                <span className="text-[#6b6457]">{activeBeansList.length} active bean{activeBeansList.length === 1 ? '' : 's'}</span>
              </div>
            )}
            <div className={`flex justify-between items-center ${currentTheme.card} p-3 rounded-2xl border`}>
              <span className={`text-xs font-bold uppercase ${labelClass}`}>Filter History Log</span>
              <select
                value={historyFilterBeanId}
                onChange={(e) => setHistoryFilterBeanId(e.target.value)}
                className={`${inputClass} border rounded-lg px-3 py-1 text-xs ${currentTheme.text} font-semibold`}
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
                const grindStr = s.grinderModel === 'Sette 270Wi' ? `${s.setteMacro || 13}-${s.setteMicro || 'E'}` : `Dial ${s.sunbeamSetting || 15}`;
                return (
                  <div key={s.id} className={`${currentTheme.card} p-4 rounded-xl border space-y-2`}>
                    <div className="flex justify-between items-start">
                      <div>
                        <span className={`text-xs font-bold ${currentTheme.text}`}>{bean ? `${bean.name} [Rating: ${bean.rating ? Number(bean.rating).toFixed(1) : 'N/A'}]` : 'Unknown Bean'}</span>
                        <p className={`text-[10px] ${subTextClass}`}>
                          {new Date(s.timestamp).toLocaleString()} • <span className={darkMode ? 'text-slate-300' : 'text-slate-700 capitalize'}>{s.storageType || 'bag'}</span> ({s.beanAgeDays || 0}d old)
                          {s.recommendationFollowed === false && <span className="text-rose-400 font-bold ml-2">⚠️ Rec Not Followed</span>}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {s.shotRating && (
                          <div className="flex items-center text-amber-400 text-xs font-bold gap-0.5">
                            <Star className="w-3.5 h-3.5 fill-current" /> {s.shotRating}
                          </div>
                        )}
                        <button
                          onClick={() => handleDeleteShot(s.id)}
                          className="text-slate-500 hover:text-rose-400 p-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className={`grid grid-cols-4 gap-2 text-xs ${darkMode ? 'bg-slate-950 border-slate-800' : 'bg-slate-100 border-slate-300'} p-2 rounded-lg border`}>
                      <div><span className={`block text-[9px] ${subTextClass}`}>GRIND</span><strong className={darkMode ? 'text-white' : 'text-slate-900'}>{grindStr}</strong></div>
                      <div><span className={`block text-[9px] ${subTextClass}`}>DOSE/YIELD</span><strong className={darkMode ? 'text-white' : 'text-slate-900'}>{s.actualDoseG || 0}/{s.actualYieldG || 0}g</strong></div>
                      <div><span className={`block text-[9px] ${subTextClass}`}>TIME</span><strong className={darkMode ? 'text-white' : 'text-slate-900'}>{s.actualTimeS || 0}s</strong></div>
                      <div><span className={`block text-[9px] ${subTextClass}`}>TASTE</span><strong className={`${currentTheme.text} capitalize`}>{s.tasteProfile?.replace('_', ' ') || 'Unknown'}</strong></div>
                    </div>
                    {(s.flairProfile || s.brewTemperatureC) && (
                      <div className={`text-[10px] ${darkMode ? 'bg-slate-950/60 border-slate-800' : 'bg-slate-100 border-slate-300'} p-2 rounded border flex flex-wrap gap-2`}>
                        { (s.brewTemperatureC || s.flairProfile?.waterTempC) && <span>🌡️ Water: {s.brewTemperatureC || s.flairProfile.waterTempC}°C</span> }
                        { s.flairProfile && s.flairProfile.preinfusion !== undefined ? (
                          <>
                            <span>💧 Pre: {s.flairProfile.preinfusion || 'N/A'}</span>
                            <span>⚡ Ext: {s.flairProfile.extraction || 'N/A'}</span>
                            <span>📉 Ramp: {s.flairProfile.rampDown || 'N/A'}</span>
                          </>
                        ) : s.flairProfile ? (
                          <>
                            <span>💧 Pre: {s.flairProfile.preinfusionPressure || 'N/A'} bar / {s.flairProfile.preinfusionTime || 'N/A'}s</span>
                            <span>⚡ Peak: {s.flairProfile.peakPressure || 'N/A'} bar until {s.flairProfile.peakEndYield || 'N/A'}g</span>
                            <span>📉 Taper: {s.flairProfile.taperPressure || 'N/A'} bar</span>
                          </>
                        ) : null }
                      </div>
                    )}
                    {s.notes && <p className={`text-xs ${subTextClass} italic`}>"{s.notes}"</p>}
                  </div>
                );
              })
            )}
          </div>
        )}

        {activeTab === 'stats' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-base font-bold">Extraction Analytics & Statistics</h2>
              <div className={`flex ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-200 border-slate-300'} p-0.5 rounded-lg border text-[10px] font-semibold`}>
                <button onClick={() => setChartType('timeline')} className={`px-2.5 py-1 rounded-md ${chartType === 'timeline' ? `${currentTheme.primary}` : subTextClass}`}>Timeline</button>
                <button onClick={() => setChartType('scatter')} className={`px-2.5 py-1 rounded-md ${chartType === 'scatter' ? `${currentTheme.primary}` : subTextClass}`}>Dose/Time</button>
                <button onClick={() => setChartType('taste')} className={`px-2.5 py-1 rounded-md ${chartType === 'taste' ? `${currentTheme.primary}` : subTextClass}`}>Taste</button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className={`${currentTheme.card} p-4 rounded-2xl border`}>
                <span className={`text-xs ${subTextClass} block uppercase font-bold`}>Total Shots Logged</span>
                <span className={`text-2xl font-black ${darkMode ? 'text-white' : 'text-slate-900'} mt-1 block`}>{totalShots}</span>
              </div>
              <div className={`${currentTheme.card} p-4 rounded-2xl border`}>
                <span className={`text-xs ${subTextClass} block uppercase font-bold`}>Target Compliance</span>
                <span className={`text-2xl font-black ${darkMode ? 'text-white' : 'text-slate-900'} mt-1 block`}>{complianceRate}%</span>
              </div>
              <div className={`${currentTheme.card} p-4 rounded-2xl border`}>
                <span className={`text-xs ${subTextClass} block uppercase font-bold`}>Avg Extraction Time</span>
                <span className={`text-2xl font-black ${darkMode ? 'text-white' : 'text-slate-900'} mt-1 block`}>{avgExtractionTime}s</span>
              </div>
              <div className={`${currentTheme.card} p-4 rounded-2xl border`}>
                <span className={`text-xs ${subTextClass} block uppercase font-bold`}>Active Coffee Profiles</span>
                <span className={`text-2xl font-black ${darkMode ? 'text-white' : 'text-slate-900'} mt-1 block`}>{activeBeansList.length}</span>
              </div>
            </div>

            {chartType === 'timeline' && (
              <div className={`${currentTheme.card} p-5 rounded-2xl border space-y-3`}>
                <h3 className={`text-xs uppercase font-bold ${currentTheme.text}`}>Recent Extraction Timeline (Seconds)</h3>
                {shots.length < 2 ? (
                  <p className={`text-xs ${subTextClass}`}>Log at least 2 shots to view trend graph.</p>
                ) : (
                  <div className="h-36 w-full flex items-end gap-1.5 pt-6 px-2 border-b border-slate-700/40 pb-2">
                    {shots.slice(0, 15).reverse().map((s, idx) => {
                      const heightPx = Math.min(Math.max(((s.actualTimeS || 0) / 45) * 110, 15), 110);
                      const recipeForShot = recipes.find(r => r.beanId === s.beanId);
                      const minT = recipeForShot?.targetTimeMinS || 27;
                      const maxT = recipeForShot?.targetTimeMaxS || 32;
                      const isOptimal = (s.actualTimeS || 0) >= minT && (s.actualTimeS || 0) <= maxT;
                      const isFast = (s.actualTimeS || 0) < minT;
                      
                      return (
                        <div key={idx} className="flex-1 flex flex-col items-center gap-1 group">
                          <span className="text-[9px] font-mono opacity-80">{s.actualTimeS || 0}s</span>
                          <div 
                            style={{ height: `${heightPx}px` }} 
                            className={`w-full rounded-t transition-all ${isOptimal ? 'bg-emerald-500' : isFast ? 'bg-amber-500' : 'bg-rose-500'}`}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {chartType === 'scatter' && (
              <div className={`${currentTheme.card} p-5 rounded-2xl border space-y-3`}>
                <h3 className={`text-xs uppercase font-bold ${currentTheme.text}`}>Extraction Time vs Dose Distribution</h3>
                <div className="h-36 w-full flex items-end gap-2 pt-6 px-2 border-b border-slate-700/40 pb-2">
                  {shots.slice(0, 12).map((s, idx) => (
                    <div key={idx} className="flex-1 flex flex-col items-center gap-1">
                      <span className="text-[9px] font-mono">{s.actualDoseG || 0}g</span>
                      <div style={{ height: `${Math.min((s.actualTimeS || 0) * 3, 110)}px` }} className="w-full bg-indigo-500 rounded-t" />
                      <span className="text-[9px] text-slate-400">{s.actualTimeS || 0}s</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {chartType === 'taste' && (
              <div className={`${currentTheme.card} p-5 rounded-2xl border space-y-3`}>
                <h3 className={`text-xs uppercase font-bold ${currentTheme.text}`}>Taste Profile Breakdown</h3>
                <div className="space-y-2 text-xs">
                  {[
                    { label: 'Balanced / Good', count: tasteCounts.good, color: 'bg-emerald-500' },
                    { label: 'Sour / Very Sour', count: tasteCounts.sour + tasteCounts.very_sour, color: 'bg-amber-500' },
                    { label: 'Bitter / Very Bitter', count: tasteCounts.bitter + tasteCounts.very_bitter, color: 'bg-rose-500' },
                  ].map(item => {
                    const pct = totalShots > 0 ? Math.round((item.count / totalShots) * 100) : 0;
                    return (
                      <div key={item.label} className="space-y-1">
                        <div className="flex justify-between font-semibold">
                          <span className={subTextClass}>{item.label}</span>
                          <span>{item.count} shots ({pct}%)</span>
                        </div>
                        <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                          <div style={{ width: `${pct}%` }} className={`h-full ${item.color} transition-all duration-500`} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className={`${currentTheme.card} p-5 rounded-2xl border space-y-4`}>
              <div className="flex items-center justify-between">
                <h3 className={`text-xs uppercase font-bold ${currentTheme.text}`}>Bean Rating Leaderboard</h3>
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
                      <div key={b.id} className={`flex items-center justify-between p-3 rounded-xl ${darkMode ? 'bg-slate-950 border-slate-800' : 'bg-slate-100 border-slate-300'} border text-xs`}>
                        <div className="flex items-center gap-2">
                          <span className="font-black text-amber-500">#{idx + 1}</span>
                          <div>
                            <span className={`font-bold ${darkMode ? 'text-slate-100' : 'text-slate-900'} block`}>{b.name}</span>
                            <span className={`text-[10px] ${subTextClass}`}>{b.roaster} • {b.roastType} Roast</span>
                          </div>
                        </div>
                        <span className="text-sm font-black text-amber-500 bg-amber-500/10 px-2.5 py-1 rounded-lg border border-amber-500/20">
                          ⭐ {b.rating ? Number(b.rating).toFixed(1) : 'N/A'}
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        )}

        {isSettingsOpen && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
            <div className={`${currentTheme.card} border p-6 rounded-2xl max-w-sm w-full space-y-4 shadow-xl`}>
              <div className="flex items-center justify-between border-b pb-3 border-slate-700">
                <div className="flex items-center gap-2">
                  <Sliders className={`w-5 h-5 ${currentTheme.text}`} />
                  <h3 className="text-base font-bold">Preferences & Settings</h3>
                </div>
                <button onClick={() => setIsSettingsOpen(false)} className="text-slate-400 hover:text-white text-sm font-bold">✕</button>
              </div>

              <div className="space-y-4 text-xs">
                <div>
                  <label className={`block font-bold mb-1 ${labelClass}`}>Primary Grinder Setup</label>
                  <select
                    value={grinderModel}
                    onChange={(e) => handleSaveGrinderSetup(e.target.value)}
                    className={`w-full ${inputClass} border rounded-lg p-2.5 font-semibold`}
                  >
                    <option value="Sette 270Wi">Baratza Sette 270Wi</option>
                    <option value="Sunbeam Barista Max">Sunbeam Barista Max</option>
                  </select>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                  <div>
                    <span className={`font-bold block ${labelClass}`}>Enable Flair Manual Profile</span>
                    <span className="text-[10px] text-slate-400">Shows pressure profile & water temp recommendations</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={flairEnabled}
                    onChange={(e) => handleToggleFlairSetting(e.target.checked)}
                    className="w-4 h-4 accent-amber-600 rounded cursor-pointer"
                  />
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                  <div>
                    <span className={`font-bold block ${labelClass}`}>Track Pre-infusion Time</span>
                    <span className="text-[10px] text-slate-400">Subtracts pre-infusion from total extraction time</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={usePreInfusion}
                    onChange={(e) => handleTogglePreInfusion(e.target.checked)}
                    className="w-4 h-4 accent-amber-600 rounded cursor-pointer"
                  />
                </div>

                <div>
                  <label className={`block font-bold mb-1 ${labelClass}`}>Accent Color Theme</label>
                  <div className="grid grid-cols-4 gap-2">
                    {['amber', 'emerald', 'indigo', 'rose'].map(c => (
                      <button
                        key={c}
                        onClick={() => setAccentColor(c)}
                        className={`py-2 rounded-lg font-bold capitalize border ${accentColor === c ? 'border-white bg-slate-800 text-white' : 'border-slate-800 text-slate-400'}`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                  <span className={labelClass}>Interface Appearance</span>
                  <button
                    onClick={() => setDarkMode(!darkMode)}
                    className={`px-3 py-1.5 border rounded-lg flex items-center gap-1 font-bold ${darkMode ? 'bg-slate-800 text-amber-400 border-slate-700' : 'bg-slate-100 text-slate-800 border-slate-300'}`}
                  >
                    {darkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />} {darkMode ? 'Dark Mode' : 'Light Mode'}
                  </button>
                </div>

                <div className="pt-2 border-t border-slate-800">
                  <button
                    onClick={exportDataCSV}
                    className="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold py-2.5 rounded-xl flex items-center justify-center gap-2 border border-slate-700"
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

              <button
                onClick={() => setIsSettingsOpen(false)}
                className={`w-full ${currentTheme.primary} font-bold py-2.5 rounded-xl text-sm shadow mt-2`}
              >
                Save & Close
              </button>
            </div>
          </div>
        )}

        {isAdminOpen && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
            <div className={`${currentTheme.card} border p-6 rounded-2xl max-w-sm w-full space-y-4 shadow-xl`}>
              <div className="flex items-center gap-2 border-b pb-3 border-slate-700">
                <Shield className={`w-5 h-5 ${currentTheme.text}`} />
                <h3 className="text-base font-bold">Admin Panel (Testing Mode)</h3>
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
              <div className="flex items-center gap-2 text-rose-500 border-b pb-3 border-slate-700">
                <AlertTriangle className="w-5 h-5" />
                <h3 className="text-base font-bold">Confirm Factory Reset</h3>
              </div>
              <p className={`text-xs ${darkMode ? 'text-slate-300' : 'text-slate-700'} leading-relaxed font-medium`}>
                Warning: This action will permanently delete all logged shots, recipes, and coffee bean profiles. Data cannot be recovered once deleted.
              </p>
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setShowResetConfirm(false)}
                  className={`flex-1 ${darkMode ? 'bg-slate-800 text-white' : 'bg-slate-200 text-slate-800'} font-bold py-2.5 rounded-xl text-xs`}
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
            Espresso Dial-In • v3.0
          </span>
        </footer>

      </div>

      {/* Fixed bottom tab bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 bg-[#121110]/98 border-t border-[#2e2b26] backdrop-blur safe-area-pb">
        <div className="max-w-xl mx-auto flex items-stretch justify-around px-1">
          {[
            { id: 'dial', label: 'Dial', icon: Coffee, onClick: () => setActiveTab('dial') },
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
                className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 min-h-[52px] transition-colors ${
                  isActive ? 'text-[#c88a4b]' : 'text-[#6b6457] hover:text-[#a09880]'
                }`}
              >
                <Icon className={`w-5 h-5 ${isActive ? 'stroke-[2.5px]' : ''}`} />
                <span className="text-[10px] font-bold uppercase tracking-wide">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      <Analytics />
    </div>
  );
}