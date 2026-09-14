import React, { useState, useEffect, useRef } from 'react';
import { db, generateId, calculateRecommendation, calculateEffectiveBeanAge, getInitialGrindRecommendation, getAgeAdjustedRecommendation, getIdealFreezeWindow } from './utils/grinderLogic';
import { useLiveQuery } from 'dexie-react-hooks';
import { History, PlusCircle, AlertTriangle, Download, Trash2, ArrowRight, Sun, Moon, BarChart2, Shield, Star, Flame, ChevronDown, ChevronUp, Settings, Sliders, Coffee, Play, RotateCcw, Edit2, X, CheckCircle } from 'lucide-react';
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

  const [showFlair, setShowFlair] = useState(false);
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
  const [timerSeconds, setTimerSeconds] = useState(0);
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
  
  const [newRecipe, setNewRecipe] = useState({ targetDoseG: 18, targetYieldG: '', targetTimeMinS: 27, targetTimeMaxS: 32 });

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

  const [waterTempC, setWaterTempC] = useState(93);
  const [flairPreinfusion, setFlairPreinfusion] = useState('10s @ 1-2 bar');
  const [flairExtraction, setFlairExtraction] = useState('9 bar to yield');
  const [flairRampDown, setFlairRampDown] = useState('Ramp down to 5 bar');

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

  // Timer Logic
  useEffect(() => {
    let interval = null;
    if (timerRunning) {
      interval = setInterval(() => {
        setTimerSeconds(s => s + 1);
      }, 1000);
    } else if (!timerRunning && timerSeconds !== 0) {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [timerRunning, timerSeconds]);

  const formatTime = (totalSeconds) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const handleStartTimer = () => {
    setTimerSeconds(0);
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
      finalExtractionTime = timerSeconds - preInfusionSeconds;
    }
    setActualTimeS(finalExtractionTime);
  };

  const handleCancelTimer = () => {
    setTimerRunning(false);
    setTimerSeconds(0);
    setPreInfusionSeconds(0);
  };

  const handleResetTimer = () => {
    setTimerRunning(false);
    setTimerSeconds(0);
    setPreInfusionSeconds(0);
    setPreInfusionPhase(false);
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
    setNewRecipe({ targetDoseG: 18, targetYieldG: '', targetTimeMinS: 27, targetTimeMaxS: 32 });
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
    const recentBeanShots = shots.filter(s => s.beanId === activeBean.id).slice(0, 5);

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
      flairProfile: flairEnabled && showFlair ? { waterTempC, preinfusion: flairPreinfusion, extraction: flairExtraction, rampDown: flairRampDown } : null,
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

  const themes = {
    amber: {
      primary: 'bg-amber-600 hover:bg-amber-500 text-white font-semibold',
      badge: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
      text: 'text-amber-600 dark:text-amber-400',
      bgWash: darkMode ? 'bg-gradient-to-br from-slate-950 via-amber-950/20 to-slate-950 text-slate-100' : 'bg-gradient-to-br from-amber-50/60 via-orange-50/30 to-slate-50 text-slate-900',
      card: darkMode ? 'bg-slate-900/90 border-amber-950/40 text-slate-100 shadow-md' : 'bg-white border-amber-200 text-slate-900 shadow-sm'
    },
    emerald: {
      primary: 'bg-emerald-600 hover:bg-emerald-500 text-white font-semibold',
      badge: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
      text: 'text-emerald-600 dark:text-emerald-400',
      bgWash: darkMode ? 'bg-gradient-to-br from-slate-950 via-emerald-950/20 to-slate-950 text-slate-100' : 'bg-gradient-to-br from-emerald-50/60 via-teal-50/30 to-slate-50 text-slate-900',
      card: darkMode ? 'bg-slate-900/90 border-emerald-950/40 text-slate-100 shadow-md' : 'bg-white border-emerald-200 text-slate-900 shadow-sm'
    },
    indigo: {
      primary: 'bg-indigo-600 hover:bg-indigo-500 text-white font-semibold',
      badge: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20',
      text: 'text-indigo-600 dark:text-indigo-400',
      bgWash: darkMode ? 'bg-gradient-to-br from-slate-950 via-indigo-950/20 to-slate-950 text-slate-100' : 'bg-gradient-to-br from-indigo-50/60 via-blue-50/30 to-slate-50 text-slate-900',
      card: darkMode ? 'bg-slate-900/90 border-indigo-950/40 text-slate-100 shadow-md' : 'bg-white border-indigo-200 text-slate-900 shadow-sm'
    },
    rose: {
      primary: 'bg-rose-600 hover:bg-rose-500 text-white font-semibold',
      badge: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
      text: 'text-rose-600 dark:text-rose-400',
      bgWash: darkMode ? 'bg-gradient-to-br from-slate-950 via-rose-950/20 to-slate-950 text-slate-100' : 'bg-gradient-to-br from-rose-50/60 via-pink-50/30 to-slate-50 text-slate-900',
      card: darkMode ? 'bg-slate-900/90 border-rose-950/40 text-slate-100 shadow-md' : 'bg-white border-rose-200 text-slate-900 shadow-sm'
    }
  };

  const currentTheme = themes[accentColor] || themes.amber;
  const inputClass = darkMode ? 'bg-slate-950 border-slate-800 text-slate-100 placeholder-slate-500' : 'bg-white border-slate-300 text-slate-900 placeholder-slate-400';
  const labelClass = darkMode ? 'text-slate-300 font-semibold' : 'text-slate-700 font-bold';
  const subTextClass = darkMode ? 'text-slate-400' : 'text-slate-600';

  if (!grinderModel) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl max-w-sm w-full space-y-6 shadow-2xl text-center">
          <div className="flex justify-center">
            <Coffee className="w-12 h-12 text-amber-500" />
          </div>
          <div>
            <h2 className="text-lg font-bold">Welcome to Espresso Dial-In</h2>
            <p className="text-xs text-slate-400 mt-1">Please select your primary espresso grinder to configure your baseline calibration logic.</p>
          </div>
          <div className="space-y-3">
            <button
              onClick={() => handleSaveGrinderSetup('Sette 270Wi')}
              className="w-full bg-amber-600 hover:bg-amber-500 text-white font-bold py-3 rounded-xl text-sm transition-colors shadow"
            >
              Baratza Sette 270Wi
            </button>
            <button
              onClick={() => handleSaveGrinderSetup('Sunbeam Barista Max')}
              className="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold py-3 rounded-xl text-sm transition-colors border border-slate-700"
            >
              Sunbeam Barista Max
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${currentTheme.bgWash} transition-colors duration-300 relative overflow-hidden`}>
      
      {/* FULL-SCREEN ACTIVE TIMER OVERLAY */}
      {timerRunning && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-950/95 backdrop-blur-md p-6 animate-in fade-in duration-200">
          <button onClick={handleCancelTimer} className="absolute top-6 right-6 p-4 text-slate-400 hover:text-white transition-colors">
            <X className="w-8 h-8" />
          </button>
          
          <div className="flex flex-col items-center justify-center mb-16 space-y-2">
            <span className="text-amber-500 font-bold tracking-[0.2em] uppercase text-sm">
              {usePreInfusion && preInfusionPhase ? 'Pre-infusing' : 'Extracting'}
            </span>
            <div className={`text-[8rem] leading-none font-black font-mono tracking-tighter ${usePreInfusion && preInfusionPhase ? 'text-indigo-400' : 'text-amber-500'}`}>
              {formatTime(timerSeconds)}
            </div>
            {usePreInfusion && !preInfusionPhase && preInfusionSeconds > 0 && (
              <p className="text-slate-400 text-xl font-medium mt-4">
                Pre-infusion logged: <span className="text-white">{preInfusionSeconds}s</span>
              </p>
            )}
          </div>
          
          <div className="w-full max-w-sm flex flex-col gap-6">
            {usePreInfusion && preInfusionPhase && (
              <button 
                onClick={handleEndPreInfusion} 
                className="w-full py-8 text-3xl font-black rounded-[2rem] bg-indigo-600 text-white shadow-[0_0_40px_rgba(79,70,229,0.4)] active:scale-95 transition-all"
              >
                End Pre-infusion
              </button>
            )}
            <button 
              onClick={handleStopTimer} 
              className={`w-full py-8 text-3xl font-black rounded-[2rem] text-white shadow-2xl active:scale-95 transition-all ${usePreInfusion && preInfusionPhase ? 'bg-rose-900/50 text-rose-300 border border-rose-800/50' : 'bg-rose-600 shadow-[0_0_40px_rgba(225,29,72,0.4)]'}`}
            >
              Stop Shot
            </button>
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

      <div className="max-w-xl mx-auto p-4 pb-28">
        
        <header className="flex items-center justify-between border-b border-slate-300 dark:border-slate-800 pb-4 mb-6">
          <div className="flex items-center space-x-3 cursor-pointer select-none group" onClick={handleLogoClick} title="App Logo">
            <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-500">
              <Coffee className="w-5 h-5" />
            </div>
            <h1 className="text-xl font-black tracking-tight text-slate-100">Espresso Dial-In</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsSettingsOpen(true)}
              className={`p-2 ${subTextClass} hover:opacity-100 ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-300'} border rounded-lg shadow-sm`}
              title="Settings"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </header>

        <div className={`flex ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-200 border-slate-300'} p-1 rounded-xl mb-6 text-sm font-medium border shadow-sm`}>
          <button
            onClick={() => setActiveTab('dial')}
            className={`flex-1 py-2 rounded-lg flex items-center justify-center gap-2 transition-all ${activeTab === 'dial' ? `${currentTheme.primary} shadow` : subTextClass}`}
          >
            Dial
          </button>
          <button
            onClick={() => setActiveTab('beans')}
            className={`flex-1 py-2 rounded-lg flex items-center justify-center gap-2 transition-all ${activeTab === 'beans' ? `${currentTheme.primary} shadow` : subTextClass}`}
          >
            <PlusCircle className="w-4 h-4" /> Beans
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`flex-1 py-2 rounded-lg flex items-center justify-center gap-2 transition-all ${activeTab === 'history' ? `${currentTheme.primary} shadow` : subTextClass}`}
          >
            <History className="w-4 h-4" /> History
          </button>
          <button
            onClick={handleStatsTabClick}
            className={`flex-1 py-2 rounded-lg flex items-center justify-center gap-2 transition-all ${activeTab === 'stats' ? `${currentTheme.primary} shadow` : subTextClass}`}
          >
            <BarChart2 className="w-4 h-4" /> Stats
          </button>
        </div>

        {activeTab === 'dial' && (
          <div className="space-y-6">
            {activeBeansList.length === 0 ? (
              <div className={`${currentTheme.card} p-8 rounded-2xl text-center border`}>
                <p className={`${subTextClass} mb-4`}>No active coffee bean profiles configured in the system.</p>
                <button onClick={() => setActiveTab('beans')} className={`${currentTheme.primary} px-4 py-2.5 rounded-xl text-sm font-semibold shadow`}>
                  Add Your First Coffee Bean
                </button>
              </div>
            ) : (
              <>
                <div className={`${currentTheme.card} p-4 rounded-2xl border space-y-3`}>
                  <div className="flex justify-between items-center flex-wrap gap-2">
                    <label className={`text-xs uppercase font-bold ${labelClass}`}>Active Coffee Profile</label>
                    <div className="flex items-center gap-2 flex-wrap">
                      {activeBean?.storageType === 'frozen' && (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={handleThawNewBag}
                            className={`text-[10px] ${darkMode ? 'bg-slate-950 border-slate-800' : 'bg-slate-100 border-slate-300'} border px-2.5 py-1 rounded-lg ${currentTheme.text} font-bold hover:opacity-80`}
                          >
                            Thaw New Bag Today
                          </button>
                          {activeBean.thawHistory && activeBean.thawHistory.length > 0 && (
                            <button
                              type="button"
                              onClick={handleReverseThaw}
                              className={`text-[10px] bg-indigo-950/30 border border-indigo-800 px-2.5 py-1 rounded-lg text-indigo-400 font-bold hover:opacity-80 flex items-center gap-1`}
                            >
                              <RotateCcw className="w-3 h-3" /> Undo Thaw
                            </button>
                          )}
                        </div>
                      )}
                      <select
                        value={activeBean?.id || ''}
                        onChange={(e) => setSelectedBeanId(e.target.value)}
                        className={`${inputClass} border rounded-lg px-3 py-1.5 text-sm ${currentTheme.text} font-semibold focus:outline-none`}
                      >
                        {activeBeansList.map(b => (
                          <option key={b.id} value={b.id}>{b.name} ({b.roaster}) [Rating: {b.rating ? Number(b.rating).toFixed(1) : 'N/A'}]</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => handleToggleFinished(activeBean.id, activeBean.isFinished)}
                        className="text-[10px] bg-slate-800 border border-slate-700 px-2.5 py-1 rounded-lg text-slate-300 font-bold hover:bg-slate-700"
                        title="Mark Bag as Finished"
                      >
                        Mark Finished
                      </button>
                    </div>
                  </div>

                  {activeRecipe && (
                    <div className={`text-xs ${subTextClass} flex justify-between border-t ${darkMode ? 'border-slate-800' : 'border-slate-200'} pt-2`}>
                      <span>Target Dose: <strong className={darkMode ? 'text-slate-100' : 'text-slate-900'}>{activeRecipe.targetDoseG || 18}g</strong></span>
                      <span>Target Yield: <strong className={darkMode ? 'text-slate-100' : 'text-slate-900'}>{activeRecipe.targetYieldG || 36}g</strong></span>
                      <span>Target Time: <strong className={darkMode ? 'text-slate-100' : 'text-slate-900'}>{activeRecipe.targetTimeMinS || 27}-{activeRecipe.targetTimeMaxS || 32}s</strong></span>
                    </div>
                  )}

                  {beanAgeInfo && beanAgeInfo.notice && (
                    <p className={`text-xs ${currentTheme.text} ${darkMode ? 'bg-amber-950/20 border-amber-800/30' : 'bg-amber-50 border-amber-200'} p-2 rounded-lg border font-medium`}>
                      {beanAgeInfo.notice}
                    </p>
                  )}
                </div>

                {lastShot && dynamicRec && (
                  <div ref={recommendationRef} className={`${currentTheme.card} border ${darkMode ? 'border-amber-500/40' : 'border-amber-400'} p-4 rounded-2xl space-y-3 shadow-sm`}>
                    <div className={`flex items-center justify-between border-b ${darkMode ? 'border-slate-800' : 'border-slate-200'} pb-2`}>
                      <span className={`text-xs font-bold uppercase ${currentTheme.text}`}>Grind Adjustment Recommendation</span>
                      <span className={`text-[10px] ${subTextClass}`}>{new Date(lastShot.timestamp).toLocaleTimeString()}</span>
                    </div>

                    {dynamicRec.ageWarning && (
                      <div className="flex items-start gap-2 bg-indigo-950/40 border border-indigo-800/50 p-2.5 rounded-xl text-xs text-indigo-300">
                        <Flame className="w-4 h-4 shrink-0 text-indigo-400" />
                        <span>{dynamicRec.ageWarning}</span>
                      </div>
                    )}

                    {dynamicRec.warning && (
                      <div className="flex items-start gap-2 bg-rose-950/40 border border-rose-800/50 p-2.5 rounded-xl text-xs text-rose-300">
                        <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
                        <span>{dynamicRec.warning}</span>
                      </div>
                    )}

                    <div className="flex items-center justify-between">
                      <div>
                        <p className={`text-xs ${subTextClass}`}>Next Recommended Setting:</p>
                        <p className={`text-xl font-black ${darkMode ? 'text-white' : 'text-slate-900'}`}>
                          {lastShot.grinderModel === 'Sette 270Wi'
                            ? `${dynamicRec.recommendedSetting?.macro || 13}-${dynamicRec.recommendedSetting?.micro || 'E'}`
                            : `Setting ${dynamicRec.recommendedSetting?.setting || 15}`}
                        </p>
                      </div>
                      <span className={`${currentTheme.badge} border px-3 py-1 rounded-full text-xs font-semibold`}>
                        {lastShot.grinderModel}
                      </span>
                    </div>
                    <p className={`text-xs ${darkMode ? 'text-slate-200' : 'text-slate-800'} leading-relaxed font-medium`}>{dynamicRec.originalReason}</p>

                    {dynamicRec.flairWaterTempAdvice && (
                      <p className="text-xs bg-cyan-950/35 text-cyan-300 border border-cyan-800/40 p-2.5 rounded-xl">
                        {dynamicRec.flairWaterTempAdvice}
                      </p>
                    )}

                    {dynamicRec.subRecommendation && (
                      <p className="text-xs bg-indigo-950/30 text-indigo-300 border border-indigo-800/40 p-2.5 rounded-xl">
                        {dynamicRec.subRecommendation}
                      </p>
                    )}

                    <div className={`pt-2 border-t ${darkMode ? 'border-slate-800' : 'border-slate-200'} flex items-center justify-between text-xs`}>
                      <span className={subTextClass}>Last Shot: {lastShot.actualTimeS || 0}s ({lastShot.tasteProfile?.replace('_', ' ') || 'unknown'})</span>
                      <button
                        type="button"
                        onClick={applyRecommendation}
                        className={`${currentTheme.primary} px-3 py-1.5 rounded-lg font-bold flex items-center gap-1 shadow`}
                      >
                        Apply Rec <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                )}

                <form onSubmit={handleLogShot} className="space-y-4">
                  {beanShots.length === 0 && (
                    <div className={`${darkMode ? 'bg-indigo-950/20 border-indigo-950/40 text-indigo-300' : 'bg-indigo-50 border-indigo-200 text-indigo-800'} p-3 rounded-xl border text-xs flex items-center gap-2`}>
                      <span>💡 Cold-start baseline auto-applied (factored in bean age and Grind History Trend).</span>
                    </div>
                  )}

                  {validationError && (
                    <div className="bg-rose-950/80 border border-rose-800 p-3 rounded-xl text-xs text-rose-300 font-semibold flex items-center gap-2 animate-bounce">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>{validationError}</span>
                    </div>
                  )}

                  {/* Inline Shot Timer (Pre-Launch View) */}
                  <div className={`${currentTheme.card} p-3 rounded-2xl border flex flex-col gap-3`}>
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col">
                        <span className={`text-[10px] uppercase font-bold ${labelClass}`}>Live Shot Timer</span>
                        <span className={`text-2xl font-mono font-black ${darkMode ? 'text-slate-100' : 'text-slate-900'}`}>
                          {formatTime(timerSeconds)}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <button type="button" onClick={handleStartTimer} className="p-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl shadow transition-colors">
                          <Play className="w-5 h-5 fill-current" />
                        </button>
                        <button type="button" onClick={handleResetTimer} className={`p-3 ${darkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-200 text-slate-700'} rounded-xl shadow-sm transition-colors hover:opacity-80`}>
                          <RotateCcw className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                  </div>

                  <div ref={grindSettingsRef} className={`${currentTheme.card} p-4 rounded-2xl border transition-all duration-300 ${highlightGrind ? 'ring-4 ring-amber-500 animate-pulse border-amber-500' : ''}`}>
                    <div className="flex justify-between items-center mb-2">
                      <label className={`text-xs uppercase font-bold ${labelClass}`}>Grind Setting Used</label>
                      <span className={`text-[10px] ${currentTheme.text} font-semibold uppercase`}>Active Grinder: {grinderModel}</span>
                    </div>

                    {grinderModel === 'Sette 270Wi' ? (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <span className={`text-xs ${subTextClass}`}>Macro (1-31)</span>
                          <input
                            type="number"
                            min="1"
                            max="31"
                            value={setteMacro}
                            onChange={(e) => setSetteMacro(e.target.value)}
                            className={`w-full ${inputClass} border rounded-lg p-2.5 text-center text-lg font-bold mt-1 focus:outline-none`}
                          />
                        </div>
                        <div>
                          <span className={`text-xs ${subTextClass}`}>Micro (A-I)</span>
                          <select
                            value={setteMicro}
                            onChange={(e) => setSetteMicro(e.target.value)}
                            className={`w-full ${inputClass} border rounded-lg p-2.5 text-center text-lg font-bold mt-1 focus:outline-none`}
                          >
                            {['A','B','C','D','E','F','G','H','I'].map(m => (
                              <option key={m} value={m}>{m}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <span className={`text-xs ${subTextClass}`}>Linear Dial Setting (1-30)</span>
                        <input
                          type="number"
                          min="1"
                          max="30"
                          value={sunbeamSetting}
                          onChange={(e) => setSunbeamSetting(e.target.value)}
                          className={`w-full ${inputClass} border rounded-lg p-2.5 text-center text-lg font-bold mt-1 focus:outline-none`}
                        />
                      </div>
                    )}

                    <div className={`mt-4 flex items-center justify-between border-t ${darkMode ? 'border-slate-800' : 'border-slate-200'} pt-3`}>
                      <span className={`text-sm font-medium ${darkMode ? 'text-slate-300' : 'text-slate-700'}`}>Was grinder purged before shot?</span>
                      <button
                        type="button"
                        onClick={() => setWasPurged(!wasPurged)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${wasPurged ? 'bg-emerald-600 text-white' : 'bg-rose-900/60 text-rose-300 border border-rose-700'}`}
                      >
                        {wasPurged ? 'Yes (Purged)' : 'No (Unpurged ⚠️)'}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div className={`${currentTheme.card} p-3 rounded-2xl border`}>
                      <label className={`text-[10px] uppercase font-bold ${labelClass} block mb-1`}>Dose (g)</label>
                      <input
                        type="number"
                        step="0.1"
                        value={actualDoseG}
                        onChange={(e) => setActualDoseG(e.target.value)}
                        className={`w-full ${inputClass} border rounded-lg p-2 text-center text-md font-bold`}
                      />
                    </div>
                    <div className={`${currentTheme.card} p-3 rounded-2xl border`} ref={yieldInputRef}>
                      <label className={`text-[10px] uppercase font-bold ${labelClass} block mb-1`}>Yield (g)*</label>
                      <input
                        type="number"
                        step="0.1"
                        placeholder="e.g. 36"
                        value={actualYieldG}
                        onChange={(e) => setActualYieldG(e.target.value)}
                        className={`w-full ${inputClass} border rounded-lg p-2 text-center text-md font-bold`}
                      />
                      <span className={`text-[9px] ${currentTheme.text} block text-center mt-1 font-semibold`}>Ratio: 1:{brewRatio}</span>
                    </div>
                    <div className={`${currentTheme.card} p-3 rounded-2xl border`} ref={timeInputRef}>
                      <label className={`text-[10px] uppercase font-bold ${labelClass} block mb-1`}>Time (s)*</label>
                      <input
                        type="number"
                        placeholder="e.g. 28"
                        value={actualTimeS}
                        onChange={(e) => setActualTimeS(e.target.value)}
                        className={`w-full ${inputClass} border rounded-lg p-2 text-center text-md font-bold`}
                      />
                    </div>
                  </div>

                  {flairEnabled && (
                    <div className={`${currentTheme.card} p-4 rounded-2xl border space-y-3`}>
                      <div className="flex items-center justify-between cursor-pointer select-none" onClick={() => setShowFlair(!showFlair)}>
                        <span className={`text-xs uppercase font-bold ${labelClass}`}>Flair Manual Pressure Profile (Optional)</span>
                        {showFlair ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </div>

                      {showFlair && (
                        <div className={`space-y-3 pt-3 border-t ${darkMode ? 'border-slate-800' : 'border-slate-200'}`}>
                          <div>
                            <label className={`text-[10px] uppercase font-bold ${labelClass} block mb-1`}>Water Temp (°C)</label>
                            <input
                              type="number"
                              value={waterTempC}
                              onChange={(e) => setWaterTempC(e.target.value)}
                              className={`w-full ${inputClass} border rounded-lg p-2 text-sm font-bold`}
                            />
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <span className={`text-[9px] ${subTextClass} block`}>Preinfusion</span>
                              <input
                                type="text"
                                value={flairPreinfusion}
                                onChange={(e) => setFlairPreinfusion(e.target.value)}
                                className={`w-full ${inputClass} border rounded-lg p-1.5 text-xs`}
                              />
                            </div>
                            <div>
                              <span className={`text-[9px] ${subTextClass} block`}>Extraction</span>
                              <input
                                type="text"
                                value={flairExtraction}
                                onChange={(e) => setFlairExtraction(e.target.value)}
                                className={`w-full ${inputClass} border rounded-lg p-1.5 text-xs`}
                              />
                            </div>
                            <div>
                              <span className={`text-[9px] ${subTextClass} block`}>Ramp Down</span>
                              <input
                                type="text"
                                value={flairRampDown}
                                onChange={(e) => setFlairRampDown(e.target.value)}
                                className={`w-full ${inputClass} border rounded-lg p-1.5 text-xs`}
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div className={`${currentTheme.card} p-4 rounded-2xl border space-y-3`} ref={tasteInputRef}>
                    <label className={`text-xs uppercase font-bold ${labelClass} block`}>Extraction Taste Profile (Required)*</label>
                    <div className="grid grid-cols-5 gap-1">
                      {[
                        { id: 'very_sour', label: 'Very Sour' },
                        { id: 'sour', label: 'Sour' },
                        { id: 'good', label: 'Balanced' },
                        { id: 'bitter', label: 'Bitter' },
                        { id: 'very_bitter', label: 'Very Bitter' }
                      ].map(f => (
                        <button
                          type="button"
                          key={f.id}
                          onClick={() => setTasteProfile(f.id)}
                          className={`py-2 text-[10px] font-bold rounded-lg border transition-all ${
                            tasteProfile === f.id
                              ? `${currentTheme.primary} border-transparent shadow`
                              : `${darkMode ? 'bg-slate-950 text-slate-300 border-slate-800' : 'bg-slate-100 text-slate-800 border-slate-300 font-medium'}`
                          }`}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>

                    <div className={`pt-2 border-t ${darkMode ? 'border-slate-800' : 'border-slate-200'} flex items-center justify-between`}>
                      <span className={`text-xs ${labelClass}`}>Shot Rating (1–5 Stars, Optional)</span>
                      <div className="flex gap-1">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <button
                            type="button"
                            key={star}
                            onClick={() => setShotRating(star)}
                            className={`p-1 ${shotRating !== null && star <= shotRating ? 'text-amber-400' : 'text-slate-400'}`}
                          >
                            <Star className="w-4 h-4 fill-current" />
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <input
                    type="text"
                    placeholder="Notes (e.g. puck prep, channeling, 130g vacuum batch)"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className={`w-full ${currentTheme.card} border rounded-xl p-3 text-sm focus:outline-none`}
                  />

                  <div className={`fixed bottom-0 left-0 right-0 p-3 ${darkMode ? 'bg-slate-950/90 border-slate-800' : 'bg-white/90 border-slate-200'} backdrop-blur border-t z-40 shadow-2xl`}>
                    <div className="max-w-xl mx-auto">
                      <button
                        type="submit"
                        className={`w-full ${currentTheme.primary} font-bold py-3.5 rounded-xl shadow-lg transition-colors`}
                      >
                        Log Shot & Calculate Grind Adjustment
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
                <div className="absolute top-0 left-0 right-0 bg-amber-500 text-amber-950 text-[10px] font-black uppercase text-center py-1">
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
                <div className="grid grid-cols-2 gap-2">
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
              <p className="text-slate-500 text-sm">No shots logged yet.</p>
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
                    {s.flairProfile && (
                      <div className={`text-[10px] ${darkMode ? 'bg-slate-950/60 border-slate-800' : 'bg-slate-100 border-slate-300'} p-2 rounded border flex flex-wrap gap-2`}>
                        <span>🌡️ Water: {s.flairProfile.waterTempC || 93}°C</span>
                        <span>💧 Pre: {s.flairProfile.preinfusion || 'N/A'}</span>
                        <span>⚡ Ext: {s.flairProfile.extraction || 'N/A'}</span>
                        <span>📉 Ramp: {s.flairProfile.rampDown || 'N/A'}</span>
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
      <Analytics />
    </div>
  );
}