'use client';

import React, { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import TripForm from '@/components/TripForm';
import Timeline from '@/components/Timeline';
import { Compass, RefreshCw, AlertTriangle, ArrowLeft, Share2, Sparkles } from 'lucide-react';
import confetti from 'canvas-confetti';

// Import TripMap dynamically to prevent window is not defined errors on Next.js SSR build compilation
const TripMap = dynamic(() => import('@/components/TripMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full min-h-[350px] bg-slate-950/80 rounded-2xl flex items-center justify-center border border-slate-800">
      <div className="flex flex-col items-center space-y-3">
        <RefreshCw className="w-8 h-8 text-emerald-400 animate-spin" />
        <span className="text-xs text-slate-400">Loading Leaflet Engine...</span>
      </div>
    </div>
  ),
});

export default function Dashboard() {
  const [tripId, setTripId] = useState<string | null>(null);
  const [tripPlan, setTripPlan] = useState<any>(null);
  const [activeDay, setActiveDay] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [isReplanning, setIsReplanning] = useState(false);
  const [showShareNotification, setShowShareNotification] = useState(false);

  // Fetch the full plan from database
  const loadPlan = async (id: string) => {
    try {
      const res = await fetch(`/api/trip/${id}/plan`);
      if (!res.ok) throw new Error('Failed to load trip plan');
      const data = await res.json();
      setTripPlan(data);
    } catch (err) {
      console.error(err);
    }
  };

  // Create new trip
  const handleCreateTrip = async (formData: any) => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/trip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!res.ok) {
        throw new Error('Failed to generate trip plan');
      }

      const data = await res.json();
      setTripId(data.tripId);
      await loadPlan(data.tripId);
      setActiveDay(1);
      
      // Trigger confetti on successful trip generation
      confetti({
        particleCount: 80,
        spread: 60,
        origin: { y: 0.8 },
        colors: ['#10b981', '#06b6d4', '#6366f1'],
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error creating trip');
    } finally {
      setIsLoading(false);
    }
  };

  // Toggle activity lock
  const handleToggleLock = async (activityId: string, currentLockState: boolean) => {
    if (!tripId) return;
    try {
      const res = await fetch(`/api/trip/${tripId}/lock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dayPlanActivityId: activityId,
          isLocked: !currentLockState,
        }),
      });

      if (res.ok) {
        await loadPlan(tripId);
      }
    } catch (err) {
      console.error('Error locking slot:', err);
    }
  };

  // Trigger Re-planning
  const handleTriggerReplan = async (dayNum: number, weatherOverride?: any) => {
    if (!tripId) return;
    setIsReplanning(true);
    try {
      const res = await fetch(`/api/trip/${tripId}/replan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dayNumber: dayNum,
          weatherOverride: weatherOverride || null,
        }),
      });

      if (!res.ok) throw new Error('Re-planning failed');
      
      await loadPlan(tripId);

      if (weatherOverride) {
        // Success animation when weather disruption is mitigated
        confetti({
          particleCount: 50,
          angle: 60,
          spread: 55,
          origin: { x: 0 },
          colors: ['#06b6d4', '#10b981'],
        });
        confetti({
          particleCount: 50,
          angle: 120,
          spread: 55,
          origin: { x: 1 },
          colors: ['#06b6d4', '#10b981'],
        });
      }
    } catch (err) {
      console.error(err);
      alert('Failed to re-plan day. Please check constraints.');
    } finally {
      setIsReplanning(false);
    }
  };

  // Copy share link
  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href + `?trip=${tripId}`);
    setShowShareNotification(true);
    setTimeout(() => setShowShareNotification(false), 3000);
  };

  // Reset to form view
  const handleReset = () => {
    setTripId(null);
    setTripPlan(null);
  };

  // Extract active day's activities for map display
  const activeDayPlan = tripPlan?.days?.find((d: any) => d.dayNumber === activeDay);
  const activeActivities = activeDayPlan?.activities || [];
  
  // Center map on destination centroid or first activity coordinates
  const mapCenter: [number, number] = activeActivities.length > 0 
    ? [activeActivities[0].poi.lat, activeActivities[0].poi.lng]
    : tripPlan?.trip?.lat && tripPlan?.trip?.lng 
      ? [tripPlan.trip.lat, tripPlan.trip.lng]
      : [48.8566, 2.3522]; // Default Paris

  return (
    <main className="min-h-screen bg-slate-950 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-black text-slate-100 flex flex-col">
      {/* Top Navigation Header */}
      <header className="border-b border-slate-900 bg-slate-950/80 backdrop-blur-md px-6 py-4 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-cyan-500 flex items-center justify-center text-slate-950 shadow-md shadow-emerald-500/20">
            <Compass className="w-5.5 h-5.5 animate-spin-slow" />
          </div>
          <div>
            <h1 className="font-extrabold text-lg tracking-tight bg-gradient-to-r from-slate-100 to-slate-400 bg-clip-text text-transparent flex items-center">
              Aether Travel Engine
            </h1>
            <p className="text-[10px] text-emerald-400 uppercase tracking-widest font-semibold">
              Real-time Experience Planner
            </p>
          </div>
        </div>

        {tripId && (
          <div className="flex items-center space-x-3">
            <button
              onClick={handleShare}
              className="bg-slate-900 hover:bg-slate-850 border border-slate-800 text-slate-300 hover:text-slate-100 px-4 py-2 rounded-xl text-xs font-semibold flex items-center space-x-2 transition-all"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span>Share Itinerary</span>
            </button>
            <button
              onClick={handleReset}
              className="bg-slate-900 hover:bg-rose-950/30 hover:border-rose-900/40 border border-slate-800 text-slate-350 hover:text-rose-400 px-4 py-2 rounded-xl text-xs font-semibold flex items-center space-x-2 transition-all"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Create New</span>
            </button>
          </div>
        )}
      </header>

      {/* Main Content Area */}
      <div className="flex-1 p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 max-w-7xl mx-auto w-full h-[calc(100vh-80px)] overflow-hidden">
        {showShareNotification && (
          <div className="fixed top-20 right-6 bg-slate-900 border border-emerald-500/30 text-emerald-300 px-4 py-3 rounded-xl shadow-lg z-50 text-xs flex items-center space-x-2 animate-fade-in">
            <Sparkles className="w-4 h-4 text-emerald-400" />
            <span>Link copied to clipboard! Share it with friends.</span>
          </div>
        )}

        {!tripId ? (
          /* Form View */
          <div className="lg:col-span-12 flex items-center justify-center py-6 overflow-y-auto">
            <div className="w-full max-w-lg">
              <TripForm onSubmit={handleCreateTrip} isLoading={isLoading} />
            </div>
          </div>
        ) : (
          /* Active Dashboard View */
          <>
            {/* Left Panel: Constraints summary & Signals */}
            <div className="lg:col-span-3 flex flex-col space-y-4 h-full overflow-y-auto pr-1">
              <div className="bg-slate-900/60 backdrop-blur-md border border-slate-800 p-5 rounded-2xl">
                <h3 className="text-sm font-bold text-slate-200 border-b border-slate-800 pb-2 mb-3">
                  Trip Specifications
                </h3>
                <div className="space-y-3.5 text-xs text-slate-400">
                  <div>
                    <span className="block text-[10px] uppercase font-semibold text-slate-500 tracking-wider">Destination</span>
                    <span className="font-bold text-slate-200">{tripPlan?.trip?.destination_name}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase font-semibold text-slate-500 tracking-wider">Dates</span>
                    <span className="font-semibold text-slate-350">{tripPlan?.trip?.start_date} to {tripPlan?.trip?.end_date}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase font-semibold text-slate-500 tracking-wider">Transport Profile</span>
                    <span className="font-semibold text-slate-300 capitalize">{tripPlan?.constraints?.transport_mode}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase font-semibold text-slate-500 tracking-wider">Max Daily Walk</span>
                    <span className="font-semibold text-slate-300">{tripPlan?.constraints?.max_walking_distance_meters} meters</span>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase font-semibold text-slate-500 tracking-wider">Preference Tags</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {tripPlan?.constraints?.preferred_tags?.map((tag: string) => (
                        <span key={tag} className="bg-slate-950 border border-slate-800 text-[10px] px-2 py-0.5 rounded-full capitalize text-slate-400">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Live Signals & Audits */}
              {tripPlan?.signals && tripPlan.signals.length > 0 && (
                <div className="bg-slate-900/60 backdrop-blur-md border border-slate-800 p-5 rounded-2xl space-y-3">
                  <h3 className="text-sm font-bold text-slate-250 border-b border-slate-800 pb-2 flex items-center space-x-1.5 text-cyan-400">
                    <AlertTriangle className="w-4 h-4 text-cyan-400 animate-pulse" />
                    <span>Mitigation Log</span>
                  </h3>
                  <div className="space-y-2.5 max-h-[220px] overflow-y-auto">
                    {tripPlan.signals.map((sig: any) => (
                      <div key={sig.id} className="bg-slate-950 border border-cyan-950 p-3 rounded-xl space-y-1">
                        <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-wider">
                          Weather Intervention
                        </span>
                        <p className="text-[11px] text-slate-300 leading-normal">{sig.description}</p>
                        <span className="block text-[9px] text-slate-500 font-mono">
                          {new Date(sig.created_at).toLocaleTimeString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Middle Panel: Map View */}
            <div className="lg:col-span-5 h-full">
              <TripMap center={mapCenter} activities={activeActivities} />
            </div>

            {/* Right Panel: Daily Itinerary List & Simulation */}
            <div className="lg:col-span-4 h-full overflow-hidden">
              <Timeline
                days={tripPlan?.days || []}
                activeDay={activeDay}
                setActiveDay={setActiveDay}
                onToggleLock={handleToggleLock}
                onTriggerReplan={handleTriggerReplan}
                isReplanning={isReplanning}
              />
            </div>
          </>
        )}
      </div>
    </main>
  );
}
