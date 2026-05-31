import Database from 'better-sqlite3';
import path from 'path';

let db: Database.Database;

// For development hot-reloading, preserve the database connection across compilation cycles
const globalObject = globalThis as unknown as { dbInstance: Database.Database };

if (!globalObject.dbInstance) {
  const dbPath = path.resolve(process.cwd(), 'travel_planner.db');
  globalObject.dbInstance = new Database(dbPath);
  
  // Enable foreign keys and WAL mode for high performance concurrency
  globalObject.dbInstance.pragma('foreign_keys = ON');
  globalObject.dbInstance.pragma('journal_mode = WAL');
  
  // Initialize table schemas
  initSchema(globalObject.dbInstance);
}

db = globalObject.dbInstance;

function initSchema(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS trips (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      destination_name TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      is_locked INTEGER DEFAULT 0 NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    );

    CREATE TABLE IF NOT EXISTS trip_constraints (
      trip_id TEXT PRIMARY KEY,
      budget_limit REAL,
      max_walking_distance_meters INTEGER DEFAULT 10000 NOT NULL,
      preferred_tags TEXT DEFAULT '[]' NOT NULL, -- JSON string array
      transport_mode TEXT DEFAULT 'foot' NOT NULL,
      start_time_minutes INTEGER DEFAULT 540 NOT NULL, -- 09:00 AM
      end_time_minutes INTEGER DEFAULT 1080 NOT NULL,  -- 06:00 PM
      accessibility_required INTEGER DEFAULT 0 NOT NULL,
      FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS pois (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      popularity REAL DEFAULT 0.5 NOT NULL,
      tags TEXT DEFAULT '[]' NOT NULL, -- JSON string array
      is_outdoor INTEGER DEFAULT 1 NOT NULL,
      dwell_time_minutes INTEGER DEFAULT 60 NOT NULL,
      opening_hours TEXT DEFAULT '[]' NOT NULL -- JSON representation
    );

    CREATE TABLE IF NOT EXISTS itineraries (
      id TEXT PRIMARY KEY,
      trip_id TEXT NOT NULL,
      version INTEGER DEFAULT 1 NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS day_plans (
      id TEXT PRIMARY KEY,
      itinerary_id TEXT NOT NULL,
      day_number INTEGER NOT NULL,
      weather_summary TEXT, -- JSON string
      total_distance_meters INTEGER DEFAULT 0 NOT NULL,
      FOREIGN KEY (itinerary_id) REFERENCES itineraries(id) ON DELETE CASCADE,
      UNIQUE(itinerary_id, day_number)
    );

    CREATE TABLE IF NOT EXISTS day_plan_activities (
      id TEXT PRIMARY KEY,
      day_plan_id TEXT NOT NULL,
      poi_id TEXT NOT NULL,
      sequence_order INTEGER NOT NULL,
      planned_start_minutes INTEGER NOT NULL,
      planned_end_minutes INTEGER NOT NULL,
      is_locked INTEGER DEFAULT 0 NOT NULL,
      FOREIGN KEY (day_plan_id) REFERENCES day_plans(id) ON DELETE CASCADE,
      FOREIGN KEY (poi_id) REFERENCES pois(id),
      UNIQUE(day_plan_id, sequence_order)
    );

    CREATE TABLE IF NOT EXISTS live_signals (
      id TEXT PRIMARY KEY,
      trip_id TEXT NOT NULL,
      type TEXT NOT NULL, -- 'weather', 'delay', 'closure'
      severity TEXT NOT NULL, -- 'low', 'medium', 'high'
      description TEXT NOT NULL,
      affected_date TEXT NOT NULL,
      resolved INTEGER DEFAULT 0 NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
    );
  `);
}

export { db };
