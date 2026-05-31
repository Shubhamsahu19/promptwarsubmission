import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const resolvedParams = await params;
    const tripId = resolvedParams.id;

    // 1. Fetch Trip details
    const trip = db.prepare(`SELECT * FROM trips WHERE id = ?`).get(tripId) as any;
    if (!trip) {
      return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
    }

    // 2. Fetch Constraints
    const constraints = db.prepare(`SELECT * FROM trip_constraints WHERE trip_id = ?`).get(tripId) as any;
    if (constraints) {
      constraints.preferred_tags = JSON.parse(constraints.preferred_tags);
    }

    // 3. Fetch latest Itinerary
    const itinerary = db.prepare(`
      SELECT * FROM itineraries WHERE trip_id = ? ORDER BY version DESC LIMIT 1
    `).get(tripId) as any;

    if (!itinerary) {
      return NextResponse.json({ trip, constraints, days: [] });
    }

    // 4. Fetch Day Plans
    const dayPlans = db.prepare(`
      SELECT * FROM day_plans WHERE itinerary_id = ? ORDER BY day_number ASC
    `).all(itinerary.id) as any[];

    // 5. Fetch Activities for each day plan
    const days = [];
    for (const dp of dayPlans) {
      const activities = db.prepare(`
        SELECT dpa.*, p.name, p.description, p.lat, p.lng, p.popularity, p.tags, p.is_outdoor, p.dwell_time_minutes, p.opening_hours
        FROM day_plan_activities dpa
        JOIN pois p ON dpa.poi_id = p.id
        WHERE dpa.day_plan_id = ?
        ORDER BY dpa.sequence_order ASC
      `).all(dp.id) as any[];

      // Parse JSON columns
      const parsedActivities = activities.map(act => ({
        id: act.id,
        poiId: act.poi_id,
        sequenceOrder: act.sequence_order,
        plannedStartMinutes: act.planned_start_minutes,
        plannedEndMinutes: act.planned_end_minutes,
        isLocked: act.is_locked === 1,
        poi: {
          id: act.poi_id,
          name: act.name,
          description: act.description,
          lat: act.lat,
          lng: act.lng,
          popularity: act.popularity,
          tags: JSON.parse(act.tags),
          isOutdoor: act.is_outdoor === 1,
          dwellTimeMinutes: act.dwell_time_minutes,
          openingHours: JSON.parse(act.opening_hours),
        }
      }));

      days.push({
        id: dp.id,
        dayNumber: dp.day_number,
        weatherSummary: JSON.parse(dp.weather_summary || '{}'),
        totalDistanceMeters: dp.total_distance_meters,
        activities: parsedActivities
      });
    }

    // 6. Fetch live signals
    const signals = db.prepare(`
      SELECT * FROM live_signals WHERE trip_id = ? AND resolved = 0 ORDER BY created_at DESC
    `).all(tripId) as any[];

    return NextResponse.json({
      trip,
      constraints,
      itineraryId: itinerary.id,
      version: itinerary.version,
      days,
      signals
    });
  } catch (error: any) {
    console.error('Error fetching trip plan:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
