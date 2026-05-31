import { db } from './db';

export interface Activity {
  id: string;
  name: string;
  description: string;
  lat: number;
  lng: number;
  tags: string[];
  popularity: number; // 0 to 1
  isOutdoor: boolean;
  dwellTimeMinutes: number;
  openingHours: { open: number; close: number }[]; // Minutes from midnight
}

export interface UserConstraints {
  startTime: number; // e.g., 540 = 9:00 AM
  endTime: number;   // e.g., 1080 = 6:00 PM
  maxWalkingDistanceMeters: number;
  preferredTags: string[];
  transportMode: 'foot' | 'car' | 'bike';
}

export interface WeatherForecast {
  date: string;
  rainProbability: number;
  tempMax: number;
  tempMin: number;
  weatherCode: number;
}

// Haversine distance fallback
function getHaversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // meters
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // in meters
}

// Average speed fallbacks in meters per minute
const AVERAGE_SPEEDS = {
  foot: 75, // 4.5 km/h
  bike: 250, // 15 km/h
  car: 600, // 36 km/h
};

// Caches route matrices in DB/memory to avoid rate-limiting
const routeCache = new Map<string, { distance: number; duration: number; geometry?: any }>();

export async function getRoute(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  mode: 'foot' | 'car' | 'bike'
): Promise<{ distance: number; duration: number; geometry?: any }> {
  const cacheKey = `${from.lat.toFixed(5)},${from.lng.toFixed(5)}:${to.lat.toFixed(5)},${to.lng.toFixed(5)}:${mode}`;
  if (routeCache.has(cacheKey)) {
    return routeCache.get(cacheKey)!;
  }

  const osrmMode = mode === 'car' ? 'driving' : mode === 'bike' ? 'cycling' : 'walking';
  const url = `https://router.project-osrm.org/route/v1/${osrmMode}/${from.lng},from.lat;${to.lng},${to.lat}?overview=full&geometries=geojson`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error('OSRM error');
    const data = await res.json();
    if (data.routes && data.routes.length > 0) {
      const route = data.routes[0];
      const result = {
        distance: route.distance, // meters
        duration: route.duration / 60, // minutes
        geometry: route.geometry, // GeoJSON
      };
      routeCache.set(cacheKey, result);
      return result;
    }
  } catch (e) {
    // Fallback: Haversine distance + static speeds
    const dist = getHaversineDistance(from.lat, from.lng, to.lat, to.lng);
    const speed = AVERAGE_SPEEDS[mode] || AVERAGE_SPEEDS.foot;
    const duration = dist / speed;
    return {
      distance: dist,
      duration: duration,
      geometry: {
        type: 'LineString',
        coordinates: [
          [from.lng, from.lat],
          [to.lng, to.lat],
        ],
      },
    };
  }

  // Double fallback
  const dist = getHaversineDistance(from.lat, from.lng, to.lat, to.lng);
  return { distance: dist, duration: dist / AVERAGE_SPEEDS.foot };
}

// Fetch weather from Open-Meteo
export async function getWeatherForecast(lat: number, lng: number, daysCount: number): Promise<WeatherForecast[]> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto`;
  
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error('Open-Meteo offline');
    const data = await res.json();
    
    if (data.daily) {
      return data.daily.time.map((dateStr: string, idx: number) => ({
        date: dateStr,
        rainProbability: (data.daily.precipitation_probability_max?.[idx] ?? 0) / 100,
        tempMax: data.daily.temperature_2m_max?.[idx] ?? 20,
        tempMin: data.daily.temperature_2m_min?.[idx] ?? 10,
        weatherCode: data.daily.weathercode?.[idx] ?? 0,
      }));
    }
  } catch (e) {
    console.warn('Weather fetch failed, falling back to clear weather mocks.', e);
  }

  // Fallback default forecast
  const forecast: WeatherForecast[] = [];
  const start = new Date();
  for (let i = 0; i < daysCount; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    forecast.push({
      date: d.toISOString().split('T')[0],
      rainProbability: 0.1,
      tempMax: 22,
      tempMin: 14,
      weatherCode: 0,
    });
  }
  return forecast;
}

// High-quality localized mock fallback POIs for major hubs
const MOCK_DESTINATIONS: Record<string, Activity[]> = {
  paris: [
    { id: 'poi:paris:1', name: 'Eiffel Tower', description: 'Iconic iron tower on the Champ de Mars.', lat: 48.8584, lng: 2.2945, tags: ['sightseeing', 'landmark', 'photo'], popularity: 1.0, isOutdoor: true, dwellTimeMinutes: 120, openingHours: [{ open: 540, close: 1420 }] },
    { id: 'poi:paris:2', name: 'Louvre Museum', description: 'The world\'s largest art museum and historic monument.', lat: 48.8606, lng: 2.3376, tags: ['art', 'museum', 'indoor', 'culture'], popularity: 0.98, isOutdoor: false, dwellTimeMinutes: 180, openingHours: [{ open: 540, close: 1080 }] },
    { id: 'poi:paris:3', name: 'Notre-Dame Cathedral', description: 'Famous medieval Catholic cathedral.', lat: 48.8530, lng: 2.3499, tags: ['sightseeing', 'religion', 'landmark'], popularity: 0.90, isOutdoor: false, dwellTimeMinutes: 60, openingHours: [{ open: 480, close: 1140 }] },
    { id: 'poi:paris:4', name: 'Arc de Triomphe', description: 'Monument standing at the western end of the Champs-Élysées.', lat: 48.8738, lng: 2.2950, tags: ['sightseeing', 'landmark', 'photo'], popularity: 0.88, isOutdoor: true, dwellTimeMinutes: 45, openingHours: [{ open: 600, close: 1380 }] },
    { id: 'poi:paris:5', name: 'Sacré-Cœur Basilica', description: 'Roman Catholic church perched on Montmartre.', lat: 48.8867, lng: 2.3431, tags: ['sightseeing', 'religion', 'culture'], popularity: 0.85, isOutdoor: false, dwellTimeMinutes: 60, openingHours: [{ open: 360, close: 1350 }] },
    { id: 'poi:paris:6', name: 'Jardin du Luxembourg', description: 'Beautiful landscaped gardens with fountains.', lat: 48.8462, lng: 2.3371, tags: ['nature', 'park', 'outdoor', 'relax'], popularity: 0.82, isOutdoor: true, dwellTimeMinutes: 90, openingHours: [{ open: 480, close: 1260 }] },
    { id: 'poi:paris:7', name: 'Musée d\'Orsay', description: 'Museum holding mainly French art from 1848 to 1914.', lat: 48.8599, lng: 2.3265, tags: ['art', 'museum', 'indoor'], popularity: 0.87, isOutdoor: false, dwellTimeMinutes: 120, openingHours: [{ open: 570, close: 1080 }] },
    { id: 'poi:paris:8', name: 'Champs-Élysées Cafe', description: 'Charming French bistro & bakery.', lat: 48.8698, lng: 2.3075, tags: ['food', 'cafe', 'indoor'], popularity: 0.75, isOutdoor: false, dwellTimeMinutes: 60, openingHours: [{ open: 480, close: 1320 }] },
  ],
  tokyo: [
    { id: 'poi:tokyo:1', name: 'Senso-ji Temple', description: 'Ancient Buddhist temple in Asakusa.', lat: 35.7148, lng: 139.7967, tags: ['sightseeing', 'religion', 'culture'], popularity: 0.98, isOutdoor: true, dwellTimeMinutes: 90, openingHours: [{ open: 360, close: 1020 }] },
    { id: 'poi:tokyo:2', name: 'Tokyo Tower', description: 'Communications and observation tower in Minato.', lat: 35.6586, lng: 139.7454, tags: ['sightseeing', 'landmark', 'view'], popularity: 0.92, isOutdoor: false, dwellTimeMinutes: 90, openingHours: [{ open: 540, close: 1320 }] },
    { id: 'poi:tokyo:3', name: 'Meiji Shrine', description: 'Shinto shrine surrounded by a dense forest.', lat: 35.6764, lng: 139.6993, tags: ['nature', 'religion', 'outdoor'], popularity: 0.90, isOutdoor: true, dwellTimeMinutes: 90, openingHours: [{ open: 300, close: 1100 }] },
    { id: 'poi:tokyo:4', name: 'Shinjuku Gyoen National Garden', description: 'Large park with Japanese, English, and French gardens.', lat: 35.6852, lng: 139.7101, tags: ['nature', 'park', 'outdoor', 'relax'], popularity: 0.88, isOutdoor: true, dwellTimeMinutes: 120, openingHours: [{ open: 540, close: 990 }] },
    { id: 'poi:tokyo:5', name: 'Shibuya Crossing', description: 'Famous pedestrian scramble crossing.', lat: 35.6595, lng: 139.7005, tags: ['sightseeing', 'landmark', 'photo'], popularity: 0.95, isOutdoor: true, dwellTimeMinutes: 30, openingHours: [{ open: 0, close: 1440 }] },
    { id: 'poi:tokyo:6', name: 'Tokyo National Museum', description: 'A collection of art and archaeological artifacts from Japan.', lat: 35.7188, lng: 139.7765, tags: ['art', 'museum', 'indoor', 'culture'], popularity: 0.85, isOutdoor: false, dwellTimeMinutes: 120, openingHours: [{ open: 570, close: 1020 }] },
    { id: 'poi:tokyo:7', name: 'Takeshita Street Cafe', description: 'Vibrant cafe serving colorful sweet crepes.', lat: 35.6702, lng: 139.7051, tags: ['food', 'cafe', 'indoor'], popularity: 0.80, isOutdoor: false, dwellTimeMinutes: 45, openingHours: [{ open: 600, close: 1200 }] },
  ],
};

export async function fetchPOIs(lat: number, lng: number, destinationName: string): Promise<Activity[]> {
  const normalizedDest = destinationName.toLowerCase().trim();
  
  // Use mock details immediately if we match one of our configured cities
  for (const key of Object.keys(MOCK_DESTINATIONS)) {
    if (normalizedDest.includes(key)) {
      return MOCK_DESTINATIONS[key];
    }
  }

  // Otherwise try OpenStreetMap Overpass API
  const query = `
    [out:json][timeout:5];
    (
      node["tourism"="attraction"](around:4000,${lat},${lng});
      node["tourism"="museum"](around:4000,${lat},${lng});
      node["historic"](around:4000,${lat},${lng});
      node["amenity"="cafe"](around:4000,${lat},${lng});
      node["leisure"="park"](around:4000,${lat},${lng});
    );
    out body 25;
  `;
  const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error('Overpass error');
    const data = await res.json();
    if (data.elements && data.elements.length > 0) {
      const parsedPOIs: Activity[] = data.elements
        .filter((el: any) => el.tags && el.tags.name)
        .map((el: any, idx: number) => {
          const isMuseum = el.tags.tourism === 'museum';
          const isCafe = el.tags.amenity === 'cafe';
          const isPark = el.tags.leisure === 'park';
          
          const tags = [];
          if (el.tags.tourism) tags.push(el.tags.tourism);
          if (el.tags.historic) tags.push('historic');
          if (el.tags.amenity) tags.push(el.tags.amenity);
          if (el.tags.leisure) tags.push(el.tags.leisure);
          
          return {
            id: `osm:node:${el.id}`,
            name: el.tags.name,
            description: el.tags.description || `${el.tags.tourism || 'Attraction'} in ${destinationName}`,
            lat: el.lat,
            lng: el.lon,
            tags: tags,
            popularity: Math.max(0.2, 0.9 - idx * 0.03), // Artificial popularity curve
            isOutdoor: !isMuseum && !isCafe,
            dwellTimeMinutes: isMuseum ? 120 : isCafe ? 60 : isPark ? 90 : 60,
            openingHours: [{ open: 540, close: 1080 }], // Default 9:00 AM - 6:00 PM
          };
        });
      
      // If we got enough real POIs, save them
      if (parsedPOIs.length >= 3) {
        return parsedPOIs;
      }
    }
  } catch (e) {
    console.warn('Overpass fetch failed, falling back to Paris mock data.', e);
  }

  // Fallback to Paris mock data
  return MOCK_DESTINATIONS.paris;
}

export class ItineraryOptimizer {
  /**
   * Scores activities based on user preferences and weather.
   */
  public static calculateScore(
    activity: Activity,
    preferredTags: string[],
    weather: WeatherForecast
  ): number {
    const wPref = 0.7;
    const wPop = 0.3;

    // Jaccard tags similarity
    const matchingTags = activity.tags.filter(t => preferredTags.includes(t));
    const unionSize = new Set([...activity.tags, ...preferredTags]).size;
    const preferenceMatch = unionSize > 0 ? matchingTags.length / unionSize : 0;

    const baseScore = wPref * preferenceMatch + wPop * activity.popularity;

    let weatherMultiplier = 1.0;
    if (activity.isOutdoor) {
      if (weather.rainProbability > 0.5) {
        weatherMultiplier = 0.15; // Strongly penalize outdoors in rain
      } else if (weather.tempMax > 34 || weather.tempMin < 3) {
        weatherMultiplier = 0.5; // Moderately penalize in temperature extremes
      }
    } else {
      if (weather.rainProbability > 0.5) {
        weatherMultiplier = 1.25; // Boost indoor activities during rain
      }
    }

    return baseScore * weatherMultiplier;
  }

  /**
   * Plans or Re-plans a single day itinerary.
   * Considers locked activities, current weather, and transit constraints.
   */
  public static async planSingleDay(
    startLocation: { lat: number; lng: number },
    pois: Activity[],
    constraints: UserConstraints,
    weather: WeatherForecast,
    lockedActivities: { poiId: string; startTime: number; endTime: number }[],
    alreadyScheduledPoiIds: Set<string>
  ): Promise<{
    activities: { poi: Activity; startTime: number; endTime: number; travelTime: number; distance: number }[];
    totalDistance: number;
  }> {
    
    // Sort candidates by score
    const scoredPOIs = pois
      .filter(p => !alreadyScheduledPoiIds.has(p.id) && !lockedActivities.some(l => l.poiId === p.id))
      .map(p => ({
        poi: p,
        score: this.calculateScore(p, constraints.preferredTags, weather)
      }))
      .sort((a, b) => b.score - a.score);

    const schedule: { poi: Activity; startTime: number; endTime: number; travelTime: number; distance: number }[] = [];
    let currentTime = constraints.startTime;
    let currentLocation = startLocation;
    let totalDistance = 0;

    // Convert locked activities list to sorted array
    const sortedLocks = [...lockedActivities].sort((a, b) => a.startTime - b.startTime);

    // We proceed minute-by-minute or event-by-event
    while (currentTime < constraints.endTime) {
      // Check if there is an upcoming locked activity
      const nextLock = sortedLocks.find(l => l.startTime >= currentTime);
      
      // If we are currently in or overlapping a locked window, advance time
      const activeLock = sortedLocks.find(l => currentTime >= l.startTime && currentTime < l.endTime);
      if (activeLock) {
        const lockPoi = pois.find(p => p.id === activeLock.poiId);
        if (lockPoi) {
          const route = await getRoute(currentLocation, lockPoi, constraints.transportMode);
          schedule.push({
            poi: lockPoi,
            startTime: activeLock.startTime,
            endTime: activeLock.endTime,
            travelTime: route.duration,
            distance: route.distance
          });
          totalDistance += route.distance;
          currentLocation = lockPoi;
        }
        currentTime = activeLock.endTime;
        continue;
      }

      // Try to find the best candidate activity
      let bestCandidate = null;
      let bestRoute = null;
      let arrivalTime = 0;
      let departureTime = 0;

      for (const item of scoredPOIs) {
        if (schedule.some(s => s.poi.id === item.poi.id)) continue;

        const route = await getRoute(currentLocation, item.poi, constraints.transportMode);
        const buffer = Math.max(10, Math.ceil(0.15 * route.duration)); // 15% dynamic buffer, min 10m
        const tempArrival = currentTime + route.duration + buffer;
        const tempDeparture = tempArrival + item.poi.dwellTimeMinutes;

        // Check if fits day boundary
        if (tempDeparture > constraints.endTime) continue;

        // Check if overlaps next lock
        if (nextLock && tempDeparture + buffer > nextLock.startTime) continue;

        // Check distance limits
        if (constraints.transportMode === 'foot' && totalDistance + route.distance > constraints.maxWalkingDistanceMeters) {
          continue;
        }

        // Check POI operating hours
        const isOpen = item.poi.openingHours.some(
          w => tempArrival >= w.open && tempDeparture <= w.close
        );
        if (!isOpen) continue;

        bestCandidate = item.poi;
        bestRoute = route;
        arrivalTime = tempArrival;
        departureTime = tempDeparture;
        break; // Found highest scoring valid item!
      }

      if (bestCandidate && bestRoute) {
        schedule.push({
          poi: bestCandidate,
          startTime: arrivalTime,
          endTime: departureTime,
          travelTime: bestRoute.duration,
          distance: bestRoute.distance
        });
        totalDistance += bestRoute.distance;
        currentLocation = bestCandidate;
        currentTime = departureTime;
      } else {
        // If we can't schedule anything, either advance to the next lock or end the day
        if (nextLock) {
          currentTime = nextLock.startTime;
        } else {
          break;
        }
      }
    }

    return { activities: schedule, totalDistance };
  }
}
