import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { db } from '@/lib/db';
import {
  ItineraryOptimizer,
  fetchPOIs,
  Activity,
  WeatherForecast,
} from '@/lib/optimizer';

// Safely parse a JSON column, returning a fallback on malformed data instead
// of turning the whole request into a 500.
function safeParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: tripId } = await params;

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { dayNumber, weatherOverride } = body ?? {};

    if (typeof dayNumber !== 'number' || !Number.isInteger(dayNumber) || dayNumber < 1) {
      return NextResponse.json({ error: 'dayNumber must be a positive integer' }, { status: 400 });
    }

    // 1. Fetch Trip & Constraints
    const trip = db.prepare(`SELECT * FROM trips WHERE id = ?`).get(tripId) as any;
    if (!trip) {
      return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
    }

    const constraints = db.prepare(`SELECT * FROM trip_constraints WHERE trip_id = ?`).get(tripId) as any;
    if (!constraints) {
      return NextResponse.json({ error: 'Trip constraints not found' }, { status: 404 });
    }
    const constraintsObj = {
      startTime: constraints.start_time_minutes,
      endTime: constraints.end_time_minutes,
      maxWalkingDistanceMeters: constraints.max_walking_distance_meters,
      preferredTags: safeParse<string[]>(constraints.preferred_tags, []),
      transportMode: constraints.transport_mode as 'foot' | 'car' | 'bike',
    };

    // 2. Fetch the active itinerary (latest version).
    const itinerary = db.prepare(`
      SELECT * FROM itineraries WHERE trip_id = ? ORDER BY version DESC, created_at DESC LIMIT 1
    `).get(tripId) as any;

    if (!itinerary) {
      return NextResponse.json({ error: 'Itinerary not found' }, { status: 404 });
    }

    // 3. Re-derive candidate POIs for THIS trip's destination (avoids pulling in
    //    other trips' POIs from the shared table) and persist any new ones.
    const pois: Activity[] = await fetchPOIs(trip.lat, trip.lng, trip.destination_name);
    const insertPOI = db.prepare(`
      INSERT OR IGNORE INTO pois (id, name, description, lat, lng, popularity, tags, is_outdoor, dwell_time_minutes, opening_hours)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    db.transaction(() => {
      for (const poi of pois) {
        insertPOI.run(
          poi.id, poi.name, poi.description, poi.lat, poi.lng, poi.popularity,
          JSON.stringify(poi.tags), poi.isOutdoor ? 1 : 0, poi.dwellTimeMinutes,
          JSON.stringify(poi.openingHours)
        );
      }
    })();

    // 4. Locate the target day plan.
    const dayPlans = db.prepare(`
      SELECT * FROM day_plans WHERE itinerary_id = ? ORDER BY day_number ASC
    `).all(itinerary.id) as any[];

    const targetDayPlan = dayPlans.find(dp => dp.day_number === dayNumber);
    if (!targetDayPlan) {
      return NextResponse.json({ error: `Day plan ${dayNumber} not found` }, { status: 404 });
    }

    // 5. POIs already scheduled on OTHER days, so we don't repeat them.
    const otherDayPoiIds = new Set<string>();
    for (const dp of dayPlans) {
      if (dp.day_number === dayNumber) continue;
      const scheduled = db.prepare(`
        SELECT poi_id FROM day_plan_activities WHERE day_plan_id = ?
      `).all(dp.id) as any[];
      scheduled.forEach(s => otherDayPoiIds.add(s.poi_id));
    }

    // 6. Locked activities on the target day must be preserved.
    const lockedActivitiesRaw = db.prepare(`
      SELECT dpa.* FROM day_plan_activities dpa
      WHERE dpa.day_plan_id = ? AND dpa.is_locked = 1
    `).all(targetDayPlan.id) as any[];

    const lockedActivities = lockedActivitiesRaw.map(l => ({
      poiId: l.poi_id,
      startTime: l.planned_start_minutes,
      endTime: l.planned_end_minutes,
    }));

    // 7. Weather for the target day (allow an explicit override for simulation).
    const storedWeather = safeParse<Partial<WeatherForecast>>(targetDayPlan.weather_summary, {});
    const weather: WeatherForecast = {
      date: storedWeather.date || trip.start_date,
      rainProbability: storedWeather.rainProbability ?? 0.1,
      tempMax: storedWeather.tempMax ?? 22,
      tempMin: storedWeather.tempMin ?? 14,
      weatherCode: storedWeather.weatherCode ?? 0,
      ...(weatherOverride && typeof weatherOverride === 'object' ? weatherOverride : {}),
    };

    // 8. Re-plan the day.
    const replanned = await ItineraryOptimizer.planSingleDay(
      { lat: trip.lat, lng: trip.lng },
      pois,
      constraintsObj,
      weather,
      lockedActivities,
      otherDayPoiIds
    );

    // 9. Persist: replace the day's activities and update its metadata.
    const deleteOldActivities = db.prepare(`DELETE FROM day_plan_activities WHERE day_plan_id = ?`);
    const insertDayActivity = db.prepare(`
      INSERT INTO day_plan_activities (id, day_plan_id, poi_id, sequence_order, planned_start_minutes, planned_end_minutes, is_locked)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const updateDayPlanMeta = db.prepare(`
      UPDATE day_plans SET total_distance_meters = ?, weather_summary = ? WHERE id = ?
    `);

    db.transaction(() => {
      deleteOldActivities.run(targetDayPlan.id);
      replanned.activities.forEach((act, idx) => {
        const isLockedVal = lockedActivities.some(l => l.poiId === act.poi.id) ? 1 : 0;
        insertDayActivity.run(
          crypto.randomUUID(),
          targetDayPlan.id,
          act.poi.id,
          idx + 1,
          act.startTime,
          act.endTime,
          isLockedVal
        );
      });
      updateDayPlanMeta.run(replanned.totalDistance, JSON.stringify(weather), targetDayPlan.id);
    })();

    // 10. Record a live signal when a weather override drove the re-plan.
    if (weatherOverride) {
      db.prepare(`
        INSERT INTO live_signals (id, trip_id, type, severity, description, affected_date, resolved)
        VALUES (?, ?, 'weather', 'high', 'Simulated weather alert triggered a timeline re-plan.', ?, 0)
      `).run(crypto.randomUUID(), tripId, weather.date || trip.start_date);
    }

    return NextResponse.json({ success: true, dayNumber });
  } catch (error: any) {
    console.error('Error replanning trip:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
