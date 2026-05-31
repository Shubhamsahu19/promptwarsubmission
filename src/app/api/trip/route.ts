import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { db } from '@/lib/db';
import { fetchPOIs, getWeatherForecast, ItineraryOptimizer } from '@/lib/optimizer';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      title,
      destinationName,
      lat,
      lng,
      startDate,
      endDate,
      budgetLimit,
      maxWalkingDistanceMeters = 10000,
      preferredTags = [],
      transportMode = 'foot',
      startTimeMinutes = 540,
      endTimeMinutes = 1080,
      accessibilityRequired = false,
    } = body;

    if (!title || !destinationName || !lat || !lng || !startDate || !endDate) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    const tripId = crypto.randomUUID();

    // 1. Write Trip details
    const insertTrip = db.prepare(`
      INSERT INTO trips (id, title, destination_name, lat, lng, start_date, end_date, is_locked)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    `);
    
    // 2. Write Constraints
    const insertConstraints = db.prepare(`
      INSERT INTO trip_constraints (trip_id, budget_limit, max_walking_distance_meters, preferred_tags, transport_mode, start_time_minutes, end_time_minutes, accessibility_required)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Run in transaction
    const createTripTx = db.transaction(() => {
      insertTrip.run(tripId, title, destinationName, lat, lng, startDate, endDate);
      insertConstraints.run(
        tripId,
        budgetLimit || null,
        maxWalkingDistanceMeters,
        JSON.stringify(preferredTags),
        transportMode,
        startTimeMinutes,
        endTimeMinutes,
        accessibilityRequired ? 1 : 0
      );
    });
    createTripTx();

    // 3. Fetch POIs (Overpass API with localized fallbacks)
    const pois = await fetchPOIs(lat, lng, destinationName);

    // Save POIs to DB (INSERT OR IGNORE)
    const insertPOI = db.prepare(`
      INSERT OR IGNORE INTO pois (id, name, description, lat, lng, popularity, tags, is_outdoor, dwell_time_minutes, opening_hours)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const savePOIsTx = db.transaction(() => {
      for (const poi of pois) {
        insertPOI.run(
          poi.id,
          poi.name,
          poi.description,
          poi.lat,
          poi.lng,
          poi.popularity,
          JSON.stringify(poi.tags),
          poi.isOutdoor ? 1 : 0,
          poi.dwellTimeMinutes,
          JSON.stringify(poi.openingHours)
        );
      }
    });
    savePOIsTx();

    // 4. Fetch Weather Forecast for trip range
    const start = new Date(startDate);
    const end = new Date(endDate);
    const daysCount = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
    const forecast = await getWeatherForecast(lat, lng, daysCount);

    // 5. Create Itinerary
    const itineraryId = crypto.randomUUID();
    db.prepare(`INSERT INTO itineraries (id, trip_id, version) VALUES (?, ?, 1)`).run(itineraryId, tripId);

    // 6. Run Optimizer Day-by-day
    const constraintsObj = {
      startTime: startTimeMinutes,
      endTime: endTimeMinutes,
      maxWalkingDistanceMeters,
      preferredTags,
      transportMode: transportMode as 'foot' | 'car' | 'bike',
    };

    const scheduledPoiIds = new Set<string>();

    const insertDayPlan = db.prepare(`
      INSERT INTO day_plans (id, itinerary_id, day_number, weather_summary, total_distance_meters)
      VALUES (?, ?, ?, ?, ?)
    `);

    const insertDayActivity = db.prepare(`
      INSERT INTO day_plan_activities (id, day_plan_id, poi_id, sequence_order, planned_start_minutes, planned_end_minutes, is_locked)
      VALUES (?, ?, ?, ?, ?, ?, 0)
    `);

    // Run the async optimization OUTSIDE the DB transaction — better-sqlite3
    // transactions must be synchronous and reject promise-returning callbacks.
    const computedDays: {
      dayPlanId: string;
      day: number;
      weather: typeof forecast[number];
      totalDistance: number;
      activities: { poiId: string; startTime: number; endTime: number }[];
    }[] = [];

    for (let day = 1; day <= daysCount; day++) {
      const weather = forecast[day - 1] || forecast[0];

      // Start day at the city centroid or a default location
      const dayPlan = await ItineraryOptimizer.planSingleDay(
        { lat, lng },
        pois,
        constraintsObj,
        weather,
        [], // No locked activities initially
        scheduledPoiIds
      );

      computedDays.push({
        dayPlanId: crypto.randomUUID(),
        day,
        weather,
        totalDistance: dayPlan.totalDistance,
        activities: dayPlan.activities.map(act => ({
          poiId: act.poi.id,
          startTime: act.startTime,
          endTime: act.endTime,
        })),
      });

      dayPlan.activities.forEach(act => scheduledPoiIds.add(act.poi.id));
    }

    // Persist the computed plans in a single synchronous transaction.
    const persistOptimizationTx = db.transaction(() => {
      for (const cd of computedDays) {
        insertDayPlan.run(cd.dayPlanId, itineraryId, cd.day, JSON.stringify(cd.weather), cd.totalDistance);
        cd.activities.forEach((act, idx) => {
          insertDayActivity.run(
            crypto.randomUUID(),
            cd.dayPlanId,
            act.poiId,
            idx + 1,
            act.startTime,
            act.endTime
          );
        });
      }
    });

    persistOptimizationTx();

    return NextResponse.json({ tripId, itineraryId }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating trip:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
