import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await params;
    const body = await req.json();
    const { dayPlanActivityId, isLocked } = body;

    if (!dayPlanActivityId) {
      return NextResponse.json({ error: 'Missing dayPlanActivityId' }, { status: 400 });
    }

    const updateStmt = db.prepare(`
      UPDATE day_plan_activities
      SET is_locked = ?
      WHERE id = ?
    `);

    const info = updateStmt.run(isLocked ? 1 : 0, dayPlanActivityId);

    if (info.changes === 0) {
      return NextResponse.json({ error: 'Activity not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, isLocked });
  } catch (error: any) {
    console.error('Error locking activity:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
