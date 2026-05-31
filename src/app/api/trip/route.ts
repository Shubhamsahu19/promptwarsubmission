import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { db } from '@/lib/db';
import { fetchPOIs, getWeatherForecast, ItineraryOptimizer } from '@/lib/optimizer';

export async function POST(req: Request) {
  try {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
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

    // Strict Input Validations
    if (!title || typeof title !== 'string' || title.trim().length === 0 || title.length > 100) {
      return NextResponse.json({ error: 'Invalid or missing title (max 100 chars)' }, { status: 400 });
    }
    if (!destinationName || typeof destinationName !== 'string' || destinationName.trim().length === 0 || destinationName.length > 100) {
      return NextResponse.json({ error: 'Invalid or missing destination name (max 100 chars)' }, { status: 400 });
    }
    if (typeof lat !== 'number' || lat < -90 || lat > 90) {
      return NextResponse.json({ error: 'Latitude must be a valid number between -90 and 90' }, { status: 400 });
    }
    if (typeof lng !== 'number' || lng < -180 || lng > 180) {
      return NextResponse.json({ error: 'Longitude must be a valid number between -180 and 180' }, { status: 400 });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return NextResponse.json({ error: 'Invalid start or end date format' }, { status: 400 });
    }
    if (start > end) {
      return NextResponse.json({ error: 'Start date must be before or equal to end date' }, { status: 400 });
    }
    const daysCount = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
    if (daysCount > 30) {
      return NextResponse.json({ error: 'Trip duration cannot exceed 30 days for optimization scaling constraints' }, { status: 400 });
    }

    if (budgetLimit !== undefined && budgetLimit !== null && (typeof budgetLimit !== 'number' || budgetLimit < 0)) {
      return NextResponse.json({ error: 'Budget limit must be a positive number' }, { status: 400 });
    }
    if (typeof maxWalkingDistanceMeters !== 'number' || maxWalkingDistanceMeters < 500 || maxWalkingDistanceMeters > 50000) {
      return NextResponse.json({ error: 'Max daily walking distance must be between 500m and 50km' }, { status: 400 });
    }
    if (typeof startTimeMinutes !== 'number' || startTimeMinutes < 0 || startTimeMinutes > 1440) {
      return NextResponse.json({ error: 'Start time must be between 0 and 1440 minutes' }, { status: 400 });
    }
    if (typeof endTimeMinutes !== 'number' || endTimeMinutes < 0 || endTimeMinutes > 1440 || endTimeMinutes <= startTimeMinutes) {
      return NextResponse.json({ error: 'End time must be after start time' }, { status: 400 });
    }
    if (!['foot', 'car', 'bike'].includes(transportMode)) {
      return NextResponse.json({ error: 'Invalid transport mode' }, { status: 400 });
    }
    if (!Array.isArray(preferredTags) || preferredTags.length > 20 ||
        !preferredTags.every((t: unknown) => typeof t === 'string' && t.length <= 40)) {
      return NextResponse.json({ error: 'preferredTags must be an array of up to 20 short strings' }, { status: 400 });
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
    // (start, end, and daysCount were already computed and validated above)
    // Pass the trip start date so the forecast aligns with the actual trip days.
    const forecast = await getWeatherForecast(lat, lng, daysCount, startDate);

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
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
