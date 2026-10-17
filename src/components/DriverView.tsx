import React, { useState, useMemo } from 'react';
import { DeliveryStop, DayOfWeek } from '../types/delivery';
import { MapView } from './MapView';
import { formatDateThai, getTodayDateKey, getRelativeDateKey } from '../services/weekHelper';
import { TruckSelector } from './TruckSelector';

interface DriverViewProps {
  stops: DeliveryStop[];
  onMarkComplete: (memberId: string, isCompleted: boolean) => void;
  selectedTruck: string;
  onTruckChange: (truck: string) => void;
  selectedDay: DayOfWeek;
  onDayChange: (day: DayOfWeek) => void;
  selectedDate: string;
  onDateChange: (date: string) => void;
  availableTrucks: { truckNo: string; count: number }[];
}

export const DriverView: React.FC<DriverViewProps> = ({
  stops,
  onMarkComplete,
  selectedTruck,
  onTruckChange,
  selectedDay,
  onDayChange,
  selectedDate,
  onDateChange,
  availableTrucks
}) => {
  const [viewMode, setViewMode] = useState<'map' | 'list'>('map');
  const [activeStopIndex, setActiveStopIndex] = useState<number>(0);

  const currentNextStopIndex = useMemo(() => {
    const idx = stops.findIndex(s => !s.isCompleted);
    return idx !== -1 ? idx : Math.max(0, stops.length - 1);
  }, [stops]);

  const currentStop = stops[activeStopIndex] || stops[currentNextStopIndex] || null;

  const completedCount = stops.filter(s => s.isCompleted).length;
  const isAllFinished = stops.length > 0 && completedCount === stops.length;
  const progressPercent = stops.length > 0 ? Math.round((completedCount / stops.length) * 100) : 0;

  const handleCompleteCurrentStop = (stop: DeliveryStop) => {
    onMarkComplete(stop.member.id, true);

    const nextIdx = stops.findIndex((s, i) => i > activeStopIndex && !s.isCompleted);
    if (nextIdx !== -1) {
      setActiveStopIndex(nextIdx);
    } else {
      const anyUnfinished = stops.findIndex(s => !s.isCompleted && s.member.id !== stop.member.id);
      if (anyUnfinished !== -1) {
        setActiveStopIndex(anyUnfinished);
      }
    }
  };

  return (
    <div className="space-y-3 max-w-4xl mx-auto pb-8">

      {/* Driver Control Card */}
      <div className="bg-white rounded-xl border border-slate-200 p-3 sm:p-4 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          
          {/* Truck & Date Pickers */}
          <div className="flex items-center gap-2.5 flex-wrap">
            <div className="flex items-center gap-1.5 text-xs">
              <span className="font-semibold text-slate-500">สายรถ:</span>
              <TruckSelector
                value={selectedTruck}
                onChange={onTruckChange}
                availableTrucks={availableTrucks}
              />
            </div>

            {/* Quick date pills */}
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
              <button
                onClick={() => onDateChange(getTodayDateKey())}
                className={`px-2 py-1 rounded transition ${
                  selectedDate === getTodayDateKey() ? 'bg-white font-bold text-slate-900 shadow-xs' : 'text-slate-600'
                }`}
              >
                วันนี้
              </button>
              <button
                onClick={() => onDateChange(getRelativeDateKey(1))}
                className={`px-2 py-1 rounded transition ${
                  selectedDate === getRelativeDateKey(1) ? 'bg-white font-bold text-slate-900 shadow-xs' : 'text-slate-600'
                }`}
              >
                พรุ่งนี้
              </button>
            </div>

            <input
              type="date"
              value={selectedDate}
              onChange={(e) => onDateChange(e.target.value)}
              className="text-xs px-2 py-1 bg-slate-50 border border-slate-300 rounded-lg font-bold text-slate-900 focus:outline-none cursor-pointer"
            />
          </div>

          {/* Mode Switcher */}
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
            <button
              onClick={() => setViewMode('map')}
              className={`px-3 py-1 rounded font-medium transition ${
                viewMode === 'map' ? 'bg-white text-slate-900 shadow-sm border border-slate-200' : 'text-slate-600'
              }`}
            >
              แผนที่นำทาง
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-1 rounded font-medium transition ${
                viewMode === 'list' ? 'bg-white text-slate-900 shadow-sm border border-slate-200' : 'text-slate-600'
              }`}
            >
              รายการจุดส่ง ({stops.length})
            </button>
          </div>

        </div>

        {/* Progress Bar */}
        <div className="mt-3 pt-2.5 border-t border-slate-100">
          <div className="flex items-center justify-between text-xs mb-1 text-slate-600">
            <span>ความคืบหน้าวันนี้:</span>
            <span className="font-semibold text-slate-900">
              ส่งมอบแล้ว {completedCount} / {stops.length} จุด ({progressPercent}%)
            </span>
          </div>
          <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden border border-slate-200">
            <div
              className="bg-emerald-500 h-full rounded-full transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Completion Banner */}
      {isAllFinished && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl p-4 text-center">
          <div className="font-bold text-sm">การจัดส่งครบถ้วนทุกจุดในสายส่งนี้แล้ว</div>
          <p className="text-xs text-emerald-700 mt-0.5">
            ส่งมอบน้ำดื่มครบทั้ง {stops.length} จุดเรียบร้อยแล้ว
          </p>
        </div>
      )}

      {/* Map View Mode */}
      {viewMode === 'map' && (
        <div className="space-y-3">
          
          <MapView
            stops={stops}
            selectedStop={currentStop}
            onSelectStop={(stop) => {
              const idx = stops.findIndex(s => s.member.id === stop.member.id);
              if (idx !== -1) setActiveStopIndex(idx);
            }}
            onMarkComplete={onMarkComplete}
            userRole="driver"
            currentStopIndex={currentNextStopIndex}
            heightClass="h-[440px] sm:h-[480px]"
          />

          {/* Current Stop Hero Card */}
          {currentStop && (
            <div className={`rounded-xl p-4 border transition ${
              currentStop.isCompleted
                ? 'bg-emerald-50/70 border-emerald-200'
                : 'bg-white border-slate-200 shadow-sm'
            }`}>
              
              <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-2">
                  <span className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs text-white ${
                    currentStop.isCompleted ? 'bg-emerald-600' : 'bg-slate-900'
                  }`}>
                    {currentStop.isCompleted ? '✓' : currentStop.sequence}
                  </span>
                  <div>
                    <span className="text-[10px] uppercase font-semibold text-slate-500">
                      ลำดับที่ {currentStop.sequence} จาก {stops.length} รายการ
                    </span>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <h3 className="text-sm sm:text-base font-bold text-slate-900 leading-tight">
                        {currentStop.member.name}
                      </h3>
                      <span className="text-[10px] px-1.5 py-0.2 rounded border bg-slate-50 text-slate-700 border-slate-200">
                        {currentStop.member.deliveryCondition || 'รอบปกติ'}
                      </span>
                    </div>
                  </div>
                </div>

                <span className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${
                  currentStop.isCompleted
                    ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                    : 'bg-slate-100 text-slate-700 border-slate-200'
                }`}>
                  {currentStop.isCompleted ? 'ส่งมอบแล้ว' : 'รอดำเนินการ'}
                </span>
              </div>

              {/* Data Table */}
              <div className="grid grid-cols-3 gap-2 py-2 border-y border-slate-100 text-xs">
                <div>
                  <div className="text-[10px] text-slate-500">ช่วงเวลาส่ง</div>
                  <div className="font-semibold text-slate-800 mt-0.5">
                    {currentStop.daySchedule?.timeWindow || currentStop.member.targetTime || 'ไม่ระบุ'}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] text-slate-500">ยอดส่งเฉลี่ย</div>
                  <div className="font-semibold text-blue-700 mt-0.5">
                    {currentStop.daySchedule?.avgQuantity || 0} ถัง
                  </div>
                </div>

                <div>
                  <div className="text-[10px] text-slate-500">ประเภทรับน้ำ</div>
                  <div className="font-semibold text-slate-800 mt-0.5 truncate">
                    {currentStop.member.receiveType}
                  </div>
                </div>
              </div>

              {/* Address Row in Hero Card */}
              <div className="text-xs text-slate-800 bg-slate-50 p-2.5 rounded-lg border border-slate-200 flex items-start gap-1.5 mt-2.5">
                <span className="font-bold text-slate-800 shrink-0">ที่อยู่จัดส่ง:</span>
                <span className="font-medium text-slate-900 break-words leading-relaxed">
                  {currentStop.member.address || currentStop.member.warningNotes || currentStop.member.receiveType || 'ตามพิกัด GPS'}
                </span>
              </div>

              {/* Action Buttons */}
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                
                {currentStop.member.hasGps ? (
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${currentStop.member.lat},${currentStop.member.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-medium text-xs shadow-sm transition text-center"
                  >
                    เปิด Google Maps นำทาง
                  </a>
                ) : (
                  <div className="flex items-center justify-center py-2.5 px-4 bg-slate-100 text-slate-400 rounded-lg text-xs font-medium border border-slate-200">
                    ไม่มีพิกัด GPS
                  </div>
                )}

                {currentStop.isCompleted ? (
                  <button
                    onClick={() => onMarkComplete(currentStop.member.id, false)}
                    className="flex items-center justify-center py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium text-xs border border-slate-300 transition"
                  >
                    ยกเลิกสถานะส่งมอบ
                  </button>
                ) : (
                  <button
                    onClick={() => handleCompleteCurrentStop(currentStop)}
                    className="flex items-center justify-center py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold text-xs shadow-sm transition"
                  >
                    ยืนยันส่งมอบสำเร็จ
                  </button>
                )}

              </div>

            </div>
          )}

          {/* Quick Stops Queue below Map */}
          <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 text-xs font-semibold text-slate-700">
              <span>คิวจัดส่งในสายนี้ ({stops.length} จุด)</span>
              <button
                onClick={() => setViewMode('list')}
                className="text-blue-600 hover:underline text-[11px] font-medium"
              >
                ดูมุมมองรายการแบบเต็ม &gt;
              </button>
            </div>

            <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
              {stops.map((stop, idx) => {
                const isSelected = activeStopIndex === idx;
                return (
                  <div
                    key={stop.member.id}
                    onClick={() => setActiveStopIndex(idx)}
                    className={`py-2 px-1.5 flex items-start justify-between gap-2 cursor-pointer transition text-xs ${
                      isSelected ? 'bg-blue-50/60 rounded-lg font-medium' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start gap-2 flex-1 min-w-0">
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 mt-0.5 ${
                        stop.isCompleted ? 'bg-emerald-600' : 'bg-slate-800'
                      }`}>
                        {stop.isCompleted ? '✓' : stop.sequence}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-semibold text-slate-900">{stop.member.name}</span>
                          <span className="text-[10px] text-slate-400">({stop.daySchedule?.avgQuantity || 0} ถัง)</span>
                        </div>
                        <div className="text-[11px] text-slate-600 truncate">
                          {stop.member.address || stop.member.warningNotes || stop.member.receiveType || 'ตามพิกัด GPS'}
                        </div>
                      </div>
                    </div>

                    <div className="shrink-0 text-right">
                      {stop.isCompleted ? (
                        <span className="text-[10px] text-emerald-600 font-semibold">ส่งแล้ว</span>
                      ) : (
                        <span className="text-[10px] text-slate-400">
                          {stop.daySchedule?.timeWindow || 'ไม่ระบุเวลา'}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

        </div>
      )}

      {/* List Mode */}
      {viewMode === 'list' && (
        <div className="bg-white rounded-xl border border-slate-200 p-3 sm:p-4 shadow-sm divide-y divide-slate-100">
          <div className="flex items-center justify-between font-semibold text-xs text-slate-700 pb-3">
            <span>รายการจุดส่งทั้งหมด ({stops.length} จุด)</span>
            <span className="text-slate-500 font-normal text-[11px]">
              ส่งมอบแล้ว {completedCount}/{stops.length} จุด
            </span>
          </div>

          <div className="space-y-2 pt-3">
            {stops.map((stop, idx) => {
              const isCurrent = idx === currentNextStopIndex;
              return (
                <div
                  key={stop.member.id}
                  onClick={() => {
                    setActiveStopIndex(idx);
                    setViewMode('map');
                  }}
                  className={`p-3 rounded-xl transition cursor-pointer text-xs border ${
                    stop.isCompleted
                      ? 'bg-slate-50/70 border-slate-200 text-slate-500'
                      : isCurrent
                      ? 'bg-blue-50/70 border-blue-400 shadow-xs'
                      : 'bg-white border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2.5">
                    
                    {/* Left: Sequence + Member Info */}
                    <div className="flex items-start gap-2.5 flex-1 min-w-0">
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0 mt-0.5 ${
                        stop.isCompleted ? 'bg-emerald-600' : 'bg-slate-900'
                      }`}>
                        {stop.isCompleted ? '✓' : stop.sequence}
                      </span>

                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[10px] text-slate-400 font-mono">#{stop.member.id}</span>
                          <span className="font-bold text-slate-900 text-xs sm:text-sm">
                            {stop.member.name}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.2 rounded border bg-slate-50 text-slate-600 border-slate-200">
                            {stop.member.deliveryCondition || 'รอบปกติ'}
                          </span>
                        </div>

                        {/* Address Row (แสดงที่อยู่จัดส่งชัดเจน) */}
                        <div className="text-[11px] bg-slate-50 p-2 rounded-lg border border-slate-100 flex items-start gap-1">
                          <span className="font-semibold text-slate-700 shrink-0">ที่อยู่:</span>
                          <span className="text-slate-800 font-medium break-words leading-relaxed">
                            {stop.member.address || stop.member.warningNotes || stop.member.receiveType || 'ตามพิกัด GPS'}
                          </span>
                        </div>

                        {/* Meta: Time, Quantity, Receive Type */}
                        <div className="flex items-center gap-3 text-[11px] text-slate-500 flex-wrap pt-0.5">
                          <span>เวลาส่ง: <strong className="text-slate-800 font-semibold">{stop.daySchedule?.timeWindow || stop.member.targetTime || 'ไม่ระบุ'}</strong></span>
                          <span>ยอดส่ง: <strong className="text-blue-700 font-semibold">{stop.daySchedule?.avgQuantity || 0} ถัง</strong></span>
                          <span>รับน้ำ: <strong className="text-slate-700 font-normal">{stop.member.receiveType}</strong></span>
                        </div>
                      </div>
                    </div>

                    {/* Right: Actions */}
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      {stop.member.hasGps && (
                        <a
                          href={`https://www.google.com/maps/dir/?api=1&destination=${stop.member.lat},${stop.member.lng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="px-2 py-1 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded text-[11px] font-medium text-slate-700 flex items-center gap-1 transition"
                          title="เปิดแผนที่นำทาง"
                        >
                          Google Maps
                        </a>
                      )}

                      {stop.isCompleted ? (
                        <span className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded font-semibold">
                          ส่งมอบแล้ว
                        </span>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCompleteCurrentStop(stop);
                          }}
                          className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[11px] font-semibold shadow-xs transition"
                        >
                          เสร็จสิ้น
                        </button>
                      )}
                    </div>

                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

    </div>
  );
};
