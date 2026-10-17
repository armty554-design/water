import React, { useState, useMemo } from 'react';
import confetti from 'canvas-confetti';
import { DeliveryStop, DayOfWeek } from '../types/delivery';
import { MapView } from './MapView';
import { 
  Navigation, CheckCircle2, Clock, Droplets, MapPin, 
  RotateCcw, ListFilter, Map, ChevronRight, Phone, AlertCircle, Sparkles, Building2
} from 'lucide-react';

interface DriverViewProps {
  stops: DeliveryStop[];
  onMarkComplete: (memberId: string, isCompleted: boolean) => void;
  selectedTruck: string;
  onTruckChange: (truck: string) => void;
  selectedDay: DayOfWeek;
  onDayChange: (day: DayOfWeek) => void;
  availableTrucks: { truckNo: string; count: number }[];
}

export const DriverView: React.FC<DriverViewProps> = ({
  stops,
  onMarkComplete,
  selectedTruck,
  onTruckChange,
  selectedDay,
  onDayChange,
  availableTrucks
}) => {
  const [viewMode, setViewMode] = useState<'map' | 'list'>('map');
  const [activeStopIndex, setActiveStopIndex] = useState<number>(0);

  // Find the first uncompleted stop
  const currentNextStopIndex = useMemo(() => {
    const idx = stops.findIndex(s => !s.isCompleted);
    return idx !== -1 ? idx : Math.max(0, stops.length - 1);
  }, [stops]);

  // Current active stop to display in hero card
  const currentStop = stops[activeStopIndex] || stops[currentNextStopIndex] || null;

  const completedCount = stops.filter(s => s.isCompleted).length;
  const isAllFinished = stops.length > 0 && completedCount === stops.length;
  const progressPercent = stops.length > 0 ? Math.round((completedCount / stops.length) * 100) : 0;

  // Handle Mark Complete with Confetti
  const handleCompleteCurrentStop = (stop: DeliveryStop) => {
    onMarkComplete(stop.member.id, true);

    // Fire confetti celebration
    try {
      confetti({
        particleCount: 80,
        spread: 60,
        origin: { y: 0.8 }
      });
    } catch (e) {
      // ignore
    }

    // Advance to next uncompleted stop
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
    <div className="space-y-4 max-w-4xl mx-auto pb-10">

      {/* Driver Control Card */}
      <div className="bg-white rounded-3xl p-4 sm:p-5 shadow-sm border border-slate-200">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          
          {/* Truck & Day Pickers */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-2 bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200">
              <span className="text-xs font-semibold text-slate-500">รถ:</span>
              <select
                value={selectedTruck}
                onChange={(e) => onTruckChange(e.target.value)}
                className="bg-transparent font-bold text-slate-900 text-sm focus:outline-none cursor-pointer"
              >
                {availableTrucks.map(t => (
                  <option key={t.truckNo} value={t.truckNo}>
                    รถ {t.truckNo} ({t.count} จุด)
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2 bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200">
              <span className="text-xs font-semibold text-slate-500">วัน:</span>
              <select
                value={selectedDay}
                onChange={(e) => onDayChange(e.target.value as DayOfWeek)}
                className="bg-transparent font-bold text-slate-900 text-sm focus:outline-none cursor-pointer"
              >
                {['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'].map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Mode View Tabs (Map / List) */}
          <div className="flex items-center bg-slate-100 p-1 rounded-xl self-start sm:self-auto">
            <button
              onClick={() => setViewMode('map')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                viewMode === 'map' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600'
              }`}
            >
              <Map className="w-3.5 h-3.5" />
              <span>แผนที่นำทาง</span>
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                viewMode === 'list' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600'
              }`}
            >
              <ListFilter className="w-3.5 h-3.5" />
              <span>รายการทั้งหมด</span>
            </button>
          </div>

        </div>

        {/* Delivery Progress Bar */}
        <div className="mt-4 pt-3 border-t border-slate-100">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="font-semibold text-slate-700">
              ความคืบหน้าการส่งวันนี้:
            </span>
            <span className="font-bold text-brand-600">
              ส่งแล้ว {completedCount} / {stops.length} จุด ({progressPercent}%)
            </span>
          </div>
          <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
            <div
              className="bg-emerald-500 h-full rounded-full transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* When all completed: Congratulations Banner */}
      {isAllFinished && (
        <div className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white rounded-3xl p-6 text-center shadow-lg animate-in zoom-in-95">
          <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3">
            <Sparkles className="w-8 h-8 text-amber-300 animate-spin" />
          </div>
          <h2 className="text-xl font-black">สุดยอดมาก! ส่งน้ำครบทุกจุดแล้ว</h2>
          <p className="text-emerald-100 text-xs sm:text-sm mt-1">
            ท่านได้ทำการส่งน้ำให้แก่สมาชิกครบ {stops.length} จุดเรียบร้อยแล้ว
          </p>
        </div>
      )}

      {/* Main Map Mode */}
      {viewMode === 'map' && (
        <div className="space-y-4">
          
          {/* Full Screen Map View */}
          <div className="relative">
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
              heightClass="h-[460px] sm:h-[500px]"
            />
          </div>

          {/* Current Stop Hero Card (Large & Easy to Tap) */}
          {currentStop && (
            <div className={`rounded-3xl p-5 shadow-lg border transition-all ${
              currentStop.isCompleted
                ? 'bg-emerald-50/80 border-emerald-200'
                : 'bg-white border-slate-200'
            }`}>
              
              {/* Stop Number & Status */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className={`w-9 h-9 rounded-2xl flex items-center justify-center font-black text-sm text-white shadow-md ${
                    currentStop.isCompleted ? 'bg-emerald-600' : 'bg-brand-600'
                  }`}>
                    {currentStop.isCompleted ? '✓' : currentStop.sequence}
                  </span>
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      จุดที่ {currentStop.sequence} จาก {stops.length} จุด
                    </span>
                    <h3 className="text-base sm:text-lg font-black text-slate-900 leading-tight">
                      {currentStop.member.name}
                    </h3>
                  </div>
                </div>

                <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                  currentStop.isCompleted
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-amber-100 text-amber-800'
                }`}>
                  {currentStop.isCompleted ? 'ส่งเสร็จสิ้นแล้ว' : 'รอส่ง'}
                </span>
              </div>

              {/* Delivery Details Pills */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 py-3 border-y border-slate-100 text-xs">
                
                <div className="flex items-center gap-2 bg-slate-50 p-2.5 rounded-xl">
                  <Clock className="w-4 h-4 text-brand-600 shrink-0" />
                  <div>
                    <div className="text-[10px] text-slate-400">ช่วงเวลาส่ง</div>
                    <div className="font-bold text-slate-800">
                      {currentStop.daySchedule?.timeWindow || currentStop.member.targetTime || 'ไม่ระบุ'}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 bg-brand-50/60 p-2.5 rounded-xl">
                  <Droplets className="w-4 h-4 text-brand-600 shrink-0" />
                  <div>
                    <div className="text-[10px] text-brand-600">จำนวนส่งเฉลี่ย</div>
                    <div className="font-bold text-brand-900">
                      {currentStop.daySchedule?.avgQuantity || 0} ถัง
                    </div>
                  </div>
                </div>

                <div className="col-span-2 sm:col-span-1 flex items-center gap-2 bg-slate-50 p-2.5 rounded-xl">
                  <MapPin className="w-4 h-4 text-slate-500 shrink-0" />
                  <div className="truncate">
                    <div className="text-[10px] text-slate-400">เงื่อนไขรับน้ำ</div>
                    <div className="font-bold text-slate-800 truncate">
                      {currentStop.member.receiveType}
                    </div>
                  </div>
                </div>

              </div>

              {/* Big Action Buttons */}
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                
                {/* 1. Google Maps Navigation Button */}
                {currentStop.member.hasGps ? (
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${currentStop.member.lat},${currentStop.member.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 py-3.5 px-4 bg-brand-600 hover:bg-brand-700 text-white rounded-2xl font-bold text-sm shadow-md shadow-brand-500/20 active:scale-98 transition text-center"
                  >
                    <Navigation className="w-5 h-5 animate-pulse" />
                    <span>📍 เปิด Google Maps นำทาง</span>
                  </a>
                ) : (
                  <div className="flex items-center justify-center py-3.5 px-4 bg-slate-100 text-slate-400 rounded-2xl text-xs font-medium">
                    ไม่มีพิกัด GPS สำหรับจุดนี้
                  </div>
                )}

                {/* 2. Complete / Toggle Delivery Button */}
                {currentStop.isCompleted ? (
                  <button
                    onClick={() => onMarkComplete(currentStop.member.id, false)}
                    className="flex items-center justify-center gap-2 py-3.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl font-semibold text-sm transition"
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span>ยกเลิก (เปลี่ยนเป็นยังไม่ส่ง)</span>
                  </button>
                ) : (
                  <button
                    onClick={() => handleCompleteCurrentStop(currentStop)}
                    className="flex items-center justify-center gap-2 py-3.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-bold text-sm shadow-md shadow-emerald-500/20 active:scale-98 transition"
                  >
                    <CheckCircle2 className="w-5 h-5" />
                    <span>✅ ส่งเสร็จสิ้น (ไปจุดถัดไป)</span>
                  </button>
                )}

              </div>

            </div>
          )}

        </div>
      )}

      {/* List Mode for Drivers */}
      {viewMode === 'list' && (
        <div className="bg-white rounded-3xl p-4 shadow-sm border border-slate-200 divide-y divide-slate-100">
          <h3 className="font-bold text-sm text-slate-800 pb-3">
            รายการจุดส่งทั้งหมด ({stops.length} จุด)
          </h3>

          <div className="space-y-2 pt-2">
            {stops.map((stop, idx) => {
              const isCurrent = idx === currentNextStopIndex;
              return (
                <div
                  key={stop.member.id}
                  onClick={() => {
                    setActiveStopIndex(idx);
                    setViewMode('map');
                  }}
                  className={`p-3.5 rounded-2xl transition flex items-center justify-between gap-3 cursor-pointer ${
                    stop.isCompleted
                      ? 'bg-emerald-50/40 text-slate-500'
                      : isCurrent
                      ? 'bg-brand-50 border-2 border-brand-500 shadow-sm'
                      : 'bg-slate-50 hover:bg-slate-100'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0 ${
                      stop.isCompleted ? 'bg-emerald-600' : 'bg-brand-600'
                    }`}>
                      {stop.isCompleted ? '✓' : stop.sequence}
                    </span>

                    <div>
                      <div className="font-bold text-sm text-slate-900">
                        {stop.member.name}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2">
                        <span>🕒 {stop.daySchedule?.timeWindow || stop.member.targetTime || 'ไม่ระบุ'}</span>
                        <span>•</span>
                        <span className="font-semibold text-brand-700">💧 {stop.daySchedule?.avgQuantity || 0} ถัง</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {stop.isCompleted ? (
                      <span className="text-xs text-emerald-600 font-bold flex items-center gap-1">
                        <CheckCircle2 className="w-4 h-4" />
                        ส่งแล้ว
                      </span>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCompleteCurrentStop(stop);
                        }}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold shadow-sm transition"
                      >
                        กดเสร็จ
                      </button>
                    )}
                    <ChevronRight className="w-4 h-4 text-slate-400" />
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
