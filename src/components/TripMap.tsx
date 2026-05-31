'use client';

import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet icons issues in Next.js by using customized DivIcon
const createCustomIcon = (index: number) => {
  return L.divIcon({
    html: `
      <div class="relative flex items-center justify-center">
        <div class="absolute w-8 h-8 rounded-full bg-emerald-500/20 animate-ping"></div>
        <div class="w-7 h-7 rounded-full bg-emerald-500 border border-slate-950 shadow-md flex items-center justify-center text-slate-950 font-bold text-xs">
          ${index}
        </div>
      </div>
    `,
    className: 'custom-map-marker',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
};

const formatTime = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
};

// Component to dynamically adjust map center when coordinates change
function ChangeView({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, 12);
  }, [center, map]);
  return null;
}

interface MapActivity {
  poi: {
    name: string;
    lat: number;
    lng: number;
  };
  sequenceOrder: number;
  plannedStartMinutes: number;
  plannedEndMinutes: number;
}

interface TripMapProps {
  center: [number, number];
  activities: MapActivity[];
}

export default function TripMap({ center, activities }: TripMapProps) {
  // Extract coordinate list for drawing path line
  const polylineCoords = activities
    .sort((a, b) => a.sequenceOrder - b.sequenceOrder)
    .map(act => [act.poi.lat, act.poi.lng] as [number, number]);

  return (
    <div className="w-full h-full min-h-[350px] md:min-h-0 rounded-2xl overflow-hidden border border-slate-800/80 shadow-2xl relative z-10">
      <MapContainer 
        center={center} 
        zoom={12} 
        scrollWheelZoom={true}
        className="w-full h-full z-0 bg-slate-950"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />
        
        <ChangeView center={center} />

        {/* Path line between activities */}
        {polylineCoords.length > 1 && (
          <Polyline 
            positions={polylineCoords} 
            color="#10b981" // emerald-500
            weight={3} 
            dashArray="6, 6" 
            opacity={0.8}
          />
        )}

        {/* Markers for each POI */}
        {activities.map((act, index) => (
          <Marker
            key={index}
            position={[act.poi.lat, act.poi.lng]}
            icon={createCustomIcon(act.sequenceOrder)}
          >
            <Popup>
              <div className="p-1 min-w-[120px]">
                <p className="font-bold text-xs text-slate-950 mb-1">{act.poi.name}</p>
                <div className="flex justify-between items-center text-[10px] text-slate-550 border-t border-slate-200 pt-1">
                  <span>Stop {act.sequenceOrder}</span>
                  <span className="font-mono text-emerald-600 bg-emerald-50 px-1 py-0.5 rounded font-semibold">
                    {formatTime(act.plannedStartMinutes)}
                  </span>
                </div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
