import React, { useState, useMemo } from 'react';
import { Member, DeliveryStop, DayOfWeek } from '../types/delivery';

interface AddStopModalProps {
  allMembers: Member[];
  currentStops: DeliveryStop[];
  selectedTruck: string;
  selectedDay: DayOfWeek;
  onAddStop: (member: Member) => void;
  onClose: () => void;
}

export const AddStopModal: React.FC<AddStopModalProps> = ({
  allMembers,
  currentStops,
  selectedTruck,
  selectedDay,
  onAddStop,
  onClose
}) => {
  const [search, setSearch] = useState('');
  const [conditionTab, setConditionTab] = useState<'all' | 'ondemand' | 'biweekly' | 'monthly'>('all');

  // Set of member IDs already in currentStops
  const existingIds = useMemo(() => new Set(currentStops.map(s => s.member.id)), [currentStops]);

  // Filter candidates across all trucks and all days
  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();

    return allMembers.filter(m => {
      // Must not already be in current stops
      if (existingIds.has(m.id)) return false;

      // Condition filter tab
      if (conditionTab === 'ondemand' && !m.deliveryCondition.includes('โทรสั่ง')) return false;
      if (conditionTab === 'biweekly' && !m.deliveryCondition.includes('รอบเว้นรอบ')) return false;
      if (conditionTab === 'monthly' && !m.deliveryCondition.includes('สัปดาห์ที่')) return false;

      // Search matching across ID, Name, Truck, or Days
      if (q) {
        const matchId = m.id.toLowerCase().includes(q);
        const matchName = m.name.toLowerCase().includes(q);
        const matchTruck = m.truckNo.toLowerCase().includes(q);
        const matchDays = m.deliveryDays.some(d => d.toLowerCase().includes(q));
        return matchId || matchName || matchTruck || matchDays;
      }

      // If no search and on 'all' tab, prioritize other trucks or other days
      return true;
    });
  }, [allMembers, existingIds, conditionTab, search]);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden border border-slate-200">
        
        {/* Header */}
        <div className="bg-slate-900 text-white px-5 py-3.5 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-sm">ค้นหารหัสสมาชิกเพื่อเพิ่มงาน (ข้ามสายรถ / ข้ามวันส่ง)</h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              ค้นหารหัสหรือชื่อสมาชิกจากสายรถอื่น หรือวันอื่น เพื่อดึงเข้าสายรถ {selectedTruck} วัน {selectedDay}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-xs px-2 py-1 rounded"
          >
            ปิด
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-3 text-xs">
          
          {/* Search Box - Prominent */}
          <div>
            <label className="block text-slate-700 font-semibold mb-1">
              ค้นหารหัสสมาชิก หรือชื่อลูกค้า (ค้นหาได้ทั้งระบบ):
            </label>
            <input
              type="text"
              placeholder="พิมพ์รหัสสมาชิก (เช่น 00033, 00043) หรือชื่อลูกค้า..."
              value={search}
              autoFocus
              onChange={e => setSearch(e.target.value)}
              className="w-full text-xs px-3 py-2.5 border-2 border-slate-300 rounded-lg focus:outline-none focus:border-slate-900 bg-slate-50 focus:bg-white"
            />
          </div>

          {/* Condition Filter Tabs */}
          <div className="flex border-b border-slate-200 pb-2 gap-2 text-xs flex-wrap">
            <button
              onClick={() => setConditionTab('all')}
              className={`px-3 py-1 rounded-lg font-medium transition ${
                conditionTab === 'all'
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              ทั้งหมด (ข้ามรถ/ข้ามวัน)
            </button>
            <button
              onClick={() => setConditionTab('ondemand')}
              className={`px-3 py-1 rounded-lg font-medium transition ${
                conditionTab === 'ondemand'
                  ? 'bg-amber-100 text-amber-900 border border-amber-300 font-semibold'
                  : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
              }`}
            >
              โทรสั่งก่อนน้ำหมด
            </button>
            <button
              onClick={() => setConditionTab('biweekly')}
              className={`px-3 py-1 rounded-lg font-medium transition ${
                conditionTab === 'biweekly'
                  ? 'bg-purple-100 text-purple-900 border border-purple-300 font-semibold'
                  : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
              }`}
            >
              รอบเว้นรอบ
            </button>
            <button
              onClick={() => setConditionTab('monthly')}
              className={`px-3 py-1 rounded-lg font-medium transition ${
                conditionTab === 'monthly'
                  ? 'bg-blue-100 text-blue-900 border border-blue-300 font-semibold'
                  : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
              }`}
            >
              สัปดาห์ที่ 1 - 4
            </button>
          </div>

          {/* Results Summary */}
          <div className="text-[11px] text-slate-500">
            พบสมาชิกที่พร้อมดึงเข้าสายส่ง: <strong>{candidates.length.toLocaleString()} ราย</strong>
          </div>

          {/* Candidates List */}
          <div className="max-h-[380px] overflow-y-auto space-y-2 border border-slate-200 rounded-xl p-2 bg-slate-50">
            {candidates.length === 0 ? (
              <div className="py-10 text-center text-slate-400">
                ไม่พบสมาชิกที่ตรงกับคำค้นหา หรือสมาชิกอยู่ในสายส่งนี้แล้ว
              </div>
            ) : (
              candidates.slice(0, 60).map(member => {
                const schedule = member.schedules?.[selectedDay] || Object.values(member.schedules || {})[0];
                const timeStr = schedule?.timeWindow || member.targetTime || 'ไม่ระบุ';
                const avgBottles = schedule?.avgQuantity || 0;

                const isDifferentTruck = member.truckNo !== selectedTruck;
                const isDifferentDay = !member.deliveryDays.includes(selectedDay);

                let condBadgeColor = 'bg-slate-100 text-slate-700 border-slate-200';
                if (member.deliveryCondition.includes('โทรสั่ง')) {
                  condBadgeColor = 'bg-amber-50 text-amber-800 border-amber-200';
                } else if (member.deliveryCondition.includes('รอบเว้นรอบ')) {
                  condBadgeColor = 'bg-purple-50 text-purple-800 border-purple-200';
                } else if (member.deliveryCondition.includes('สัปดาห์ที่')) {
                  condBadgeColor = 'bg-blue-50 text-blue-800 border-blue-200';
                }

                return (
                  <div
                    key={member.id}
                    className="p-3 bg-white rounded-lg border border-slate-200 hover:border-slate-300 flex items-center justify-between gap-3 shadow-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-slate-900">
                          {member.name}
                        </span>
                        <span className="text-slate-500 font-mono text-[11px] bg-slate-100 px-1.5 py-0.5 rounded">
                          #{member.id}
                        </span>
                        <span className={`text-[10px] px-2 py-0.2 rounded border font-medium ${condBadgeColor}`}>
                          {member.deliveryCondition}
                        </span>

                        {isDifferentTruck && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-50 text-amber-800 border border-amber-200">
                            จากรถ {member.truckNo}
                          </span>
                        )}
                        {isDifferentDay && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 border border-slate-200">
                            รอบปกติ: {member.deliveryDays.join(', ')}
                          </span>
                        )}
                      </div>

                      <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-2 flex-wrap">
                        <span>เวลา: <strong>{timeStr}</strong></span>
                        <span>•</span>
                        <span>จำนวน: <strong>{avgBottles} ถัง</strong></span>
                        <span>•</span>
                        <span className="truncate">{member.receiveType}</span>
                      </div>
                    </div>

                    <button
                      onClick={() => onAddStop(member)}
                      className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-xs whitespace-nowrap shadow-sm transition"
                    >
                      + ดึงเข้าสายนี้
                    </button>
                  </div>
                );
              })
            )}
          </div>

        </div>

      </div>
    </div>
  );
};
