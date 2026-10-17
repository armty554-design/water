import React, { useState, useMemo } from 'react';
import { Member, DeliveryStop, DayOfWeek } from '../types/delivery';
import { DeliveryConditionFilter } from '../services/weekHelper';
import { syncMembersWithDiff, SyncDiffReport } from '../services/memberSync';
import { MapView } from './MapView';
import { MemberModal } from './MemberModal';
import { AddStopModal } from './AddStopModal';
import { SyncReportModal } from './SyncReportModal';
import { autoSequenceStops, AutoSequenceMode } from '../services/autoSequence';
import { parseExcelFile } from '../services/excelParser';
import { saveMembers } from '../services/db';

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
  conditionFilter: DeliveryConditionFilter;
  onConditionFilterChange: (filter: DeliveryConditionFilter) => void;
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
  onLoadInitialData,
  conditionFilter,
  onConditionFilterChange
}) => {
  const [selectedStop, setSelectedStop] = useState<DeliveryStop | null>(null);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadSuccessMsg, setUploadSuccessMsg] = useState<string | null>(null);
  const [syncReport, setSyncReport] = useState<SyncDiffReport | null>(null);

  const filteredStops = useMemo(() => {
    if (!searchQuery.trim()) return stops;
    const q = searchQuery.toLowerCase();
    return stops.filter(s => 
      s.member.name.toLowerCase().includes(q) ||
      s.member.id.toLowerCase().includes(q) ||
      (s.member.receiveType && s.member.receiveType.toLowerCase().includes(q)) ||
      (s.member.deliveryCondition && s.member.deliveryCondition.toLowerCase().includes(q))
    );
  }, [stops, searchQuery]);

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
        const incoming = parseExcelFile(buffer);
        if (incoming.length > 0) {
          const report = await syncMembersWithDiff(members, incoming);
          await saveMembers(report.mergedMembers);
          onMembersUpdated(report.mergedMembers);
          setSyncReport(report);
          setUploadSuccessMsg(`อัปเดตข้อมูลสำเร็จ: สมาชิกใหม่ +${report.addedCount} ราย, เปลี่ยนแปลง ${report.updatedCount} ราย, ลบออกจากสายเดิม ${report.cleanedRoutesCount} จุด`);
          setTimeout(() => setUploadSuccessMsg(null), 6000);
        } else {
          alert('ไม่พบข้อมูลในไฟล์ Excel หรือโครงสร้างคอลัมน์ไม่ถูกต้อง');
        }
      } catch (err) {
        console.error(err);
        alert('เกิดข้อผิดพลาดในการประมวลผลไฟล์ Excel');
      } finally {
        setIsUploading(false);
      }
    };

    reader.readAsArrayBuffer(file);
  };

  const handleMoveStop = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === stops.length - 1) return;

    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    const newStops = [...stops];
    const temp = newStops[index];
    newStops[index] = newStops[targetIndex];
    newStops[targetIndex] = temp;

    const resequenced = newStops.map((s, idx) => ({ ...s, sequence: idx + 1 }));
    onStopsChange(resequenced);
  };

  const handleRemoveStop = (memberId: string) => {
    const remaining = stops.filter(s => s.member.id !== memberId);
    const resequenced = remaining.map((s, idx) => ({ ...s, sequence: idx + 1 }));
    onStopsChange(resequenced);
  };

  const handleAddStopFromModal = (member: Member) => {
    const schedule = member.schedules?.[selectedDay];
    const newStop: DeliveryStop = {
      sequence: stops.length + 1,
      member,
      daySchedule: schedule,
      isCompleted: false
    };
    onStopsChange([...stops, newStop]);
    setIsAddModalOpen(false);
  };

  const handleAutoSequence = (mode: AutoSequenceMode) => {
    const sorted = autoSequenceStops(stops, mode, selectedDay);
    onStopsChange(sorted);
  };

  const completedCount = stops.filter(s => s.isCompleted).length;
  const progressPercent = stops.length > 0 ? Math.round((completedCount / stops.length) * 100) : 0;

  return (
    <div className="space-y-4">
      
      {/* Top Filter & Operations Panel */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-3">
        
        {/* Row 1: Day selection & File actions */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide mr-1">
              รอบวันส่ง:
            </span>
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
              {DAYS_LIST.map((day) => (
                <button
                  key={day}
                  onClick={() => onDayChange(day)}
                  className={`px-3 py-1 rounded text-xs font-medium transition ${
                    selectedDay === day
                      ? 'bg-white text-slate-900 shadow-sm border border-slate-200'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {day}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label className="inline-flex items-center px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-medium cursor-pointer transition">
              <span>{isUploading ? 'กำลังประมวลผล...' : 'นำเข้าไฟล์ Excel สมาชิก'}</span>
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
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium border border-slate-200 transition"
              >
                โหลดชุดข้อมูลเริ่มต้น
              </button>
            )}
          </div>
        </div>

        {uploadSuccessMsg && (
          <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 text-xs font-medium">
            {uploadSuccessMsg}
          </div>
        )}

        {/* Row 2: Delivery Conditions Filter (New Feature: Default รอบปกติ, toggle others) */}
        <div className="pt-2.5 border-t border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
          
          <div className="flex items-center gap-3 flex-wrap">
            <span className="font-semibold text-slate-600">เงื่อนไขรอบส่ง:</span>
            
            {/* รอบปกติ (Default On) */}
            <label className="inline-flex items-center gap-1.5 cursor-pointer bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-lg">
              <input
                type="checkbox"
                checked={conditionFilter.includeRegular}
                onChange={e => onConditionFilterChange({ ...conditionFilter, includeRegular: e.target.checked })}
                className="rounded border-slate-300 text-slate-900 focus:ring-0 cursor-pointer"
              />
              <span className="font-medium text-slate-800">รอบปกติ (ประจำสัปดาห์)</span>
            </label>

            {/* รอบเว้นรอบ */}
            <label className="inline-flex items-center gap-1.5 cursor-pointer bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-lg">
              <input
                type="checkbox"
                checked={conditionFilter.includeBiWeekly}
                onChange={e => onConditionFilterChange({ ...conditionFilter, includeBiWeekly: e.target.checked })}
                className="rounded border-slate-300 text-purple-600 focus:ring-0 cursor-pointer"
              />
              <span className="font-medium text-purple-900">รวมรอบเว้นรอบ</span>
            </label>

            {/* โทรสั่งก่อนน้ำหมด */}
            <label className="inline-flex items-center gap-1.5 cursor-pointer bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-lg">
              <input
                type="checkbox"
                checked={conditionFilter.includeOnDemand}
                onChange={e => onConditionFilterChange({ ...conditionFilter, includeOnDemand: e.target.checked })}
                className="rounded border-slate-300 text-amber-600 focus:ring-0 cursor-pointer"
              />
              <span className="font-medium text-amber-900">รวมโทรสั่งก่อนน้ำหมด</span>
            </label>

            {/* สัปดาห์ที่ 1 - 4 ของเดือน */}
            <div className="inline-flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-lg">
              <span className="text-slate-500">สัปดาห์ของเดือน:</span>
              <select
                value={conditionFilter.selectedMonthlyWeek ?? ''}
                onChange={e => {
                  const val = e.target.value ? parseInt(e.target.value, 10) : null;
                  onConditionFilterChange({ ...conditionFilter, selectedMonthlyWeek: val });
                }}
                className="bg-transparent font-medium text-slate-800 focus:outline-none cursor-pointer"
              >
                <option value="">ไม่ระบุสัปดาห์</option>
                <option value="1">สัปดาห์ที่ 1</option>
                <option value="2">สัปดาห์ที่ 2</option>
                <option value="3">สัปดาห์ที่ 3</option>
                <option value="4">สัปดาห์ที่ 4</option>
              </select>
            </div>
          </div>

          {/* Button: Add On-demand Stop */}
          <div>
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="px-3 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium text-xs shadow-sm transition"
            >
              + แทรกงานส่ง (โทรสั่ง/รอบเว้นรอบ)
            </button>
          </div>

        </div>

        {/* Row 3: Truck Selector & Auto-sorting */}
        <div className="pt-2.5 border-t border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
          
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-600">สายรถ:</span>
            <select
              value={selectedTruck}
              onChange={(e) => onTruckChange(e.target.value)}
              className="text-xs font-medium bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5 focus:ring-1 focus:ring-slate-900 focus:outline-none"
            >
              {availableTrucks.map((t) => (
                <option key={t.truckNo} value={t.truckNo}>
                  สายรถ {t.truckNo} ({t.count} จุดส่ง)
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="inline-flex items-center bg-slate-50 border border-slate-200 rounded-lg p-0.5 text-xs">
              <span className="px-2.5 text-slate-500 font-medium">จัดเรียงอัตโนมัติ:</span>
              <button
                onClick={() => handleAutoSequence('historical')}
                title="จัดเรียงตามค่าเฉลี่ยเวลาส่งจริงในอดีต (4 รอบล่าสุด)"
                className="px-2.5 py-1 hover:bg-white rounded text-slate-700 transition"
              >
                ตามเวลาจริงในอดีต
              </button>
              <button
                onClick={() => handleAutoSequence('timewindow')}
                title="จัดเรียงตามช่วงเวลานัดหมายของสมาชิก"
                className="px-2.5 py-1 hover:bg-white rounded text-slate-700 transition"
              >
                ตามช่วงเวลานัด
              </button>
              <button
                onClick={() => handleAutoSequence('gps')}
                title="จัดเรียงตามเส้นทางพิกัด GPS ที่ใกล้ที่สุด"
                className="px-2.5 py-1 hover:bg-white rounded text-slate-700 transition"
              >
                ตามระยะทาง GPS
              </button>
            </div>

            <button
              onClick={onSaveRoute}
              disabled={isSaving || stops.length === 0}
              className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-sm transition disabled:opacity-50"
            >
              {isSaving ? 'กำลังบันทึก...' : 'บันทึกสายส่ง'}
            </button>
          </div>

        </div>
      </div>

      {/* Route Status Summary Bar */}
      {stops.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 px-4 py-2.5 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs">
          <div className="text-slate-600">
            สายรถ <span className="font-semibold text-slate-900">{selectedTruck}</span> | รอบวัน <span className="font-semibold text-slate-900">{selectedDay}</span> | จุดส่งทั้งหมด <span className="font-semibold text-slate-900">{stops.length} จุด</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-slate-500">
              สถานะ: ส่งแล้ว {completedCount}/{stops.length} จุด ({progressPercent}%)
            </span>
            <div className="w-32 bg-slate-100 h-2 rounded-full overflow-hidden border border-slate-200">
              <div 
                className="bg-emerald-500 h-full rounded-full transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Main Split: Left Map | Right Sequence Table */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        
        {/* Left Column: Route Map (7 cols) */}
        <div className="lg:col-span-7 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-600">
            <span className="font-semibold text-slate-800">แผนผังเส้นทางสายส่ง</span>
            <span>คลิกหมุดบนแผนที่เพื่อดูข้อมูล</span>
          </div>

          <MapView
            stops={stops}
            selectedStop={selectedStop}
            onSelectStop={setSelectedStop}
            userRole="office"
            heightClass="h-[580px]"
          />
        </div>

        {/* Right Column: Ordered Sequence Table (5 cols) */}
        <div className="lg:col-span-5 space-y-2">
          
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-xs text-slate-800">
              ลำดับจุดส่ง ({filteredStops.length} รายการ)
            </span>

            <input
              type="text"
              placeholder="ค้นหาชื่อ หรือ รหัสสมาชิก..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="text-xs px-2.5 py-1 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900 w-44"
            />
          </div>

          {/* List Container */}
          <div className="bg-white rounded-xl border border-slate-200 p-2 h-[580px] overflow-y-auto space-y-1.5">
            {filteredStops.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-400 text-xs">
                ไม่พบรายการส่งน้ำในสายรถและรอบวันนี้
              </div>
            ) : (
              filteredStops.map((stop, index) => {
                const isSelected = selectedStop?.member.id === stop.member.id;
                const timeStr = stop.daySchedule?.timeWindow || stop.member.targetTime || 'ไม่ระบุ';
                const avgBottles = stop.daySchedule?.avgQuantity || 0;
                const actualAvgMin = stop.daySchedule?.avgActualTimeMinutes;
                const actualHour = actualAvgMin ? Math.floor(actualAvgMin / 60) : null;
                const actualMin = actualAvgMin ? (actualAvgMin % 60) : null;
                const actualTimeStr = actualHour !== null ? `${String(actualHour).padStart(2, '0')}:${String(actualMin).padStart(2, '0')} น.` : null;

                // Condition badge style
                const cond = stop.member.deliveryCondition || 'รอบปกติ';
                let condBadge = 'bg-slate-100 text-slate-700 border-slate-200';
                if (cond.includes('โทรสั่ง')) {
                  condBadge = 'bg-amber-50 text-amber-800 border-amber-200 font-semibold';
                } else if (cond.includes('รอบเว้นรอบ')) {
                  condBadge = 'bg-purple-50 text-purple-800 border-purple-200 font-semibold';
                } else if (cond.includes('สัปดาห์ที่')) {
                  condBadge = 'bg-blue-50 text-blue-800 border-blue-200 font-semibold';
                }

                return (
                  <div
                    key={stop.member.id}
                    onClick={() => setSelectedStop(stop)}
                    className={`p-2.5 rounded-lg border transition cursor-pointer flex items-center justify-between gap-2 text-xs ${
                      isSelected
                        ? 'border-blue-500 bg-blue-50/50'
                        : stop.isCompleted
                        ? 'border-emerald-200 bg-emerald-50/30'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    
                    {/* Stop Number & Info */}
                    <div className="flex items-start gap-2.5 flex-1 min-w-0">
                      <div className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-[11px] font-bold text-white mt-0.5 ${
                        stop.isCompleted ? 'bg-emerald-600' : 'bg-slate-900'
                      }`}>
                        {stop.isCompleted ? '✓' : stop.sequence}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 truncate">
                          <span className="font-semibold text-slate-900 truncate">
                            {stop.member.name}
                          </span>
                          <span className="text-slate-400 text-[10px]">
                            #{stop.member.id}
                          </span>
                          <span className={`text-[10px] px-1.5 py-0.2 rounded border ${condBadge}`}>
                            {cond}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-500 flex-wrap">
                          <span className="font-medium text-slate-700">เวลา: {timeStr}</span>
                          <span>•</span>
                          <span className="font-semibold text-blue-700">{avgBottles} ถัง</span>
                          {actualTimeStr && (
                            <span className="text-slate-400 text-[10px]">
                              (ส่งจริง ~{actualTimeStr})
                            </span>
                          )}
                        </div>

                        <div className="text-[10px] text-slate-500 mt-0.5 truncate">
                          {stop.member.receiveType}
                        </div>
                      </div>
                    </div>

                    {/* Actions: Move Up / Down & Remove / Edit */}
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <div className="flex items-center gap-0.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMoveStop(index, 'up');
                          }}
                          disabled={index === 0}
                          title="เลื่อนขึ้น"
                          className="px-1.5 py-0.5 border border-slate-200 bg-slate-50 hover:bg-slate-100 rounded text-slate-700 disabled:opacity-30 text-[11px]"
                        >
                          ▲
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMoveStop(index, 'down');
                          }}
                          disabled={index === stops.length - 1}
                          title="เลื่อนลง"
                          className="px-1.5 py-0.5 border border-slate-200 bg-slate-50 hover:bg-slate-100 rounded text-slate-700 disabled:opacity-30 text-[11px]"
                        >
                          ▼
                        </button>
                      </div>

                      <div className="flex items-center gap-2 mt-0.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingMember(stop.member);
                          }}
                          className="text-[10px] text-blue-600 hover:text-blue-800 font-medium"
                        >
                          ข้อมูล/แนบไฟล์
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveStop(stop.member.id);
                          }}
                          title="ลบออกจากสายส่งวันนี้"
                          className="text-[10px] text-red-500 hover:text-red-700 font-medium"
                        >
                          ลบออก
                        </button>
                      </div>
                    </div>

                  </div>
                );
              })
            )}
          </div>

        </div>

      </div>

      {/* Member Details Modal */}
      {editingMember && (
        <MemberModal
          member={editingMember}
          onClose={() => setEditingMember(null)}
          onUpdated={(updated) => {
            const updatedStops = stops.map(s => 
              s.member.id === updated.id ? { ...s, member: updated } : s
            );
            onStopsChange(updatedStops);
            const updatedMembers = members.map(m => m.id === updated.id ? updated : m);
            onMembersUpdated(updatedMembers);
          }}
        />
      )}

      {/* Add Stop Modal (For inserting On-Demand, Bi-weekly, or other stops) */}
      {isAddModalOpen && (
        <AddStopModal
          allMembers={members}
          currentStops={stops}
          selectedTruck={selectedTruck}
          selectedDay={selectedDay}
          onAddStop={handleAddStopFromModal}
          onClose={() => setIsAddModalOpen(false)}
        />
      )}

      {/* Sync Diff Report Modal */}
      {syncReport && (
        <SyncReportModal
          report={syncReport}
          onClose={() => setSyncReport(null)}
        />
      )}

    </div>
  );
};
