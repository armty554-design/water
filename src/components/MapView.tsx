import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import { DeliveryStop, UserRole } from '../types/delivery';

interface MapViewProps {
  stops: DeliveryStop[];
  selectedStop?: DeliveryStop | null;
  onSelectStop?: (stop: DeliveryStop) => void;
  onMarkComplete?: (memberId: string, isCompleted: boolean) => void;
  userRole?: UserRole;
  currentStopIndex?: number;
  heightClass?: string;
}

export const MapView: React.FC<MapViewProps> = ({
  stops,
  selectedStop,
  onSelectStop,
  onMarkComplete,
  userRole = 'office',
  currentStopIndex = 0,
  heightClass = 'h-[500px]'
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const polylineRef = useRef<L.Polyline | null>(null);

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapInstanceRef.current) return;

    // Default center (Bangkok vicinity or center of Thailand)
    const map = L.map(mapContainerRef.current, {
      center: [13.7563, 100.5018],
      zoom: 11,
      zoomControl: true
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    markersLayerRef.current = L.layerGroup().addTo(map);
    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Update Markers & Polyline when stops change
  useEffect(() => {
    const map = mapInstanceRef.current;
    const markersLayer = markersLayerRef.current;
    if (!map || !markersLayer) return;

    markersLayer.clearLayers();
    if (polylineRef.current) {
      polylineRef.current.remove();
      polylineRef.current = null;
    }

    const validStops = stops.filter(s => s.member.hasGps && s.member.lat && s.member.lng);
    if (validStops.length === 0) return;

    const latLngs: L.LatLngTuple[] = [];

    validStops.forEach((stop, index) => {
      const lat = stop.member.lat;
      const lng = stop.member.lng;
      latLngs.push([lat, lng]);

      const isCompleted = stop.isCompleted;
      const isNext = index === currentStopIndex;
      const isSelected = selectedStop?.member.id === stop.member.id;

      // Color coding:
      // Green = Completed
      // Amber/Orange = Next in line
      // Blue = Normal upcoming
      // Purple = Selected
      let bgColor = 'bg-brand-600 text-white border-white';
      let ringEffect = '';

      if (isCompleted) {
        bgColor = 'bg-emerald-600 text-white border-emerald-100';
      } else if (isSelected) {
        bgColor = 'bg-violet-600 text-white border-white scale-125';
        ringEffect = 'ring-4 ring-violet-300';
      } else if (isNext && userRole === 'driver') {
        bgColor = 'bg-amber-500 text-white border-white scale-125 animate-bounce';
        ringEffect = 'ring-4 ring-amber-300';
      }

      const customIcon = L.divIcon({
        className: 'custom-map-marker',
        html: `
          <div class="relative flex items-center justify-center transition-all">
            <div class="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shadow-lg border-2 ${bgColor} ${ringEffect}">
              ${isCompleted ? '✓' : stop.sequence}
            </div>
            ${isNext && userRole === 'driver' && !isCompleted ? `
              <span class="absolute -top-6 px-1.5 py-0.5 rounded bg-amber-600 text-[10px] font-bold text-white shadow whitespace-nowrap">
                จุดถัดไป
              </span>
            ` : ''}
          </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        popupAnchor: [0, -18]
      });

      const marker = L.marker([lat, lng], { icon: customIcon });

      const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
      const timeWindow = stop.daySchedule?.timeWindow || stop.member.targetTime || 'ไม่ระบุ';
      const avgQty = stop.daySchedule?.avgQuantity || 0;

      const popupContent = document.createElement('div');
      popupContent.className = 'p-1 text-slate-800 font-sans';
      popupContent.innerHTML = `
        <div class="border-b border-slate-200 pb-2 mb-2">
          <div class="flex items-center gap-1.5">
            <span class="px-2 py-0.5 text-xs font-bold rounded-full ${isCompleted ? 'bg-emerald-100 text-emerald-800' : 'bg-brand-100 text-brand-800'}">
              จุดที่ ${stop.sequence} ${isCompleted ? '(ส่งแล้ว)' : ''}
            </span>
            <span class="text-xs text-slate-500">${stop.member.id}</span>
          </div>
          <h4 class="font-bold text-sm text-slate-900 mt-1">${stop.member.name}</h4>
        </div>
        
        <div class="space-y-1 text-xs text-slate-600 mb-3">
          <div class="flex justify-between">
            <span class="text-slate-500">🕒 ช่วงเวลา:</span>
            <span class="font-semibold text-slate-800">${timeWindow}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-slate-500">💧 ยอดเฉลี่ย:</span>
            <span class="font-semibold text-brand-700">${avgQty} ถัง</span>
          </div>
          <div class="flex justify-between">
            <span class="text-slate-500">📦 รับน้ำ:</span>
            <span class="font-medium text-slate-700 truncate max-w-[150px]">${stop.member.receiveType}</span>
          </div>
        </div>

        <div class="flex flex-col gap-1.5 pt-1">
          <a href="${googleMapsUrl}" target="_blank" rel="noopener noreferrer" 
             class="flex items-center justify-center gap-1 px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-xs font-medium shadow-sm transition">
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="3 11 22 2 13 21 11 13 3 11"/>
            </svg>
            เปิด Google Maps นำทาง
          </a>
        </div>
      `;

      // If driver view, add a quick toggle complete button in popup
      if (onMarkComplete) {
        const toggleBtn = document.createElement('button');
        toggleBtn.className = `w-full mt-1 px-3 py-1.5 rounded-lg text-xs font-medium text-white shadow-sm transition ${
          isCompleted ? 'bg-amber-600 hover:bg-amber-700' : 'bg-emerald-600 hover:bg-emerald-700'
        }`;
        toggleBtn.innerText = isCompleted ? '↩ ยกเลิกส่งแล้ว' : '✅ บันทึกว่าส่งเสร็จสิ้น';
        toggleBtn.onclick = () => {
          onMarkComplete(stop.member.id, !isCompleted);
          map.closePopup();
        };
        popupContent.appendChild(toggleBtn);
      }

      marker.bindPopup(popupContent);

      marker.on('click', () => {
        if (onSelectStop) onSelectStop(stop);
      });

      markersLayer.addLayer(marker);
    });

    // Draw route polyline
    if (latLngs.length > 1) {
      polylineRef.current = L.polyline(latLngs, {
        color: '#0284c7',
        weight: 3.5,
        opacity: 0.75,
        dashArray: '6, 6',
        lineCap: 'round'
      }).addTo(map);
    }

    // Fit map bounds to encompass all valid points
    if (latLngs.length > 0) {
      const bounds = L.latLngBounds(latLngs);
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
    }
  }, [stops, selectedStop, currentStopIndex, userRole, onSelectStop, onMarkComplete]);

  return (
    <div className={`relative w-full ${heightClass} rounded-2xl overflow-hidden border border-slate-200 shadow-sm`}>
      <div ref={mapContainerRef} className="w-full h-full z-10" />

      {/* Map Legend */}
      <div className="absolute bottom-3 left-3 z-[400] bg-white/90 backdrop-blur-md px-3 py-2 rounded-xl text-xs shadow-md border border-slate-200 flex items-center space-x-3">
        <div className="flex items-center space-x-1">
          <span className="w-3 h-3 rounded-full bg-brand-600 inline-block"></span>
          <span className="text-slate-600">จุดรอส่ง</span>
        </div>
        <div className="flex items-center space-x-1">
          <span className="w-3 h-3 rounded-full bg-emerald-600 inline-block"></span>
          <span className="text-slate-600">ส่งแล้ว</span>
        </div>
        {userRole === 'driver' && (
          <div className="flex items-center space-x-1">
            <span className="w-3 h-3 rounded-full bg-amber-500 inline-block"></span>
            <span className="text-slate-600 font-medium">จุดถัดไป</span>
          </div>
        )}
      </div>

      {stops.filter(s => s.member.hasGps).length === 0 && (
        <div className="absolute inset-0 z-[400] bg-slate-900/10 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white p-4 rounded-xl shadow-lg text-center max-w-sm">
            <p className="text-sm font-medium text-slate-800">ไม่มีข้อมูลพิกัด GPS ในสายส่งนี้</p>
            <p className="text-xs text-slate-500 mt-1">
              โปรดตรวจสอบไฟล์ข้อมูลสมาชิกหรือเลือกสายรถ/วันอื่น
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
