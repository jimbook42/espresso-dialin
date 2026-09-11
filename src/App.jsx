import React, { useState } from 'react';
import { db } from './db';
import { useLiveQuery } from 'dexie-react-hooks';
import { calculateRecommendation, calculateBeanAgeFactor } from './utils/grinderLogic';
import { Coffee, Settings, History, PlusCircle, AlertTriangle, Download, Trash2 } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState('dial');

  const beans = useLiveQuery(() => db.beans.toArray(), []) || [];
  const recipes = useLiveQuery(() => db.recipes.toArray(), []) || [];
  const shots = useLiveQuery(() => db.shots.orderBy('timestamp').reverse().toArray(), []) || [];

  const [selectedBeanId, setSelectedBeanId] = useState('');
  
  const [newBean, setNewBean] = useState({ name: '', roaster: '', roastType: 'Medium', roastDate: '', factorAge: true });
  const [newRecipe, setNewRecipe] = useState({ targetDoseG: 18, targetYieldG: 36, targetTimeMinS: 27, targetTimeMaxS: 32 });

  const [grinderModel, setGrinderModel] = useState('Sette 270Wi');
  const [setteMacro, setSetteMacro] = useState(13);
  const [setteMicro, setSetteMicro] = useState('E');
  const [sunbeamSetting, setSunbeamSetting] = useState(15);
  const [wasPurged, setWasPurged] = useState(true);
  const [actualDoseG, setActualDoseG] = useState(18);
  const [actualYieldG, setActualYieldG] = useState(36);
  const [actualTimeS, setActualTimeS] = useState(28);
  const [tasteProfile, setTasteProfile] = useState('good');
  const [notes, setNotes] = useState('');

  const activeBean = beans.find(b => b.id === selectedBeanId) || beans[0];
  const activeRecipe = recipes.find(r => r.beanId === activeBean?.id);

  const handleCreateBean = async (e) => {
    e.preventDefault();
    if (!newBean.name) return;
    
    const beanId = crypto.randomUUID();
    await db.beans.add({ ...newBean, id: beanId, createdAt: new Date().toISOString() });
    await db.recipes.add({ ...newRecipe, id: crypto.randomUUID(), beanId });

    setNewBean({ name: '', roaster: '', roastType: 'Medium', roastDate: '', factorAge: true });
    setSelectedBeanId(beanId);
    setActiveTab('dial');
  };

  const handleLogShot = async (e) => {
    e.preventDefault();
    if (!activeBean || !activeRecipe) return;

    const lastShot = shots.find(s => s.beanId === activeBean.id);
    const lastShotGrind = lastShot ? {
      setteMacro: lastShot.setteMacro,
      setteMicro: lastShot.setteMicro,
      sunbeamSetting: lastShot.sunbeamSetting
    } : null;

    const rec = calculateRecommendation(
      { grinderModel, setteMacro, setteMicro, sunbeamSetting, wasPurged, actualTime: actualTimeS, tasteProfile, lastShotGrind },
      activeRecipe
    );

    const shotRecord = {
      id: crypto.randomUUID(),
      beanId: activeBean.id,
      timestamp: new Date().toISOString(),
      grinderModel,
      setteMacro: grinderModel === 'Sette 270Wi' ? parseInt(setteMacro, 10) : null,
      setteMicro: grinderModel === 'Sette 270Wi' ? setteMicro : null,
      sunbeamSetting: grinderModel === 'Sunbeam Barista Max' ? parseInt(sunbeamSetting, 10) : null,
      wasPurged,
      actualDoseG: parseFloat(actualDoseG),
      actualYieldG: parseFloat(actualYieldG),
      actualTimeS: parseInt(actualTimeS, 10),
      tasteProfile,
      recommendation: rec,
      notes
    };

    await db.shots.add(shotRecord);
    
    if (grinderModel === 'Sette 270Wi' && rec.recommendedSetting.macro) {
      setSetteMacro(rec.recommendedSetting.macro);
      setSetteMicro(rec.recommendedSetting.micro);
    } else if (grinderModel === 'Sunbeam Barista Max' && rec.recommendedSetting.setting) {
      setSunbeamSetting(rec.recommendedSetting.setting);
    }

    setNotes('');
  };

  const exportDataCSV = () => {
    const headers = ['Timestamp', 'Bean', 'Grinder', 'Grind Setting', 'Purged', 'Dose(g)', 'Yield(g)', 'Time(s)', 'Taste', 'Notes'];
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
        s.actualTimeS,
        s.tasteProfile,
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

  const ageInfo = activeBean && activeBean.factorAge ? calculateBeanAgeFactor(activeBean.roastDate, activeBean.roastType) : null;

  return (
    <div className="max-w-xl mx-auto p-4 pb-20">
      <header className="flex items-center justify-between border-b border-slate-800 pb-4 mb-6">
        <div className="flex items-center space-x-2">
          <Coffee className="w-7 h-7 text-amber-500" />
          <h1 className="text-xl font-bold tracking-tight text-white">Espresso Dial-In</h1>
        </div>
        <button onClick={exportDataCSV} className="p-2 text-slate-400 hover:text-white bg-slate-800 rounded-lg flex items-center gap-1 text-xs">
          <Download className="w-4 h-4" /> CSV
        </button>
      </header>

      <div className="flex bg-slate-800 p-1 rounded-xl mb-6 text-sm font-medium">
        <button
          onClick={() => setActiveTab('dial')}
          className={`flex-1 py-2 rounded-lg flex items-center justify-center gap-2 ${activeTab === 'dial' ? 'bg-amber-600 text-white' : 'text-slate-400'}`}
        >
          <Coffee className="w-4 h-4" /> Dial
        </button>
        <button
          onClick={() => setActiveTab('beans')}
          className={`flex-1 py-2 rounded-lg flex items-center justify-center gap-2 ${activeTab === 'beans' ? 'bg-amber-600 text-white' : 'text-slate-400'}`}
        >
          <PlusCircle className="w-4 h-4" /> Beans
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`flex-1 py-2 rounded-lg flex items-center justify-center gap-2 ${activeTab === 'history' ? 'bg-amber-600 text-white' : 'text-slate-400'}`}
        >
          <History className="w-4 h-4" /> History
        </button>
      </div>

      {activeTab === 'dial' && (
        <div className="space-y-6">
          {beans.length === 0 ? (
            <div className="bg-slate-800 p-6 rounded-2xl text-center">
              <p className="text-slate-400 mb-4">No active coffee beans configured.</p>
              <button onClick={() => setActiveTab('beans')} className="bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-semibold">
                Add Your First Coffee Bean
              </button>
            </div>
          ) : (
            <>
              <div className="bg-slate-800/80 p-4 rounded-2xl border border-slate-700 space-y-3">
                <div className="flex justify-between items-center">
                  <label className="text-xs uppercase font-bold text-slate-400">Active Coffee</label>
                  <select
                    value={activeBean?.id || ''}
                    onChange={(e) => setSelectedBeanId(e.target.value)}
                    className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1 text-sm text-amber-400 font-semibold focus:outline-none"
                  >
                    {beans.map(b => (
                      <option key={b.id} value={b.id}>{b.name} ({b.roaster})</option>
                    ))}
                  </select>
                </div>

                {activeRecipe && (
                  <div className="text-xs text-slate-400 flex justify-between border-t border-slate-700/50 pt-2">
                    <span>Target Dose: <strong className="text-slate-200">{activeRecipe.targetDoseG}g</strong></span>
                    <span>Target Yield: <strong className="text-slate-200">{activeRecipe.targetYieldG}g</strong></span>
                    <span>Target Time: <strong className="text-slate-200">{activeRecipe.targetTimeMinS}-{activeRecipe.targetTimeMaxS}s</strong></span>
                  </div>
                )}

                {ageInfo && ageInfo.notice && (
                  <p className="text-xs text-amber-400/90 bg-amber-950/30 p-2 rounded-lg border border-amber-800/30">
                    {ageInfo.notice}
                  </p>
                )}
              </div>

              <form onSubmit={handleLogShot} className="space-y-4">
                <div className="grid grid-cols-2 gap-2 bg-slate-800 p-1 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setGrinderModel('Sette 270Wi')}
                    className={`py-2 text-xs font-semibold rounded-lg ${grinderModel === 'Sette 270Wi' ? 'bg-slate-700 text-white' : 'text-slate-400'}`}
                  >
                    Baratza Sette 270Wi
                  </button>
                  <button
                    type="button"
                    onClick={() => setGrinderModel('Sunbeam Barista Max')}
                    className={`py-2 text-xs font-semibold rounded-lg ${grinderModel === 'Sunbeam Barista Max' ? 'bg-slate-700 text-white' : 'text-slate-400'}`}
                  >
                    Sunbeam Barista Max
                  </button>
                </div>

                <div className="bg-slate-800 p-4 rounded-2xl border border-slate-700">
                  <label className="text-xs uppercase font-bold text-slate-400 block mb-2">Grind Setting Used</label>
                  {grinderModel === 'Sette 270Wi' ? (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <span className="text-xs text-slate-400">Macro (1-31)</span>
                        <input
                          type="number"
                          min="1"
                          max="31"
                          value={setteMacro}
                          onChange={(e) => setSetteMacro(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-center text-lg font-bold text-white mt-1"
                        />
                      </div>
                      <div>
                        <span className="text-xs text-slate-400">Micro (A-I)</span>
                        <select
                          value={setteMicro}
                          onChange={(e) => setSetteMicro(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-center text-lg font-bold text-white mt-1"
                        >
                          {['A','B','C','D','E','F','G','H','I'].map(m => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <span className="text-xs text-slate-400">Linear Dial Setting (1-30)</span>
                      <input
                        type="number"
                        min="1"
                        max="30"
                        value={sunbeamSetting}
                        onChange={(e) => setSunbeamSetting(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-center text-lg font-bold text-white mt-1"
                      />
                    </div>
                  )}

                  <div className="mt-4 flex items-center justify-between border-t border-slate-700/50 pt-3">
                    <span className="text-sm font-medium text-slate-300">Was grinder purged before shot?</span>
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
                  <div className="bg-slate-800 p-3 rounded-2xl border border-slate-700">
                    <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Dose (g)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={actualDoseG}
                      onChange={(e) => setActualDoseG(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-center text-md font-bold text-white"
                    />
                  </div>
                  <div className="bg-slate-800 p-3 rounded-2xl border border-slate-700">
                    <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Yield (g)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={actualYieldG}
                      onChange={(e) => setActualYieldG(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-center text-md font-bold text-white"
                    />
                  </div>
                  <div className="bg-slate-800 p-3 rounded-2xl border border-slate-700">
                    <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Time (s)</label>
                    <input
                      type="number"
                      value={actualTimeS}
                      onChange={(e) => setActualTimeS(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-center text-md font-bold text-white"
                    />
                  </div>
                </div>

                <div className="bg-slate-800 p-4 rounded-2xl border border-slate-700">
                  <label className="text-xs uppercase font-bold text-slate-400 block mb-2">Flavor Profile</label>
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
                            ? 'bg-amber-600 text-white border-amber-500'
                            : 'bg-slate-900 text-slate-400 border-slate-700 hover:border-slate-600'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                <input
                  type="text"
                  placeholder="Notes (optional, e.g. puck prep, channeling)"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3 text-sm text-white placeholder-slate-500"
                />

                <button
                  type="submit"
                  className="w-full bg-amber-600 hover:bg-amber-500 text-white font-bold py-3 rounded-xl shadow-lg transition-colors"
                >
                  Log Shot & Get Grind Adjustment
                </button>
              </form>

              {shots.length > 0 && shots[0].beanId === activeBean?.id && (
                <div className="bg-slate-800/90 border border-amber-500/40 p-4 rounded-2xl space-y-3 mt-6">
                  <div className="flex items-center justify-between border-b border-slate-700/60 pb-2">
                    <span className="text-xs font-bold uppercase text-amber-400">Target Adjustment</span>
                    <span className="text-[10px] text-slate-400">{new Date(shots[0].timestamp).toLocaleTimeString()}</span>
                  </div>

                  {shots[0].recommendation?.warning && (
                    <div className="flex items-start gap-2 bg-rose-950/40 border border-rose-800/50 p-2.5 rounded-xl text-xs text-rose-300">
                      <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
                      <span>{shots[0].recommendation.warning}</span>
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-slate-400">Next Recommended Setting:</p>
                      <p className="text-xl font-black text-white">
                        {shots[0].grinderModel === 'Sette 270Wi'
                          ? `${shots[0].recommendation.recommendedSetting.macro}-${shots[0].recommendation.recommendedSetting.micro}`
                          : `Setting ${shots[0].recommendation.recommendedSetting.setting}`}
                      </p>
                    </div>
                    <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 px-3 py-1 rounded-full text-xs font-semibold">
                      {shots[0].grinderModel}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300">{shots[0].recommendation?.reason}</p>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {activeTab === 'beans' && (
        <form onSubmit={handleCreateBean} className="space-y-4 bg-slate-800 p-5 rounded-2xl border border-slate-700">
          <h2 className="text-base font-bold text-white mb-2">Configure Bean Profile & Target Recipe</h2>
          
          <div>
            <label className="text-xs uppercase font-bold text-slate-400 block mb-1">Bean Name</label>
            <input
              type="text"
              required
              placeholder="e.g. House Espresso Blend"
              value={newBean.name}
              onChange={(e) => setNewBean({ ...newBean, name: e.target.value })}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-sm text-white"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs uppercase font-bold text-slate-400 block mb-1">Roaster</label>
              <input
                type="text"
                placeholder="e.g. Local Roaster"
                value={newBean.roaster}
                onChange={(e) => setNewBean({ ...newBean, roaster: e.target.value })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-sm text-white"
              />
            </div>
            <div>
              <label className="text-xs uppercase font-bold text-slate-400 block mb-1">Roast Type</label>
              <select
                value={newBean.roastType}
                onChange={(e) => setNewBean({ ...newBean, roastType: e.target.value })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-sm text-white"
              >
                <option value="Light">Light</option>
                <option value="Medium">Medium</option>
                <option value="Dark">Dark</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs uppercase font-bold text-slate-400 block mb-1">Roast Date</label>
            <input
              type="date"
              required
              value={newBean.roastDate}
              onChange={(e) => setNewBean({ ...newBean, roastDate: e.target.value })}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-sm text-white"
            />
          </div>

          <div className="border-t border-slate-700 pt-4 mt-2">
            <h3 className="text-xs uppercase font-bold text-amber-500 mb-3">Target Recipe Profile</h3>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <span className="text-xs text-slate-400">Target Dose (g)</span>
                <input
                  type="number"
                  step="0.1"
                  value={newRecipe.targetDoseG}
                  onChange={(e) => setNewRecipe({ ...newRecipe, targetDoseG: parseFloat(e.target.value) })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-sm text-white"
                />
              </div>
              <div>
                <span className="text-xs text-slate-400">Target Yield (g)</span>
                <input
                  type="number"
                  step="0.1"
                  value={newRecipe.targetYieldG}
                  onChange={(e) => setNewRecipe({ ...newRecipe, targetYieldG: parseFloat(e.target.value) })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-sm text-white"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-xs text-slate-400">Min Time (s)</span>
                <input
                  type="number"
                  value={newRecipe.targetTimeMinS}
                  onChange={(e) => setNewRecipe({ ...newRecipe, targetTimeMinS: parseInt(e.target.value, 10) })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-sm text-white"
                />
              </div>
              <div>
                <span className="text-xs text-slate-400">Max Time (s)</span>
                <input
                  type="number"
                  value={newRecipe.targetTimeMaxS}
                  onChange={(e) => setNewRecipe({ ...newRecipe, targetTimeMaxS: parseInt(e.target.value, 10) })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-sm text-white"
                />
              </div>
            </div>
          </div>

          <button
            type="submit"
            className="w-full bg-amber-600 hover:bg-amber-500 text-white font-bold py-3 rounded-xl shadow-lg transition-colors mt-2"
          >
            Save Coffee Profile
          </button>
        </form>
      )}

      {activeTab === 'history' && (
        <div className="space-y-3">
          <h2 className="text-base font-bold text-white mb-2">Shot History Log</h2>
          {shots.length === 0 ? (
            <p className="text-slate-500 text-sm">No shots logged yet.</p>
          ) : (
            shots.map(s => {
              const bean = beans.find(b => b.id === s.beanId);
              const grindStr = s.grinderModel === 'Sette 270Wi' ? `${s.setteMacro}-${s.setteMicro}` : `Dial ${s.sunbeamSetting}`;
              return (
                <div key={s.id} className="bg-slate-800 p-4 rounded-xl border border-slate-700/80 space-y-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="text-xs font-bold text-amber-500">{bean ? bean.name : 'Unknown Bean'}</span>
                      <p className="text-[10px] text-slate-400">{new Date(s.timestamp).toLocaleString()}</p>
                    </div>
                    <button
                      onClick={() => db.shots.delete(s.id)}
                      className="text-slate-500 hover:text-rose-400 p-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-xs bg-slate-900 p-2 rounded-lg border border-slate-700/50">
                    <div><span className="text-slate-500 block text-[9px]">GRIND</span><strong className="text-white">{grindStr}</strong></div>
                    <div><span className="text-slate-500 block text-[9px]">DOSE/YIELD</span><strong className="text-white">{s.actualDoseG}/{s.actualYieldG}g</strong></div>
                    <div><span className="text-slate-500 block text-[9px]">TIME</span><strong className="text-white">{s.actualTimeS}s</strong></div>
                    <div><span className="text-slate-500 block text-[9px]">TASTE</span><strong className="text-amber-400 capitalize">{s.tasteProfile.replace('_', ' ')}</strong></div>
                  </div>
                  {s.notes && <p className="text-xs text-slate-300 italic">"{s.notes}"</p>}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}