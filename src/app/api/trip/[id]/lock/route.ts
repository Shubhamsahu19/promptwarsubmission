import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: tripId } = await params;

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { dayPlanActivityId, isLocked } = body ?? {};

    if (!dayPlanActivityId || typeof dayPlanActivityId !== 'string') {
      return NextResponse.json({ error: 'Missing dayPlanActivityId' }, { status: 400 });
    }

    // Scope the update to the trip in the URL so an activity can only be toggled
    // through its own trip — never by activity id alone across the whole table.
    const updateStmt = db.prepare(`
      UPDATE day_plan_activities
      SET is_locked = ?
      WHERE id = ?
        AND day_plan_id IN (
          SELECT dp.id FROM day_plans dp
          JOIN itineraries i ON dp.itinerary_id = i.id
          WHERE i.trip_id = ?
        )
    `);

    const info = updateStmt.run(isLocked ? 1 : 0, dayPlanActivityId, tripId);

    if (info.changes === 0) {
      return NextResponse.json({ error: 'Activity not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, isLocked: !!isLocked });
  } catch (error: any) {
    console.error('Error locking activity:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
