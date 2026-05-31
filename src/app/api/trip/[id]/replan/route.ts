import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { db } from '@/lib/db';
import { ItineraryOptimizer, Activity } from '@/lib/optimizer';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const resolvedParams = await params;
    const tripId = resolvedParams.id;
    const body = await req.json();
    const { dayNumber, weatherOverride } = body;

    if (dayNumber === undefined) {
      return NextResponse.json({ error: 'Missing dayNumber' }, { status: 400 });
    }

    // 1. Fetch Trip & Constraints
    const trip = db.prepare(`SELECT * FROM trips WHERE id = ?`).get(tripId) as any;
    if (!trip) {
      return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
    }

    const constraints = db.prepare(`SELECT * FROM trip_constraints WHERE trip_id = ?`).get(tripId) as any;
    const constraintsObj = {
      startTime: constraints.start_time_minutes,
      endTime: constraints.end_time_minutes,
      maxWalkingDistanceMeters: constraints.max_walking_distance_meters,
      preferredTags: JSON.parse(constraints.preferred_tags),
      transportMode: constraints.transport_mode as 'foot' | 'car' | 'bike',
    };

    // 2. Fetch Active Itinerary
    const itinerary = db.prepare(`
      SELECT * FROM itineraries WHERE trip_id = ? ORDER BY version DESC LIMIT 1
    `).get(tripId) as any;

    if (!itinerary) {
      return NextResponse.json({ error: 'Itinerary not found' }, { status: 404 });
    }

    // 3. Fetch all POIs in this destination that we previously saved
    const rawPois = db.prepare(`SELECT * FROM pois`).all() as any[];
    const pois: Activity[] = rawPois.map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      lat: p.lat,
      lng: p.lng,
      popularity: p.popularity,
      tags: JSON.parse(p.tags),
      isOutdoor: p.is_outdoor === 1,
      dwellTimeMinutes: p.dwell_time_minutes,
      openingHours: JSON.parse(p.opening_hours),
    }));

    // 4. Find all day plans under this itinerary
    const dayPlans = db.prepare(`
      SELECT * FROM day_plans WHERE itinerary_id = ? ORDER BY day_number ASC
    `).all(itinerary.id) as any[];

    const targetDayPlan = dayPlans.find(dp => dp.day_number === dayNumber);
    if (!targetDayPlan) {
      return NextResponse.json({ error: `Day plan ${dayNumber} not found` }, { status: 404 });
    }

    // 5. Retrieve all POIs scheduled on OTHER days (so we don't repeat them)
    const otherDayPoiIds = new Set<string>();
    for (const dp of dayPlans) {
      if (dp.day_number === dayNumber) continue;
      const scheduled = db.prepare(`
        SELECT poi_id FROM day_plan_activities WHERE day_plan_id = ?
      `).all(dp.id) as any[];
      scheduled.forEach(s => otherDayPoiIds.add(s.poi_id));
    }

    // 6. Find all LOCKED activities on the target day
    const lockedActivitiesRaw = db.prepare(`
      SELECT dpa.*, p.dwell_time_minutes
      FROM day_plan_activities dpa
      JOIN pois p ON dpa.poi_id = p.id
      WHERE dpa.day_plan_id = ? AND dpa.is_locked = 1
    `).all(targetDayPlan.id) as any[];

    const lockedActivities = lockedActivitiesRaw.map(l => ({
      poiId: l.poi_id,
      startTime: l.planned_start_minutes,
      endTime: l.planned_end_minutes,
    }));

    // 7. Get weather forecast for target day (use override if provided)
    const weather = weatherOverride || JSON.parse(targetDayPlan.weather_summary || '{}');

    // 8. Re-plan this day
    const replanned = await ItineraryOptimizer.planSingleDay(
      { lat: trip.lat, lng: trip.lng },
      pois,
      constraintsObj,
      weather,
      lockedActivities,
      otherDayPoiIds
    );

    // 9. Update DB: Delete old activities and save new ones
    const deleteOldActivities = db.prepare(`
      DELETE FROM day_plan_activities WHERE day_plan_id = ?
    `);

    const insertDayActivity = db.prepare(`
      INSERT INTO day_plan_activities (id, day_plan_id, poi_id, sequence_order, planned_start_minutes, planned_end_minutes, is_locked)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const updateDayPlanMeta = db.prepare(`
      UPDATE day_plans
      SET total_distance_meters = ?, weather_summary = ?
      WHERE id = ?
    `);

    const runReplanTx = db.transaction(() => {
      // Clear old activities
      deleteOldActivities.run(targetDayPlan.id);

      // Save new activities, preserving the locked status
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

      // Update distance and weather summary
      updateDayPlanMeta.run(
        replanned.totalDistance,
        JSON.stringify(weather),
        targetDayPlan.id
      );
    });

    runReplanTx();

    // 10. If weather was overridden, log a LiveSignal
    if (weatherOverride) {
      db.prepare(`
        INSERT INTO live_signals (id, trip_id, type, severity, description, affected_date, resolved)
        VALUES (?, ?, 'weather', 'high', 'Simulated weather alert triggered a timeline re-plan.', ?, 0)
      `).run(crypto.randomUUID(), tripId, weather.date || trip.start_date);
    }

    return NextResponse.json({ success: true, dayNumber });
  } catch (error: any) {
    console.error('Error replanning trip:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
