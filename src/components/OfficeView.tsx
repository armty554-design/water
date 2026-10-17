import React, { useState, useMemo } from 'react';
import { Member, DeliveryStop, DayOfWeek } from '../types/delivery';
import { MapView } from './MapView';
import { MemberModal } from './MemberModal';
import { autoSequenceStops, AutoSequenceMode } from '../services/autoSequence';
import { parseExcelFile } from '../services/excelParser';
import { saveMembers, saveRoute } from '../services/db';
import { 
  Upload, Sparkles, Save, ChevronUp, ChevronDown, 
  MapPin, Clock, Droplets, CheckCircle2, Search,
  Filter, AlertCircle, FileSpreadsheet, RefreshCw
} from 'lucide-react';

interface OfficeViewProps {
  members: Member[];
  onMembersUpdated: (members: Member[]) => void;
  stops: DeliveryStop[];
  onStopsChange: (stops: DeliveryStop[]) => void;
  selectedTruck: string;
  onTruckChange: (truck: string) => void;
  selectedDay: DayOfWeek;
  onDayChange: (day: DayOfWeek) => void;
  availableTrucks: { truckNo: string; count: number }[];
  onSaveRoute: () => Promise<void>;
  isSaving: boolean;
  onLoadInitialData: () => void;
}

const DAYS_LIST: DayOfWeek[] = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

export const OfficeView: React.FC<OfficeViewProps> = ({
  members,
  onMembersUpdated,
  stops,
  onStopsChange,
  selectedTruck,
  onTruckChange,
  selectedDay,
  onDayChange,
  availableTrucks,
  onSaveRoute,
  isSaving,
  onLoadInitialData
}) => {
  const [selectedStop, setSelectedStop] = useState<DeliveryStop | null>(null);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadSuccessMsg, setUploadSuccessMsg] = useState<string | null>(null);

  // Filtered stops for search
  const filteredStops = useMemo(() => {
    if (!searchQuery.trim()) return stops;
    const q = searchQuery.toLowerCase();
    return stops.filter(s => 
      s.member.name.toLowerCase().includes(q) ||
      s.member.id.toLowerCase().includes(q) ||
      (s.member.receiveType && s.member.receiveType.toLowerCase().includes(q))
    );
  }, [stops, searchQuery]);

  // Handle Excel Upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    setUploadSuccessMsg(null);
    const file = files[0];
    const reader = new FileReader();

    reader.onload = async (event) => {
      try {
        const buffer = event.target?.result as ArrayBuffer;
        const parsed = parseExcelFile(buffer);
        if (parsed.length > 0) {
          await saveMembers(parsed);
          onMembersUpdated(parsed);
          setUploadSuccessMsg(`นำเข้าข้อมูลสำเร็จ ${parsed.length.toLocaleString()} รายการ`);
          setTimeout(() => setUploadSuccessMsg(null), 5000);
        } else {
          alert('ไม่พบข้อมูลสมาชิกในไฟล์ หรือรูปแบบคอลัมน์ไม่ตรงกัน');
        }
      } catch (err) {
        console.error(err);
        alert('เกิดข้อผิดพลาดในการอ่านไฟล์ Excel โปรดตรวจสอบรูปแบบไฟล์');
      } finally {
        setIsUploading(false);
      }
    };

    reader.readAsArrayBuffer(file);
  };

  // Move Stop Up / Down
  const handleMoveStop = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === stops.length - 1) return;

    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    const newStops = [...stops];
    const temp = newStops[index];
    newStops[index] = newStops[targetIndex];
    newStops[targetIndex] = temp;

    // Re-sequence 1..N
    const resequenced = newStops.map((s, idx) => ({ ...s, sequence: idx + 1 }));
    onStopsChange(resequenced);
  };

  // Auto Sequence
  const handleAutoSequence = (mode: AutoSequenceMode) => {
    const sorted = autoSequenceStops(stops, mode, selectedDay);
    onStopsChange(sorted);
  };

  const completedCount = stops.filter(s => s.isCompleted).length;
  const progressPercent = stops.length > 0 ? Math.round((completedCount / stops.length) * 100) : 0;

  return (
    <div className="space-y-6">
      
      {/* Top Banner & Control Bar */}
      <div className="bg-white rounded-3xl p-5 sm:p-6 shadow-sm border border-slate-200 space-y-5">
        
        {/* Row 1: Day of Week Pills & Excel Actions */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          
          {/* Day Pills */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
              เลือกรอบวันจัดส่ง
            </label>
            <div className="flex flex-wrap gap-1.5 sm:gap-2">
              {DAYS_LIST.map((day) => (
                <button
                  key={day}
                  onClick={() => onDayChange(day)}
                  className={`px-3.5 py-1.5 rounded-xl text-xs sm:text-sm font-medium transition-all ${
                    selectedDay === day
                      ? 'bg-brand-600 text-white shadow-md shadow-brand-500/20'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                  }`}
                >
                  {day}
                </button>
              ))}
            </div>
          </div>

          {/* Excel Import & Seed Buttons */}
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs sm:text-sm font-medium cursor-pointer shadow-sm transition">
              <Upload className="w-4 h-4" />
              <span>{isUploading ? 'กำลังอัปโหลด...' : 'อัปโหลด Excel สมาชิก'}</span>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileUpload}
                disabled={isUploading}
                className="hidden"
              />
            </label>

            {members.length === 0 && (
              <button
                onClick={onLoadInitialData}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs sm:text-sm font-medium transition"
              >
                <RefreshCw className="w-4 h-4" />
                <span>โหลดข้อมูลตัวอย่าง</span>
              </button>
            )}
          </div>

        </div>

        {uploadSuccessMsg && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs sm:text-sm flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{uploadSuccessMsg}</span>
          </div>
        )}

        {/* Row 2: Truck Selector & Route Operations */}
        <div className="pt-2 border-t border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
          
          {/* Truck Selector */}
          <div className="flex items-center gap-3">
            <label className="text-xs sm:text-sm font-semibold text-slate-700 whitespace-nowrap">
              เบอร์รถ:
            </label>
            <select
              value={selectedTruck}
              onChange={(e) => onTruckChange(e.target.value)}
              className="text-sm font-medium bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2 focus:ring-2 focus:ring-brand-500 focus:outline-none"
            >
              {availableTrucks.map((t) => (
                <option key={t.truckNo} value={t.truckNo}>
                  รถ {t.truckNo} ({t.count} จุดส่ง)
                </option>
              ))}
            </select>
          </div>

          {/* Auto Sequence Buttons & Save */}
          <div className="flex flex-wrap items-center gap-2">
            
            {/* Auto Sequence Button Group */}
            <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-medium">
              <span className="px-2 text-slate-500 font-semibold flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                จัดคิวออโต้:
              </span>
              <button
                onClick={() => handleAutoSequence('historical')}
                title="เรียงตามเวลาที่เคยส่งจริงในอดีต (ประวัติ 4 รอบล่าสุด)"
                className="px-2.5 py-1.5 hover:bg-white rounded-lg text-slate-700 transition"
              >
                🕒 เวลาจริงในอดีต
              </button>
              <button
                onClick={() => handleAutoSequence('timewindow')}
                title="เรียงตามช่วงเวลานัดหมาย (เช่น 06:00, 08:30, 11:00)"
                className="px-2.5 py-1.5 hover:bg-white rounded-lg text-slate-700 transition"
              >
                ⏰ ช่วงเวลานัด
              </button>
              <button
                onClick={() => handleAutoSequence('gps')}
                title="เรียงตามพิกัด GPS ระยะทางกระชับที่สุด ไม่ขับวนไปวนมา"
                className="px-2.5 py-1.5 hover:bg-white rounded-lg text-slate-700 transition"
              >
                📍 ทางใกล้สุด GPS
              </button>
            </div>

            {/* Save Route Button */}
            <button
              onClick={onSaveRoute}
              disabled={isSaving || stops.length === 0}
              className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-xs sm:text-sm font-semibold shadow-md shadow-brand-500/20 transition disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              <span>{isSaving ? 'กำลังบันทึก...' : 'บันทึกสายส่ง'}</span>
            </button>

          </div>

        </div>

      </div>

      {/* Progress & Summary Bar */}
      {stops.length > 0 && (
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-xs sm:text-sm text-slate-600">
              สายรถ <strong className="text-slate-900">{selectedTruck}</strong> วัน <strong className="text-slate-900">{selectedDay}</strong> มีทั้งหมด <strong className="text-brand-600">{stops.length} จุด</strong>
            </span>
            <span className="text-xs bg-slate-100 text-slate-600 px-2.5 py-0.5 rounded-full font-medium">
              ส่งแล้ว {completedCount}/{stops.length} จุด ({progressPercent}%)
            </span>
          </div>
          
          <div className="w-full sm:w-48 bg-slate-100 h-2 rounded-full overflow-hidden">
            <div 
              className="bg-emerald-500 h-full rounded-full transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Main Grid: Left Map | Right Sequence List */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Interactive Map (7 cols) */}
        <div className="lg:col-span-7 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <MapPin className="w-4 h-4 text-brand-600" />
              <span>แผนที่เส้นทางสายส่ง (Route Map)</span>
            </h3>
            <span className="text-xs text-slate-400">
              คลิกที่หมุดเพื่อดูข้อมูลจุดส่ง
            </span>
          </div>

          <MapView
            stops={stops}
            selectedStop={selectedStop}
            onSelectStop={setSelectedStop}
            userRole="office"
            heightClass="h-[560px]"
          />
        </div>

        {/* Right Column: Ordered Stops List (5 cols) */}
        <div className="lg:col-span-5 space-y-3">
          
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <span>ลำดับการส่ง ({filteredStops.length} จุด)</span>
            </h3>

            {/* Quick search */}
            <div className="relative w-44">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="ค้นหาชื่อ / รหัส..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full text-xs pl-8 pr-2 py-1.5 bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
          </div>

          {/* Stops List Scrollable Container */}
          <div className="bg-white rounded-3xl p-3 shadow-sm border border-slate-200 h-[560px] overflow-y-auto space-y-2">
            {filteredStops.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-400">
                <AlertCircle className="w-10 h-10 mb-2 opacity-50" />
                <p className="text-sm font-medium text-slate-600">ไม่มีรายการส่งน้ำในสายรถและวันนี้</p>
                <p className="text-xs text-slate-400 mt-1">
                  กรุณาเลือกเบอร์รถ หรือรอบวันอื่น หรืออัปโหลดไฟล์ Excel
                </p>
              </div>
            ) : (
              filteredStops.map((stop, index) => {
                const isSelected = selectedStop?.member.id === stop.member.id;
                const timeStr = stop.daySchedule?.timeWindow || stop.member.targetTime || 'ไม่ระบุเวลา';
                const avgBottles = stop.daySchedule?.avgQuantity || 0;
                const actualAvgMin = stop.daySchedule?.avgActualTimeMinutes;
                const actualHour = actualAvgMin ? Math.floor(actualAvgMin / 60) : null;
                const actualMin = actualAvgMin ? (actualAvgMin % 60) : null;
                const actualTimeStr = actualHour !== null ? `${String(actualHour).padStart(2, '0')}:${String(actualMin).padStart(2, '0')} น.` : null;

                return (
                  <div
                    key={stop.member.id}
                    onClick={() => setSelectedStop(stop)}
                    className={`p-3 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                      isSelected
                        ? 'border-brand-500 bg-brand-50/50 shadow-sm'
                        : stop.isCompleted
                        ? 'border-emerald-200 bg-emerald-50/30'
                        : 'border-slate-100 hover:border-slate-200 bg-slate-50/50'
                    }`}
                  >
                    
                    {/* Left: Stop Number & Info */}
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      
                      {/* Sequence Badge */}
                      <div className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-xs font-bold text-white shadow-sm mt-0.5 ${
                        stop.isCompleted ? 'bg-emerald-600' : 'bg-brand-600'
                      }`}>
                        {stop.isCompleted ? '✓' : stop.sequence}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-bold text-xs text-slate-900 truncate">
                            {stop.member.name}
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            ({stop.member.id})
                          </span>
                        </div>

                        {/* Badges: Time Window, Bottles, Receive Type */}
                        <div className="flex items-center gap-2 mt-1 flex-wrap text-[11px]">
                          <span className="inline-flex items-center gap-1 text-slate-600 bg-white px-2 py-0.5 rounded-md border border-slate-200">
                            <Clock className="w-3 h-3 text-brand-500" />
                            {timeStr}
                          </span>

                          <span className="inline-flex items-center gap-1 font-semibold text-brand-700 bg-brand-50 px-2 py-0.5 rounded-md">
                            <Droplets className="w-3 h-3 text-brand-600" />
                            {avgBottles} ถัง
                          </span>

                          {actualTimeStr && (
                            <span className="text-[10px] text-slate-500">
                              (ส่งจริง ~{actualTimeStr})
                            </span>
                          )}
                        </div>

                        <div className="text-[11px] text-slate-500 mt-1 truncate">
                          📍 {stop.member.receiveType}
                        </div>
                      </div>

                    </div>

                    {/* Right: Actions (Up / Down & Edit / Attach) */}
                    <div className="flex flex-col items-center gap-1 shrink-0">
                      <div className="flex items-center gap-0.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMoveStop(index, 'up');
                          }}
                          disabled={index === 0}
                          title="เลื่อนขึ้น"
                          className="p-1 hover:bg-white rounded-lg text-slate-500 hover:text-slate-800 disabled:opacity-30 transition"
                        >
                          <ChevronUp className="w-4 h-4" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMoveStop(index, 'down');
                          }}
                          disabled={index === stops.length - 1}
                          title="เลื่อนลง"
                          className="p-1 hover:bg-white rounded-lg text-slate-500 hover:text-slate-800 disabled:opacity-30 transition"
                        >
                          <ChevronDown className="w-4 h-4" />
                        </button>
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingMember(stop.member);
                        }}
                        className="text-[10px] text-brand-600 hover:text-brand-800 hover:underline font-medium"
                      >
                        แก้ไข/แนบไฟล์
                      </button>
                    </div>

                  </div>
                );
              })
            )}
          </div>

        </div>

      </div>

      {/* Member Details & Attachment Modal */}
      {editingMember && (
        <MemberModal
          member={editingMember}
          onClose={() => setEditingMember(null)}
          onUpdated={(updated) => {
            // Update in stops
            const updatedStops = stops.map(s => 
              s.member.id === updated.id ? { ...s, member: updated } : s
            );
            onStopsChange(updatedStops);
            // Update in members
            const updatedMembers = members.map(m => m.id === updated.id ? updated : m);
            onMembersUpdated(updatedMembers);
          }}
        />
      )}

    </div>
  );
};
