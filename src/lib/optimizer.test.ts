import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import {
  ItineraryOptimizer,
  type Activity,
  type UserConstraints,
  type WeatherForecast,
} from './optimizer';

// getRoute() calls OSRM over the network. Force that to fail so every route
// resolves through the deterministic Haversine fallback — no network, no flake.
beforeAll(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network disabled in tests'))));
});
afterAll(() => {
  vi.unstubAllGlobals();
});

const clear: WeatherForecast = { date: '2026-06-10', rainProbability: 0.1, tempMax: 22, tempMin: 14, weatherCode: 0 };
const rainy: WeatherForecast = { date: '2026-06-10', rainProbability: 0.9, tempMax: 18, tempMin: 12, weatherCode: 75 };
const heat: WeatherForecast = { date: '2026-06-10', rainProbability: 0.1, tempMax: 38, tempMin: 20, weatherCode: 0 };

function makePoi(overrides: Partial<Activity> = {}): Activity {
  return {
    id: 'poi:test:1',
    name: 'Test POI',
    description: '',
    lat: 48.86,
    lng: 2.34,
    tags: [],
    popularity: 0.5,
    isOutdoor: true,
    dwellTimeMinutes: 60,
    openingHours: [{ open: 0, close: 1440 }],
    ...overrides,
  };
}

const constraints: UserConstraints = {
  startTime: 540, // 09:00
  endTime: 1080, // 18:00
  maxWalkingDistanceMeters: 50000,
  preferredTags: ['museum'],
  transportMode: 'foot',
};

describe('ItineraryOptimizer.calculateScore', () => {
  it('rewards matching preferred tags', () => {
    const a = makePoi({ tags: ['art', 'museum'], popularity: 0.5 });
    const matched = ItineraryOptimizer.calculateScore(a, ['art', 'museum'], clear);
    const unmatched = ItineraryOptimizer.calculateScore(a, [], clear);
    expect(matched).toBeGreaterThan(unmatched);
  });

  it('strongly penalizes outdoor activities in heavy rain (0.15x)', () => {
    const a = makePoi({ isOutdoor: true, tags: [], popularity: 0.8 });
    const dry = ItineraryOptimizer.calculateScore(a, [], clear);
    const wet = ItineraryOptimizer.calculateScore(a, [], rainy);
    expect(wet).toBeCloseTo(dry * 0.15, 6);
  });

  it('boosts indoor activities in heavy rain (1.25x)', () => {
    const a = makePoi({ isOutdoor: false, tags: [], popularity: 0.8 });
    const dry = ItineraryOptimizer.calculateScore(a, [], clear);
    const wet = ItineraryOptimizer.calculateScore(a, [], rainy);
    expect(wet).toBeCloseTo(dry * 1.25, 6);
  });

  it('moderately penalizes outdoor activities in temperature extremes (0.5x)', () => {
    const a = makePoi({ isOutdoor: true, tags: [], popularity: 0.8 });
    const dry = ItineraryOptimizer.calculateScore(a, [], clear);
    const hot = ItineraryOptimizer.calculateScore(a, [], heat);
    expect(hot).toBeCloseTo(dry * 0.5, 6);
  });
});

describe('ItineraryOptimizer.planSingleDay', () => {
  const start = { lat: 48.8566, lng: 2.3522 };

  const pois: Activity[] = [
    makePoi({ id: 'p1', name: 'Louvre', lat: 48.8606, lng: 2.3376, tags: ['museum'], popularity: 0.98, isOutdoor: false, dwellTimeMinutes: 90, openingHours: [{ open: 540, close: 1080 }] }),
    makePoi({ id: 'p2', name: 'Orsay', lat: 48.8599, lng: 2.3265, tags: ['museum'], popularity: 0.9, isOutdoor: false, dwellTimeMinutes: 90, openingHours: [{ open: 540, close: 1080 }] }),
    makePoi({ id: 'p3', name: 'Notre-Dame', lat: 48.853, lng: 2.3499, tags: ['landmark'], popularity: 0.85, isOutdoor: true, dwellTimeMinutes: 60, openingHours: [{ open: 540, close: 1080 }] }),
  ];

  it('produces a non-empty schedule of whole-minute, integer values', async () => {
    const { activities, totalDistance } = await ItineraryOptimizer.planSingleDay(
      start, pois, constraints, clear, [], new Set()
    );
    expect(activities.length).toBeGreaterThan(0);
    // Regression guard: minutes/distance must be integers (DB columns are INTEGER).
    expect(Number.isInteger(totalDistance)).toBe(true);
    for (const a of activities) {
      expect(Number.isInteger(a.startTime)).toBe(true);
      expect(Number.isInteger(a.endTime)).toBe(true);
      expect(a.endTime).toBeGreaterThan(a.startTime);
    }
  });

  it('never schedules beyond the day boundary', async () => {
    const { activities } = await ItineraryOptimizer.planSingleDay(
      start, pois, constraints, clear, [], new Set()
    );
    for (const a of activities) {
      expect(a.startTime).toBeGreaterThanOrEqual(constraints.startTime);
      expect(a.endTime).toBeLessThanOrEqual(constraints.endTime);
    }
  });

  it('excludes POIs already scheduled on other days', async () => {
    const { activities } = await ItineraryOptimizer.planSingleDay(
      start, pois, constraints, clear, [], new Set(['p1'])
    );
    expect(activities.some(a => a.poi.id === 'p1')).toBe(false);
  });

  it('places a locked activity at its reserved window (regression for skip bug)', async () => {
    const locked = [{ poiId: 'p3', startTime: 600, endTime: 660 }];
    const { activities } = await ItineraryOptimizer.planSingleDay(
      start, pois, constraints, clear, locked, new Set()
    );
    const lockedSlot = activities.find(a => a.poi.id === 'p3');
    expect(lockedSlot).toBeDefined();
    expect(lockedSlot!.startTime).toBe(600);
    expect(lockedSlot!.endTime).toBe(660);
  });

  it('does not schedule a POI that is closed during the whole day window', async () => {
    const closedPoi = makePoi({ id: 'closed', name: 'After Hours', popularity: 1, openingHours: [{ open: 1200, close: 1300 }] });
    const { activities } = await ItineraryOptimizer.planSingleDay(
      start, [closedPoi, ...pois], constraints, clear, [], new Set()
    );
    expect(activities.some(a => a.poi.id === 'closed')).toBe(false);
  });

  it('keeps activities in chronological order', async () => {
    const { activities } = await ItineraryOptimizer.planSingleDay(
      start, pois, constraints, clear, [{ poiId: 'p3', startTime: 600, endTime: 660 }], new Set()
    );
    for (let i = 1; i < activities.length; i++) {
      expect(activities[i].startTime).toBeGreaterThanOrEqual(activities[i - 1].startTime);
    }
  });
});
