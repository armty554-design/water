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

  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [13.7563, 100.5018],
      zoom: 11,
      zoomControl: true
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    }).addTo(map);

    markersLayerRef.current = L.layerGroup().addTo(map);
    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

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

      let markerBg = '#2563eb'; // blue-600
      let textColor = '#ffffff';
      let border = '2px solid #ffffff';

      if (isCompleted) {
        markerBg = '#10b981'; // emerald-500
      } else if (isSelected) {
        markerBg = '#1e293b'; // slate-800
        border = '2px solid #60a5fa';
      } else if (isNext && userRole === 'driver') {
        markerBg = '#f59e0b'; // amber-500
        border = '2px solid #ffffff';
      }

      const customIcon = L.divIcon({
        className: 'clean-map-marker',
        html: `
          <div style="background-color: ${markerBg}; color: ${textColor}; border: ${border}; width: 26px; height: 26px; border-radius: 9999px; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; box-shadow: 0 2px 4px rgba(0,0,0,0.25);">
            ${isCompleted ? '✓' : stop.sequence}
          </div>
        `,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
        popupAnchor: [0, -14]
      });

      const marker = L.marker([lat, lng], { icon: customIcon });

      const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
      const timeWindow = stop.daySchedule?.timeWindow || stop.member.targetTime || 'ไม่ระบุ';
      const avgQty = stop.daySchedule?.avgQuantity || 0;

      const popupContent = document.createElement('div');
      popupContent.className = 'text-slate-800';
      popupContent.innerHTML = `
        <div style="border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; margin-bottom: 8px;">
          <div style="font-size: 11px; color: #64748b; font-weight: 600;">
            ลำดับที่ ${stop.sequence} ${isCompleted ? '(ส่งมอบแล้ว)' : ''} | รหัส: ${stop.member.id}
          </div>
          <div style="font-weight: 700; font-size: 13px; color: #0f172a; margin-top: 2px;">
            ${stop.member.name}
          </div>
        </div>
        
        <table style="width: 100%; font-size: 11px; margin-bottom: 10px; border-collapse: collapse;">
          <tr>
            <td style="color: #64748b; padding: 2px 0;">ช่วงเวลาส่ง:</td>
            <td style="font-weight: 600; text-align: right;">${timeWindow}</td>
          </tr>
          <tr>
            <td style="color: #64748b; padding: 2px 0;">ยอดเฉลี่ย:</td>
            <td style="font-weight: 600; text-align: right; color: #0284c7;">${avgQty} ถัง</td>
          </tr>
          <tr>
            <td style="color: #64748b; padding: 2px 0;">ประเภทรับน้ำ:</td>
            <td style="font-weight: 500; text-align: right; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${stop.member.receiveType}</td>
          </tr>
        </table>

        <div style="display: flex; flex-direction: column; gap: 4px;">
          <a href="${googleMapsUrl}" target="_blank" rel="noopener noreferrer" 
             style="display: block; text-align: center; padding: 6px 10px; background-color: #2563eb; color: #ffffff; border-radius: 6px; font-size: 11px; font-weight: 600; text-decoration: none;">
            เปิด Google Maps นำทาง
          </a>
        </div>
      `;

      if (onMarkComplete) {
        const toggleBtn = document.createElement('button');
        toggleBtn.style.cssText = `
          width: 100%; margin-top: 4px; padding: 6px 10px; border-radius: 6px; font-size: 11px; font-weight: 600; color: #ffffff; cursor: pointer; border: none;
          background-color: ${isCompleted ? '#d97706' : '#10b981'};
        `;
        toggleBtn.innerText = isCompleted ? 'ยกเลิกสถานะส่งมอบ' : 'ยืนยันส่งมอบสำเร็จ';
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

    if (latLngs.length > 1) {
      polylineRef.current = L.polyline(latLngs, {
        color: '#2563eb',
        weight: 2.5,
        opacity: 0.8,
        dashArray: '4, 4'
      }).addTo(map);
    }

    if (latLngs.length > 0) {
      const bounds = L.latLngBounds(latLngs);
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 16 });
    }
  }, [stops, selectedStop, currentStopIndex, userRole, onSelectStop, onMarkComplete]);

  return (
    <div className={`relative w-full ${heightClass} rounded-xl overflow-hidden border border-slate-200 bg-slate-50`}>
      <div ref={mapContainerRef} className="w-full h-full z-10" />

      {/* Subtle Legend */}
      <div className="absolute bottom-2.5 left-2.5 z-[400] bg-white/95 backdrop-blur px-2.5 py-1.5 rounded-md text-[11px] shadow-sm border border-slate-200 flex items-center space-x-3 text-slate-600">
        <div className="flex items-center space-x-1">
          <span className="w-2.5 h-2.5 rounded-full bg-blue-600 inline-block"></span>
          <span>รอดำเนินการ</span>
        </div>
        <div className="flex items-center space-x-1">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block"></span>
          <span>ส่งมอบแล้ว</span>
        </div>
        {userRole === 'driver' && (
          <div className="flex items-center space-x-1">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block"></span>
            <span>จุดปัจจุบัน</span>
          </div>
        )}
      </div>

      {stops.filter(s => s.member.hasGps).length === 0 && (
        <div className="absolute inset-0 z-[400] bg-slate-900/10 flex items-center justify-center p-4">
          <div className="bg-white p-4 rounded-lg shadow-sm border border-slate-200 text-center max-w-sm">
            <p className="text-xs font-semibold text-slate-700">ไม่พบพิกัด GPS ในสายส่งนี้</p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              โปรดตรวจสอบข้อมูลสมาชิกหรือเลือกสายรถอื่น
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
