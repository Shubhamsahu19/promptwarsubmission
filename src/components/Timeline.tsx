'use client';

import React from 'react';
import { Lock, Unlock, CloudRain, Sun, RefreshCw } from 'lucide-react';

interface ActivityItem {
  id: string;
  poiId: string;
  sequenceOrder: number;
  plannedStartMinutes: number;
  plannedEndMinutes: number;
  isLocked: boolean;
  poi: {
    name: string;
    description: string;
    lat: number;
    lng: number;
    tags: string[];
    isOutdoor: boolean;
    dwellTimeMinutes: number;
  };
}

interface DayPlan {
  id: string;
  dayNumber: number;
  weatherSummary: {
    date: string;
    rainProbability: number;
    tempMax: number;
    tempMin: number;
    weatherCode: number;
  };
  totalDistanceMeters: number;
  activities: ActivityItem[];
}

interface TimelineProps {
  days: DayPlan[];
  activeDay: number;
  setActiveDay: (day: number) => void;
  onToggleLock: (activityId: string, currentLockState: boolean) => Promise<void>;
  onTriggerReplan: (dayNumber: number, weatherOverride?: any) => Promise<void>;
  isReplanning: boolean;
}

const formatTime = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
};

export default function Timeline({
  days,
  activeDay,
  setActiveDay,
  onToggleLock,
  onTriggerReplan,
  isReplanning,
}: TimelineProps) {
  const activePlan = days.find(d => d.dayNumber === activeDay);

  const getWeatherDescription = (code: number) => {
    if (code === 0) return 'Clear Skies';
    if (code < 3) return 'Partly Cloudy';
    if (code < 50) return 'Overcast';
    if (code < 70) return 'Drizzle / Light Rain';
    return 'Heavy Rain / Storm';
  };

  const handleSimulateDisruption = async () => {
    if (!activePlan) return;
    const extremeRainForecast = {
      ...activePlan.weatherSummary,
      rainProbability: 0.95, // 95% rain
      weatherCode: 75,       // Heavy rain code
    };
    await onTriggerReplan(activeDay, extremeRainForecast);
  };

  return (
    <div className="bg-slate-900/60 backdrop-blur-md border border-slate-800 p-6 rounded-2xl text-slate-200 shadow-xl flex flex-col h-full">
      {/* Day Tabs Selector */}
      <div className="flex space-x-1.5 border-b border-slate-800 pb-4 mb-4 overflow-x-auto">
        {days.map((day) => (
          <button
            key={day.dayNumber}
            onClick={() => setActiveDay(day.dayNumber)}
            className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
              activeDay === day.dayNumber
                ? 'bg-emerald-500 text-slate-950 font-bold shadow-md'
                : 'bg-slate-950 border border-slate-800 text-slate-400 hover:border-slate-700'
            }`}
          >
            Day {day.dayNumber}
          </button>
        ))}
      </div>

      {!activePlan ? (
        <div className="flex-1 flex items-center justify-center text-slate-500 text-sm py-12">
          No itinerary generated yet. Complete the form to start.
        </div>
      ) : (
        <div className="flex-col flex-1 space-y-4 overflow-y-auto pr-1">
          {/* Day Weather & Distance stats card */}
          <div className="bg-slate-950/80 border border-slate-800 p-4 rounded-xl flex items-center justify-between">
            <div className="flex items-center space-x-3">
              {activePlan.weatherSummary.rainProbability > 0.5 ? (
                <div className="w-10 h-10 rounded-lg bg-cyan-950/80 border border-cyan-800 flex items-center justify-center text-cyan-400">
                  <CloudRain className="w-5 h-5 animate-bounce-slow" />
                </div>
              ) : (
                <div className="w-10 h-10 rounded-lg bg-amber-950/80 border border-amber-800 flex items-center justify-center text-amber-400">
                  <Sun className="w-5 h-5 animate-pulse-slow" />
                </div>
              )}
              <div>
                <p className="text-xs text-slate-400 font-medium">
                  {getWeatherDescription(activePlan.weatherSummary.weatherCode)}
                </p>
                <p className="text-sm font-semibold">
                  {activePlan.weatherSummary.tempMin}°C - {activePlan.weatherSummary.tempMax}°C
                </p>
              </div>
            </div>
            
            <div className="text-right border-l border-slate-800 pl-4">
              <p className="text-xs text-slate-400 font-medium">Daily Travel</p>
              <p className="text-sm font-bold text-emerald-400">
                {(activePlan.totalDistanceMeters / 1000).toFixed(1)} km
              </p>
            </div>
          </div>

          {/* Activities list */}
          <div className="flex-1 space-y-6 relative before:absolute before:left-6 before:top-4 before:bottom-4 before:w-[2px] before:bg-slate-800">
            {activePlan.activities.length === 0 ? (
              <div className="text-center text-slate-500 text-sm py-8">
                No activities scheduled. Try loosening your constraints.
              </div>
            ) : (
              activePlan.activities.map((act) => (
                <div key={act.id} className="relative pl-12 group">
                  {/* Timeline bullet badge */}
                  <div className="absolute left-2.5 top-0 w-7 h-7 rounded-full bg-slate-950 border border-slate-800 flex items-center justify-center font-bold text-xs group-hover:border-emerald-500 transition-colors z-10">
                    <span className="text-emerald-400">{act.sequenceOrder}</span>
                  </div>

                  {/* Card container */}
                  <div className="bg-slate-950/50 border border-slate-800/80 p-4 rounded-xl hover:border-slate-700 transition-colors">
                    <div className="flex items-start justify-between mb-1.5">
                      <div>
                        <span className="text-xs font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                          {formatTime(act.plannedStartMinutes)} - {formatTime(act.plannedEndMinutes)}
                        </span>
                        <h3 className="font-bold text-sm text-slate-100 mt-2">{act.poi.name}</h3>
                      </div>
                      
                      {/* Lock Toggle Button */}
                      <button
                        onClick={() => onToggleLock(act.id, act.isLocked)}
                        className={`p-1.5 rounded-lg border transition-all ${
                          act.isLocked
                            ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                            : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-400'
                        }`}
                        title={act.isLocked ? 'Unlock Slot' : 'Lock to this Time Slot'}
                        aria-label={act.isLocked ? `Unlock ${act.poi.name}` : `Lock ${act.poi.name} to this time slot`}
                      >
                        {act.isLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                      </button>
                    </div>

                    <p className="text-xs text-slate-400 leading-relaxed mb-3">{act.poi.description}</p>

                    <div className="flex items-center space-x-2 text-[10px] uppercase font-semibold tracking-wider">
                      <span className={`px-2 py-0.5 rounded ${
                        act.poi.isOutdoor 
                          ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20' 
                          : 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'
                      }`}>
                        {act.poi.isOutdoor ? 'Outdoor' : 'Indoor'}
                      </span>
                      <span className="text-slate-500">•</span>
                      <span className="text-slate-450">{act.poi.dwellTimeMinutes} mins stay</span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Simulation Tools Panel */}
          <div className="border-t border-slate-800 pt-4 mt-auto">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
              Real-Time Disruption Simulators
            </h4>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleSimulateDisruption}
                disabled={isReplanning}
                className="bg-cyan-950/80 border border-cyan-800/80 hover:bg-cyan-900/80 text-cyan-300 py-3 rounded-xl text-xs font-semibold flex items-center justify-center space-x-2 transition-colors disabled:opacity-50"
              >
                {isReplanning ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CloudRain className="w-3.5 h-3.5" />
                )}
                <span>Simulate Heavy Rain</span>
              </button>
              <button
                onClick={() => onTriggerReplan(activeDay)}
                disabled={isReplanning}
                className="bg-emerald-950/80 border border-emerald-800/80 hover:bg-emerald-900/80 text-emerald-300 py-3 rounded-xl text-xs font-semibold flex items-center justify-center space-x-2 transition-colors disabled:opacity-50"
              >
                {isReplanning ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                <span>Optimize / Refresh</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
