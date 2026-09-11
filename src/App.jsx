import React, { useState } from 'react';
import { db } from './db';
import { useLiveQuery } from 'dexie-react-hooks';
import { calculateRecommendation, calculateEffectiveBeanAge } from './utils/grinderLogic';
import { Coffee, History, PlusCircle, AlertTriangle, Download, Trash2, ArrowRight, Sun, Moon, BarChart2, Shield, Star } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState('dial');
  const [darkMode, setDarkMode] = useState(true);
  const [accentColor, setAccentColor] = useState('amber');

  // Admin Mode & Mock Date
  const [logoClickCount, setLogoClickCount] = useState(0);
  const [isAdminOpen, setIsAdminOpen] = useState(false);
  const [mockDate, setMockDate] = useState('');

  // Factory Reset Confirmation Modal
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const beans = useLiveQuery(() => db.beans.toArray(), []) || [];
  const recipes = useLiveQuery(() => db.recipes.toArray(), []) || [];
  const shots = useLiveQuery(() => db.shots.orderBy('timestamp').reverse().toArray(), []) || [];

  const [selectedBeanId, setSelectedBeanId] = useState('');
  const [historyFilterBeanId, setHistoryFilterBeanId] = useState('all');
  
  const [newBean, setNewBean] = useState({ 
    name: '', 
    roaster: '', 
    roastType: 'Medium', 
    roastDate: '', 
    storageType: 'bag', 
    freezeDate: '', 
    thawDate: '',
    rating: 8.5
  });
  
  const [newRecipe, setNewRecipe] = useState({ targetDoseG: 18, targetYieldG: 36, targetTimeMinS: 27, targetTimeMaxS: 32 });

  const [grinderModel, setGrinderModel] = useState('Sette 270Wi');
  const [setteMacro, setSetteMacro] = useState(13);
  const [setteMicro, setSetteMicro] = useState('E');
  const [sunbeamSetting, setSunbeamSetting] = useState(15);
  const [wasPurged, setWasPurged] = useState(true);
  const [actualDoseG, setActualDoseG] = useState(18);
  const [actualYieldG, setActualYieldG] = useState(36);
  const [actualTimeS, setActualTimeS] = useState('');
  const [tasteProfile, setTasteProfile] = useState('good');
  const [shotRating, setShotRating] = useState(4);
  const [notes, setNotes] = useState('');

  const [useFlair, setUseFlair] = useState(false);
  const [waterTempC, setWaterTempC] = useState(93);
  const [flairPreinfusion, setFlairPreinfusion] = useState('10s @ 1-2 bar');
  const [flairExtraction, setFlairExtraction] = useState('9 bar to 36g yield');
  const [flairRampDown, setFlairRampDown] = useState('Ramp down to 5 bar');

  const activeBean = beans.find(b => b.id === selectedBeanId) || beans[0];
  const activeRecipe = recipes.find(r => r.beanId === activeBean?.id);
  const lastShot = shots.find(s => s.beanId === activeBean?.id);

  const brewRatio = actualDoseG > 0 ? (actualYieldG / actualDoseG).toFixed(1) : '0.0';

  const handleLogoClick = () => {
    const nextCount = logoClickCount + 1;
    setLogoClickCount(nextCount);
    if (nextCount >= 5) {
      setIsAdminOpen(true);
      setLogoClickCount(0);
    }
  };

  const handleFactoryReset = async () => {
    await db.shots.clear();
    await db.recipes.clear();
    await db.beans.clear();
    setShowResetConfirm(false);
    setSelectedBeanId('');
  };

  const handleCreateBean = async (e) => {
    e.preventDefault();
    if (!newBean.name) return;
    
    const beanId = crypto.randomUUID();
    await db.beans.add({ ...newBean, id: beanId, createdAt: new Date().toISOString() });
    await db.recipes.add({ ...newRecipe, id: crypto.randomUUID(), beanId });

    setNewBean({ name: '', roaster: '', roastType: 'Medium', roastDate: '', storageType: 'bag', freezeDate: '', thawDate: '', rating: 8.5 });
    setSelectedBeanId(beanId);
    setActiveTab('dial');
  };

  const handleThawNewBag = async () => {
    if (!activeBean) return;
    const todayStr = mockDate || new Date().toISOString().slice(0, 10);
    await db.beans.update(activeBean.id, { thawDate: todayStr });
  };

  const handleLogShot = async (e) => {
    e.preventDefault();
    if (!activeBean || !activeRecipe || !actualTimeS) return;

    const lastShotGrind = lastShot ? {
      setteMacro: lastShot.setteMacro,
      setteMicro: lastShot.setteMicro,
      sunbeamSetting: lastShot.sunbeamSetting
    } : null;

    const referenceNow = mockDate ? new Date(mockDate) : new Date();
    const lastTimestamp = lastShot ? new Date(lastShot.timestamp) : referenceNow;
    const daysSinceLastShot = Math.max(0, Math.floor((referenceNow - lastTimestamp) / (1000 * 60 * 60 * 24)));
    const ageData = calculateEffectiveBeanAge(activeBean, mockDate);

    const recentBeanShots = shots.filter(s => s.beanId === activeBean.id).slice(0, 5);

    const rec = calculateRecommendation(
      { 
        grinderModel, 
        setteMacro, 
        setteMicro, 
        sunbeamSetting, 
        wasPurged, 
        actualTime: parseInt(actualTimeS, 10), 
        actualDose: parseFloat(actualDoseG), 
        actualYield: parseFloat(actualYieldG), 
        tasteProfile, 
        lastShotGrind, 
        daysSinceLastShot 
      },
      activeRecipe,
      recentBeanShots
    );

    const shotRecord = {
      id: crypto.randomUUID(),
      beanId: activeBean.id,
      timestamp: referenceNow.toISOString(),
      grinderModel,
      setteMacro: grinderModel === 'Sette 270Wi' ? parseInt(setteMacro, 10) : null,
      setteMicro: grinderModel === 'Sette 270Wi' ? setteMicro : null,
      sunbeamSetting: grinderModel === 'Sunbeam Barista Max' ? parseInt(sunbeamSetting, 10) : null,
      wasPurged,
      actualDoseG: parseFloat(actualDoseG),
      actualYieldG: parseFloat(actualYieldG),
      actualTimeS: parseInt(actualTimeS, 10),
      tasteProfile,
      shotRating,
      brewRatio: `1:${brewRatio}`,
      beanAgeDays: ageData.daysOld,
      storageType: activeBean.storageType || 'bag',
      flairProfile: useFlair ? { waterTempC, preinfusion: flairPreinfusion, extraction: flairExtraction, rampDown: flairRampDown } : null,
      recommendation: rec,
      notes
    };

    await db.shots.add(shotRecord);
    
    setActualTimeS('');
    setActualYieldG(activeRecipe.targetYieldG);
    setActualDoseG(activeRecipe.targetDoseG);
    setNotes('');
  };

  const applyRecommendation = () => {
    if (!lastShot || !lastShot.recommendation) return;
    const recSet = lastShot.recommendation.recommendedSetting;
    if (lastShot.grinderModel === 'Sette 270Wi' && recSet.macro) {
      setGrinderModel('Sette 270Wi');
      setSetteMacro(recSet.macro);
      setSetteMicro(recSet.micro);
    } else if (lastShot.grinderModel === 'Sunbeam Barista Max' && recSet.setting) {
      setGrinderModel('Sunbeam Barista Max');
      setSunbeamSetting(recSet.setting);
    }
  };

  const exportDataCSV = () => {
    const headers = ['Timestamp', 'Bean', 'Grinder', 'Grind Setting', 'Purged', 'Dose(g)', 'Yield(g)', 'Ratio', 'Time(s)', 'Taste', 'Rating', 'Bean Age (Days)', 'Storage', 'Notes'];
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

  const themes = {
    amber: {
      primary: 'bg-amber-600 hover:bg-amber-500 text-white font-semibold',
      badge: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
      text: 'text-amber-600 dark:text-amber-400'
    },
    emerald: {
      primary: 'bg-emerald-600 hover:bg-emerald-500 text-white font-semibold',
      badge: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
      text: 'text-emerald-600 dark:text-emerald-400'
    },
    indigo: {
      primary: 'bg-indigo-600 hover:bg-indigo-500 text-white font-semibold',
      badge: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20',
      text: 'text-indigo-600 dark:text-indigo-400'
    },
    rose: {
      primary: 'bg-rose-600 hover:bg-rose-500 text-white font-semibold',
      badge: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
      text: 'text-rose-600 dark:text-rose-400'
    }
  };

  const currentTheme = themes[accentColor] || themes.amber;

  // Fully cohesive theme classes guaranteeing high contrast in both dark and light modes
  const bgClass = darkMode ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900';
  const cardClass = darkMode ? 'bg-slate-900 border-slate-800 text-slate-100 shadow' : 'bg-white border-slate-300 text-slate-900 shadow-sm';
  const inputClass = darkMode ? 'bg-slate-950 border-slate-800 text-slate-100 placeholder-slate-500' : 'bg-white border-slate-300 text-slate-900 placeholder-slate-400';
  const labelClass = darkMode ? 'text-slate-300 font-semibold' : 'text-slate-700 font-bold';
  const subTextClass = darkMode ? 'text-slate-400' : 'text-slate-600';

  return (
    <div className={`min-h-screen ${bgClass} transition-colors duration-200`}>
      <div className="max-w-xl mx-auto p-4 pb-20">
        
        {/* Header */}
        <header className="flex items-center justify-between border-b border-slate-300 dark:border-slate-800 pb-4 mb-6">
          <div className="flex items-center space-x-2 cursor-pointer select-none" onClick={handleLogoClick} title="App Logo">
            <Coffee className={`w-7 h-7 ${currentTheme.text}`} />
            <h1 className="text-xl font-bold tracking-tight">Espresso Dial-In</h1>
          </div>
          <div className="flex items-center gap-2">
            <div className={`flex items-center gap-1 ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-300'} border rounded-lg p-1 shadow-sm`}>
              {['amber', 'emerald', 'indigo', 'rose'].map(c => (
                <button
                  key={c}
                  onClick={() => setAccentColor(c)}
                  className={`w-3.5 h-3.5 rounded-full ${c === 'amber' ? 'bg-amber-500' : c === 'emerald' ? 'bg-emerald-500' : c === 'indigo' ? 'bg-indigo-500' : 'bg-rose-500'} ${accentColor === c ? 'ring-2 ring-offset-2 ring-offset-slate-900 ring-white' : 'opacity-60'}`}
                />
              ))}
            </div>
            <button
              onClick={() => setDarkMode(!darkMode)}
              className={`p-2 ${subTextClass} hover:opacity-100 ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-300'} border rounded-lg shadow-sm`}
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button onClick={exportDataCSV} className={`p-2 ${subTextClass} hover:opacity-100 ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-300'} border rounded-lg flex items-center gap-1 text-xs font-medium shadow-sm`}>
              <Download className="w-4 h-4" /> CSV
            </button>
          </div>
        </header>

        {/* Navigation Tabs */}
        <div className={`flex ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-200 border-slate-300'} p-1 rounded-xl mb-6 text-sm font-medium border shadow-sm`}>
          <button
            onClick={() => setActiveTab('dial')}
            className={`flex-1 py-2 rounded-lg flex items-center justify-center gap-2 transition-all ${activeTab === 'dial' ? `${currentTheme.primary} shadow` : subTextClass}`}
          >
            <Coffee className="w-4 h-4" /> Dial
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
            onClick={() => setActiveTab('stats')}
            className={`flex-1 py-2 rounded-lg flex items-center justify-center gap-2 transition-all ${activeTab === 'stats' ? `${currentTheme.primary} shadow` : subTextClass}`}
          >
            <BarChart2 className="w-4 h-4" /> Stats
          </button>
        </div>

        {/* DIAL TAB */}
        {activeTab === 'dial' && (
          <div className="space-y-6">
            {beans.length === 0 ? (
              <div className={`${cardClass} p-8 rounded-2xl text-center border`}>
                <p className={`${subTextClass} mb-4`}>No active coffee bean profiles configured in the system.</p>
                <button onClick={() => setActiveTab('beans')} className={`${currentTheme.primary} px-4 py-2.5 rounded-xl text-sm font-semibold shadow`}>
                  Add Your First Coffee Bean
                </button>
              </div>
            ) : (
              <>
                <div className={`${cardClass} p-4 rounded-2xl border space-y-3`}>
                  <div className="flex justify-between items-center">
                    <label className={`text-xs uppercase font-bold ${labelClass}`}>Active Coffee Profile</label>
                    <div className="flex items-center gap-2">
                      {activeBean?.storageType === 'frozen' && (
                        <button
                          type="button"
                          onClick={handleThawNewBag}
                          className={`text-[10px] ${darkMode ? 'bg-slate-950 border-slate-800' : 'bg-slate-100 border-slate-300'} border px-2.5 py-1 rounded-lg ${currentTheme.text} font-bold hover:opacity-80`}
                        >
                          Thaw New Bag Today
                        </button>
                      )}
                      <select
                        value={activeBean?.id || ''}
                        onChange={(e) => setSelectedBeanId(e.target.value)}
                        className={`${inputClass} border rounded-lg px-3 py-1.5 text-sm ${currentTheme.text} font-semibold focus:outline-none`}
                      >
                        {beans.map(b => (
                          <option key={b.id} value={b.id}>{b.name} ({b.roaster}) [Rating: {b.rating || 'N/A'}]</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {activeRecipe && (
                    <div className={`text-xs ${subTextClass} flex justify-between border-t ${darkMode ? 'border-slate-800' : 'border-slate-200'} pt-2`}>
                      <span>Target Dose: <strong className={darkMode ? 'text-slate-100' : 'text-slate-900'}>{activeRecipe.targetDoseG}g</strong></span>
                      <span>Target Yield: <strong className={darkMode ? 'text-slate-100' : 'text-slate-900'}>{activeRecipe.targetYieldG}g</strong></span>
                      <span>Target Time: <strong className={darkMode ? 'text-slate-100' : 'text-slate-900'}>{activeRecipe.targetTimeMinS}-{activeRecipe.targetTimeMaxS}s</strong></span>
                    </div>
                  )}

                  {beanAgeInfo && beanAgeInfo.notice && (
                    <p className={`text-xs ${currentTheme.text} ${darkMode ? 'bg-amber-950/20 border-amber-800/30' : 'bg-amber-50 border-amber-200'} p-2 rounded-lg border font-medium`}>
                      {beanAgeInfo.notice}
                    </p>
                  )}
                </div>

                {lastShot && (
                  <div className={`${cardClass} border p-3.5 rounded-2xl flex items-center justify-between text-xs`}>
                    <div>
                      <span className={`${subTextClass} block font-semibold uppercase text-[10px]`}>Last Shot Summary ({new Date(lastShot.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})})</span>
                      <span className={darkMode ? 'text-slate-200' : 'text-slate-800'}>
                        Grind: {lastShot.grinderModel === 'Sette 270Wi' ? `${lastShot.setteMacro}-${lastShot.setteMicro}` : lastShot.sunbeamSetting} | Time: {lastShot.actualTimeS}s | Ratio: {lastShot.brewRatio || 'N/A'} | Taste: <strong className={`${currentTheme.text} capitalize`}>{lastShot.tasteProfile?.replace('_', ' ')}</strong>
                      </span>
                    </div>
                    {lastShot.recommendation?.recommendedSetting && (
                      <button
                        type="button"
                        onClick={applyRecommendation}
                        className={`${currentTheme.primary} px-3 py-2 rounded-xl font-bold flex items-center gap-1 shrink-0 ml-2 shadow`}
                      >
                        Apply Rec <ArrowRight className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                )}

                <form onSubmit={handleLogShot} className="space-y-4">
                  <div className={`grid grid-cols-2 gap-2 ${darkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-200 border-slate-300'} p-1 rounded-xl border`}>
                    <button
                      type="button"
                      onClick={() => setGrinderModel('Sette 270Wi')}
                      className={`py-2 text-xs font-semibold rounded-lg transition-all ${grinderModel === 'Sette 270Wi' ? `${darkMode ? 'bg-slate-800 text-white' : 'bg-white text-slate-900 shadow-sm font-bold'}` : subTextClass}`}
                    >
                      Baratza Sette 270Wi
                    </button>
                    <button
                      type="button"
                      onClick={() => setGrinderModel('Sunbeam Barista Max')}
                      className={`py-2 text-xs font-semibold rounded-lg transition-all ${grinderModel === 'Sunbeam Barista Max' ? `${darkMode ? 'bg-slate-800 text-white' : 'bg-white text-slate-900 shadow-sm font-bold'}` : subTextClass}`}
                    >
                      Sunbeam Barista Max
                    </button>
                  </div>

                  <div className={`${cardClass} p-4 rounded-2xl border`}>
                    <label className={`text-xs uppercase font-bold ${labelClass} block mb-2`}>Grind Setting Used</label>
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
                        {wasPurged ? 'Yes (Purged)' : 'No (Unpurged)'}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div className={`${cardClass} p-3 rounded-2xl border`}>
                      <label className={`text-[10px] uppercase font-bold ${labelClass} block mb-1`}>Dose (g)</label>
                      <input
                        type="number"
                        step="0.1"
                        value={actualDoseG}
                        onChange={(e) => setActualDoseG(e.target.value)}
                        className={`w-full ${inputClass} border rounded-lg p-2 text-center text-md font-bold`}
                      />
                    </div>
                    <div className={`${cardClass} p-3 rounded-2xl border`}>
                      <label className={`text-[10px] uppercase font-bold ${labelClass} block mb-1`}>Yield (g)</label>
                      <input
                        type="number"
                        step="0.1"
                        value={actualYieldG}
                        onChange={(e) => setActualYieldG(e.target.value)}
                        className={`w-full ${inputClass} border rounded-lg p-2 text-center text-md font-bold`}
                      />
                      <span className={`text-[9px] ${currentTheme.text} block text-center mt-1 font-semibold`}>Ratio: 1:{brewRatio}</span>
                    </div>
                    <div className={`${cardClass} p-3 rounded-2xl border`}>
                      <label className={`text-[10px] uppercase font-bold ${labelClass} block mb-1`}>Time (s)</label>
                      <input
                        type="number"
                        placeholder="e.g. 28"
                        value={actualTimeS}
                        onChange={(e) => setActualTimeS(e.target.value)}
                        className={`w-full ${inputClass} border rounded-lg p-2 text-center text-md font-bold`}
                      />
                    </div>
                  </div>

                  {/* Flair Manual Pressure Profile Toggle */}
                  <div className={`${cardClass} p-4 rounded-2xl border space-y-3`}>
                    <div className="flex items-center justify-between">
                      <span className={`text-xs uppercase font-bold ${labelClass}`}>Flair Manual Pressure Profile</span>
                      <button
                        type="button"
                        onClick={() => setUseFlair(!useFlair)}
                        className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${useFlair ? currentTheme.primary : `${darkMode ? 'bg-slate-950 border-slate-800 text-slate-400' : 'bg-slate-100 border-slate-300 text-slate-700'} border`}`}
                      >
                        {useFlair ? 'Enabled' : 'Disabled'}
                      </button>
                    </div>

                    {useFlair && (
                      <div className={`space-y-3 pt-2 border-t ${darkMode ? 'border-slate-800' : 'border-slate-200'}`}>
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

                  {/* Tasting Notes & Detailed Profile */}
                  <div className={`${cardClass} p-4 rounded-2xl border space-y-3`}>
                    <label className={`text-xs uppercase font-bold ${labelClass} block`}>Extraction Taste Profile</label>
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
                      <span className={`text-xs ${labelClass}`}>Shot Rating (1–5 Stars)</span>
                      <div className="flex gap-1">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <button
                            type="button"
                            key={star}
                            onClick={() => setShotRating(star)}
                            className={`p-1 ${star <= shotRating ? 'text-amber-400' : 'text-slate-400'}`}
                          >
                            <Star className="w-4 h-4 fill-current" />
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <input
                    type="text"
                    placeholder="Notes (optional, e.g. puck prep, channeling)"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className={`w-full ${cardClass} border rounded-xl p-3 text-sm focus:outline-none`}
                  />

                  <button
                    type="submit"
                    className={`w-full ${currentTheme.primary} font-bold py-3.5 rounded-xl shadow-lg transition-colors`}
                  >
                    Log Shot & Calculate Grind Adjustment
                  </button>
                </form>

                {shots.length > 0 && shots[0].beanId === activeBean?.id && (
                  <div className={`${cardClass} border ${darkMode ? 'border-amber-500/40' : 'border-amber-400'} p-4 rounded-2xl space-y-3 mt-6 shadow-sm`}>
                    <div className={`flex items-center justify-between border-b ${darkMode ? 'border-slate-800' : 'border-slate-200'} pb-2`}>
                      <span className={`text-xs font-bold uppercase ${currentTheme.text}`}>Grind Adjustment Recommendation</span>
                      <span className={`text-[10px] ${subTextClass}`}>{new Date(shots[0].timestamp).toLocaleTimeString()}</span>
                    </div>

                    {shots[0].recommendation?.warning && (
                      <div className="flex items-start gap-2 bg-rose-950/40 border border-rose-800/50 p-2.5 rounded-xl text-xs text-rose-300">
                        <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
                        <span>{shots[0].recommendation.warning}</span>
                      </div>
                    )}

                    <div className="flex items-center justify-between">
                      <div>
                        <p className={`text-xs ${subTextClass}`}>Next Recommended Setting:</p>
                        <p className={`text-xl font-black ${darkMode ? 'text-white' : 'text-slate-900'}`}>
                          {shots[0].grinderModel === 'Sette 270Wi'
                            ? `${shots[0].recommendation.recommendedSetting.macro}-${shots[0].recommendation.recommendedSetting.micro}`
                            : `Setting ${shots[0].recommendation.recommendedSetting.setting}`}
                        </p>
                      </div>
                      <span className={`${currentTheme.badge} border px-3 py-1 rounded-full text-xs font-semibold`}>
                        {shots[0].grinderModel}
                      </span>
                    </div>
                    <p className={`text-xs ${darkMode ? 'text-slate-200' : 'text-slate-800'} leading-relaxed font-medium`}>{shots[0].recommendation?.reason}</p>

                    {shots[0].recommendation?.subRecommendation && (
                      <p className="text-xs bg-indigo-950/30 text-indigo-300 border border-indigo-800/40 p-2.5 rounded-xl">
                        {shots[0].recommendation.subRecommendation}
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* BEANS TAB */}
        {activeTab === 'beans' && (
          <form onSubmit={handleCreateBean} className={`${cardClass} p-5 rounded-2xl border space-y-4`}>
            <h2 className="text-base font-bold mb-2">Configure Bean Profile & Numerical Rating</h2>
            
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

            <div className="grid grid-cols-3 gap-2">
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
              <div>
                <label className={`text-xs uppercase font-bold ${labelClass} block mb-1`}>Rating (1.0–10)</label>
                <input
                  type="number"
                  step="0.1"
                  min="1.0"
                  max="10.0"
                  value={newBean.rating}
                  onChange={(e) => setNewBean({ ...newBean, rating: parseFloat(e.target.value) })}
                  className={`w-full ${inputClass} border rounded-lg p-2.5 text-sm font-bold text-amber-500`}
                />
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
              <div className={`grid grid-cols-2 gap-2 ${darkMode ? 'bg-slate-950 border-slate-800' : 'bg-slate-100 border-slate-300'} p-3 rounded-xl border`}>
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
                  <label className={`text-[10px] uppercase font-bold ${labelClass} block mb-1`}>Initial Thaw Date</label>
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
                    value={newRecipe.targetYieldG}
                    onChange={(e) => setNewRecipe({ ...newRecipe, targetYieldG: parseFloat(e.target.value) })}
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
              Save Coffee Profile & Rating
            </button>
          </form>
        )}

        {/* HISTORY TAB */}
        {activeTab === 'history' && (
          <div className="space-y-4">
            <div className={`flex justify-between items-center ${cardClass} p-3 rounded-2xl border`}>
              <span className={`text-xs font-bold uppercase ${labelClass}`}>Filter History Log</span>
              <select
                value={historyFilterBeanId}
                onChange={(e) => setHistoryFilterBeanId(e.target.value)}
                className={`${inputClass} border rounded-lg px-3 py-1 text-xs ${currentTheme.text} font-semibold`}
              >
                <option value="all">All Coffees</option>
                {beans.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>

            {filteredShots.length === 0 ? (
              <p className="text-slate-500 text-sm">No shots logged yet.</p>
            ) : (
              filteredShots.map(s => {
                const bean = beans.find(b => b.id === s.beanId);
                const grindStr = s.grinderModel === 'Sette 270Wi' ? `${s.setteMacro}-${s.setteMicro}` : `Dial ${s.sunbeamSetting}`;
                return (
                  <div key={s.id} className={`${cardClass} p-4 rounded-xl border space-y-2`}>
                    <div className="flex justify-between items-start">
                      <div>
                        <span className={`text-xs font-bold ${currentTheme.text}`}>{bean ? `${bean.name} [Rating: ${bean.rating || 'N/A'}]` : 'Unknown Bean'}</span>
                        <p className={`text-[10px] ${subTextClass}`}>{new Date(s.timestamp).toLocaleString()} • <span className={darkMode ? 'text-slate-300' : 'text-slate-700 capitalize'}>{s.storageType || 'bag'}</span> ({s.beanAgeDays || 0}d old)</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {s.shotRating && (
                          <div className="flex items-center text-amber-400 text-xs font-bold gap-0.5">
                            <Star className="w-3.5 h-3.5 fill-current" /> {s.shotRating}
                          </div>
                        )}
                        <button
                          onClick={() => db.shots.delete(s.id)}
                          className="text-slate-500 hover:text-rose-400 p-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className={`grid grid-cols-4 gap-2 text-xs ${darkMode ? 'bg-slate-950 border-slate-800' : 'bg-slate-100 border-slate-300'} p-2 rounded-lg border`}>
                      <div><span className={`block text-[9px] ${subTextClass}`}>GRIND</span><strong className={darkMode ? 'text-white' : 'text-slate-900'}>{grindStr}</strong></div>
                      <div><span className={`block text-[9px] ${subTextClass}`}>DOSE/YIELD</span><strong className={darkMode ? 'text-white' : 'text-slate-900'}>{s.actualDoseG}/{s.actualYieldG}g</strong></div>
                      <div><span className={`block text-[9px] ${subTextClass}`}>TIME</span><strong className={darkMode ? 'text-white' : 'text-slate-900'}>{s.actualTimeS}s</strong></div>
                      <div><span className={`block text-[9px] ${subTextClass}`}>TASTE</span><strong className={`${currentTheme.text} capitalize`}>{s.tasteProfile?.replace('_', ' ')}</strong></div>
                    </div>
                    {s.flairProfile && (
                      <div className={`text-[10px] ${darkMode ? 'bg-slate-950/60 border-slate-800' : 'bg-slate-100 border-slate-300'} p-2 rounded border flex flex-wrap gap-2`}>
                        <span>🌡️ Water: {s.flairProfile.waterTempC}°C</span>
                        <span>💧 Pre: {s.flairProfile.preinfusion}</span>
                        <span>⚡ Ext: {s.flairProfile.extraction}</span>
                        <span>📉 Ramp: {s.flairProfile.rampDown}</span>
                      </div>
                    )}
                    {s.notes && <p className={`text-xs ${subTextClass} italic`}>"{s.notes}"</p>}
                  </div>
                );
              })
            )}

            {/* Factory Reset Trigger */}
            <div className={`pt-6 border-t ${darkMode ? 'border-slate-800' : 'border-slate-200'} mt-8`}>
              <button
                onClick={() => setShowResetConfirm(true)}
                className="w-full bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/60 font-bold py-3 rounded-xl text-xs transition-colors shadow-sm"
              >
                Perform Factory Reset (Delete All Data)
              </button>
            </div>
          </div>
        )}

        {/* STATS & ANALYTICS TAB */}
        {activeTab === 'stats' && (
          <div className="space-y-4">
            <h2 className="text-base font-bold mb-2">Extraction Analytics & Statistics</h2>
            
            <div className="grid grid-cols-2 gap-3">
              <div className={`${cardClass} p-4 rounded-2xl border`}>
                <span className={`text-xs ${subTextClass} block uppercase font-bold`}>Total Shots Logged</span>
                <span className={`text-2xl font-black ${darkMode ? 'text-white' : 'text-slate-900'} mt-1 block`}>{shots.length}</span>
              </div>
              <div className={`${cardClass} p-4 rounded-2xl border`}>
                <span className={`text-xs ${subTextClass} block uppercase font-bold`}>Active Coffee Profiles</span>
                <span className={`text-2xl font-black ${darkMode ? 'text-white' : 'text-slate-900'} mt-1 block`}>{beans.length}</span>
              </div>
            </div>

            <div className={`${cardClass} p-5 rounded-2xl border space-y-4`}>
              <h3 className={`text-xs uppercase font-bold ${currentTheme.text}`}>Bean Rating Leaderboard (Ranked)</h3>
              {beans.length === 0 ? (
                <p className={`text-xs ${subTextClass}`}>No beans configured yet.</p>
              ) : (
                <div className="space-y-2">
                  {[...beans].sort((a, b) => (b.rating || 0) - (a.rating || 0)).map((b, idx) => (
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

        {/* ADMIN MODE MODAL */}
        {isAdminOpen && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
            <div className={`${cardClass} border p-6 rounded-2xl max-w-sm w-full space-y-4 shadow-xl`}>
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

        {/* FACTORY RESET CONFIRMATION MODAL */}
        {showResetConfirm && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
            <div className={`${cardClass} border p-6 rounded-2xl max-w-sm w-full space-y-4 shadow-xl`}>
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

      </div>
    </div>
  );
}