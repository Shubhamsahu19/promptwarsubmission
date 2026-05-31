import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get('q');

    if (!query || query.trim().length === 0) {
      return NextResponse.json({ error: 'Query parameter q is required' }, { status: 400 });
    }
    if (query.length > 200) {
      return NextResponse.json({ error: 'Query is too long (max 200 characters)' }, { status: 400 });
    }

    const normalizedQuery = query.toLowerCase().trim();

    // 1. Check local geocoding cache first
    const cached = db.prepare(`
      SELECT display_name, lat, lng FROM geocoding_cache WHERE query = ?
    `).get(normalizedQuery) as any;

    if (cached) {
      return NextResponse.json([{
        display_name: cached.display_name,
        lat: cached.lat.toString(),
        lon: cached.lng.toString()
      }]);
    }

    // 2. Fetch from external Nominatim API if not cached
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'AetherTravelPlanningEngine/1.0 (production-ready-shield)' },
      signal: AbortSignal.timeout(4000)
    });

    if (!response.ok) {
      throw new Error('Nominatim geocoding request failed');
    }

    const data = await response.json();

    if (data && data.length > 0) {
      const { display_name, lat, lon } = data[0];
      
      // Save result in geocoding cache database
      db.prepare(`
        INSERT OR REPLACE INTO geocoding_cache (query, display_name, lat, lng)
        VALUES (?, ?, ?, ?)
      `).run(normalizedQuery, display_name, parseFloat(lat), parseFloat(lon));
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Geocoding error:', error);
    return NextResponse.json({ error: 'Internal geocoding proxy error' }, { status: 500 });
  }
}
