'use client';

import React, { useState } from 'react';
import { Compass, Loader2, Navigation, DollarSign, Tag } from 'lucide-react';

interface TripFormProps {
  onSubmit: (tripData: any) => Promise<void>;
  isLoading: boolean;
}

const PRESET_TAGS = ['sightseeing', 'museum', 'nature', 'art', 'food', 'relax', 'culture', 'religion', 'park', 'landmark'];

export default function TripForm({ onSubmit, isLoading }: TripFormProps) {
  const [title, setTitle] = useState('');
  const [destination, setDestination] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [budget, setBudget] = useState('');
  const [maxDistance, setMaxDistance] = useState('10000');
  const [transportMode, setTransportMode] = useState<'foot' | 'car' | 'bike'>('foot');
  const [selectedTags, setSelectedTags] = useState<string[]>(['sightseeing', 'museum']);
  const [resolvingCity, setResolvingCity] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const toggleTag = (tag: string) => {
    setSelectedTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    if (!title || !destination || !startDate || !endDate) {
      setErrorMsg('Please fill in all required fields.');
      return;
    }

    setResolvingCity(true);
    try {
      // Geocoding request hitting local database-backed cache proxy first
      const response = await fetch(
        `/api/geocoding?q=${encodeURIComponent(destination)}`
      );
      if (!response.ok) throw new Error('Geocoding service returned an error');
      const data = await response.json();
      
      if (!data || data.length === 0) {
        setErrorMsg(`Could not resolve city location: "${destination}". Try typing it differently (e.g. "Paris, France").`);
        setResolvingCity(false);
        return;
      }

      const { lat, lon, display_name } = data[0];

      await onSubmit({
        title,
        destinationName: display_name.split(',')[0],
        lat: parseFloat(lat),
        lng: parseFloat(lon),
        startDate,
        endDate,
        budgetLimit: budget ? parseFloat(budget) : null,
        maxWalkingDistanceMeters: parseInt(maxDistance),
        preferredTags: selectedTags,
        transportMode,
      });
    } catch (e: any) {
      setErrorMsg(e.message || 'An error occurred during location resolution.');
    } finally {
      setResolvingCity(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 bg-slate-900/60 backdrop-blur-md border border-slate-800 p-6 rounded-2xl text-slate-200 shadow-xl">
      <div className="flex items-center space-x-2 border-b border-slate-800 pb-4">
        <Compass className="w-6 h-6 text-emerald-400 animate-spin-slow" />
        <h2 className="text-xl font-bold bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
          Configure Your Journey
        </h2>
      </div>

      {errorMsg && (
        <div className="bg-rose-500/10 border border-rose-500/20 text-rose-300 px-4 py-3 rounded-lg text-sm">
          {errorMsg}
        </div>
      )}

      {/* Trip Title */}
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Trip Title *</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Summer European Escape"
          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-emerald-500 transition-colors"
          required
        />
      </div>

      {/* Destination */}
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Destination *</label>
        <div className="relative">
          <input
            type="text"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="Paris, Tokyo, New York..."
            className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-3 text-sm focus:outline-none focus:border-emerald-500 transition-colors"
            required
          />
          <Navigation className="absolute left-3 top-3.5 w-4 h-4 text-slate-500" />
        </div>
      </div>

      {/* Dates */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Start Date *</label>
          <div className="relative">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-emerald-500 transition-colors"
              required
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">End Date *</label>
          <div className="relative">
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-emerald-500 transition-colors"
              required
            />
          </div>
        </div>
      </div>

      {/* Budget & Walking Limit */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Budget (€)</label>
          <div className="relative">
            <input
              type="number"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              placeholder="Unlimited"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-8 pr-4 py-3 text-sm focus:outline-none focus:border-emerald-500 transition-colors"
            />
            <DollarSign className="absolute left-3 top-3.5 w-4 h-4 text-slate-500" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Walk Limit (m)</label>
          <input
            type="number"
            value={maxDistance}
            onChange={(e) => setMaxDistance(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-emerald-500 transition-colors"
          />
        </div>
      </div>

      {/* Transport Mode */}
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Transportation Mode</label>
        <div className="grid grid-cols-3 gap-2">
          {(['foot', 'bike', 'car'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setTransportMode(mode)}
              className={`py-3 rounded-xl border text-xs font-medium capitalize transition-all ${
                transportMode === mode
                  ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400 shadow-inner'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
              }`}
            >
              {mode === 'foot' ? '🚶 Walking' : mode === 'bike' ? '🚲 Biking' : '🚗 Driving'}
            </button>
          ))}
        </div>
      </div>

      {/* Tags preferences */}
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2 flex items-center">
          <Tag className="w-3.5 h-3.5 mr-1" /> Preferred Categories
        </label>
        <div className="flex flex-wrap gap-1.5">
          {PRESET_TAGS.map((tag) => {
            const isSelected = selectedTags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() => toggleTag(tag)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border capitalize transition-all ${
                  isSelected
                    ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300'
                    : 'bg-slate-950 border-slate-850 text-slate-450 hover:border-slate-800'
                }`}
              >
                {tag}
              </button>
            );
          })}
        </div>
      </div>

      {/* Submit Button */}
      <button
        type="submit"
        disabled={isLoading || resolvingCity}
        className="w-full bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-slate-950 font-bold py-4 rounded-xl transition-all shadow-lg flex items-center justify-center space-x-2"
      >
        {isLoading || resolvingCity ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>{resolvingCity ? 'Locating Destination...' : 'Generating Itinerary...'}</span>
          </>
        ) : (
          <span>Build Engine Itinerary</span>
        )}
      </button>
    </form>
  );
}
