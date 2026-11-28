import React, { useState, useMemo, useEffect } from 'react';
import { Member, DeliveryStop, DayOfWeek } from '../types/delivery';
import { getOrLoadGlobalSearchIndex, CloudMeta, MemberSearchIndexEntry } from '../services/db';
import { TruckSelector } from './TruckSelector';

interface AddStopModalProps {
  allMembers: Member[];
  availableTrucks?: { truckNo: string; count: number }[];
  cloudMeta?: CloudMeta | null;
  onLoadTruckMembers?: (truckNo: string) => Promise<Member[]>;
  currentStops: DeliveryStop[];
  selectedTruck: string;
  selectedDay: DayOfWeek;
  onAddStop: (member: Member) => void;
  onClose: () => void;
}

type SearchCandidate = MemberSearchIndexEntry & {
  fullMember?: Member;
};

export const AddStopModal: React.FC<AddStopModalProps> = ({
  allMembers,
  availableTrucks = [],
  cloudMeta = null,
  onLoadTruckMembers,
  currentStops,
  selectedTruck,
  selectedDay,
  onAddStop,
  onClose
}) => {
  const [search, setSearch] = useState('');
  const [sourceTruckFilter, setSourceTruckFilter] = useState<string>('');
  const [conditionTab, setConditionTab] = useState<'all' | 'ondemand' | 'biweekly' | 'monthly'>('all');
  const [globalIndex, setGlobalIndex] = useState<MemberSearchIndexEntry[] | null>(null);
  const [isLoadingIndex, setIsLoadingIndex] = useState(false);
  const [addingMemberId, setAddingMemberId] = useState<string | null>(null);

  // Load lightweight global search index across all trucks (cached in IndexedDB)
  useEffect(() => {
    let cancelled = false;
    if (!cloudMeta?.indexChunks) return;

    setIsLoadingIndex(true);
    getOrLoadGlobalSearchIndex(cloudMeta)
      .then(entries => {
        if (!cancelled && entries && entries.length > 0) {
          setGlobalIndex(entries);
        }
      })
      .catch(err => {
        console.warn('Could not load global search index:', err);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingIndex(false);
      });

    return () => {
      cancelled = true;
    };
  }, [cloudMeta]);

  // If user selects a specific source truck, load that truck's members on demand
  useEffect(() => {
    if (!sourceTruckFilter.trim() || !onLoadTruckMembers) return;
    onLoadTruckMembers(sourceTruckFilter.trim());
  }, [sourceTruckFilter, onLoadTruckMembers]);

  const existingIds = useMemo(() => new Set(currentStops.map(s => s.member.id)), [currentStops]);
  const fullMemberMap = useMemo(() => new Map(allMembers.map(m => [m.id, m])), [allMembers]);

  // Filter candidates across global index (if loaded) or local loaded members
  const candidates = useMemo<SearchCandidate[]>(() => {
    const q = search.trim().toLowerCase();
    const truckFilter = sourceTruckFilter.trim().toLowerCase();

    const sourceList: SearchCandidate[] = globalIndex
      ? globalIndex.map(entry => ({
          ...entry,
          fullMember: fullMemberMap.get(entry.id)
        }))
      : allMembers.map(m => ({
          id: m.id,
          name: m.name,
          truckNo: m.truckNo,
          deliveryCondition: m.deliveryCondition,
          deliveryDays: m.deliveryDays || [],
          fullMember: m
        }));

    // Avoid filtering 111k entries without returning quickly; collect matches cleanly
    const matches: SearchCandidate[] = [];
    const MAX_SCAN_WHEN_UNFILTERED = 60;

    for (let i = 0; i < sourceList.length; i++) {
      const item = sourceList[i];
      if (existingIds.has(item.id)) continue;

      if (truckFilter && item.truckNo.trim().toLowerCase() !== truckFilter) continue;

      if (conditionTab === 'ondemand' && !item.deliveryCondition.includes('โทรสั่ง')) continue;
      if (conditionTab === 'biweekly' && !item.deliveryCondition.includes('รอบเว้นรอบ')) continue;
      if (conditionTab === 'monthly' && !item.deliveryCondition.includes('สัปดาห์ที่')) continue;

      if (q) {
        const matchId = item.id.toLowerCase().includes(q);
        const matchName = item.name.toLowerCase().includes(q);
        const matchTruck = item.truckNo.toLowerCase().includes(q);
        const matchDays = item.deliveryDays.some(d => d.toLowerCase().includes(q));
        if (!matchId && !matchName && !matchTruck && !matchDays) continue;
      } else if (!truckFilter && matches.length >= MAX_SCAN_WHEN_UNFILTERED) {
        break;
      }

      matches.push(item);
    }

    return matches;
  }, [globalIndex, allMembers, fullMemberMap, existingIds, sourceTruckFilter, conditionTab, search]);

  const handleAddClick = async (candidate: SearchCandidate) => {
    if (candidate.fullMember) {
      onAddStop(candidate.fullMember);
      return;
    }

    if (onLoadTruckMembers && candidate.truckNo) {
      setAddingMemberId(candidate.id);
      try {
        const loadedList = await onLoadTruckMembers(candidate.truckNo);
        const exact = loadedList.find(m => m.id === candidate.id);
        if (exact) {
          onAddStop(exact);
          return;
        }
      } finally {
        setAddingMemberId(null);
      }
    }

    // Fallback if not found in truck_members doc
    onAddStop({
      id: candidate.id,
      name: candidate.name,
      deliveryDays: candidate.deliveryDays,
      truckNo: candidate.truckNo,
      receiveType: 'ปกติ',
      deliveryCondition: candidate.deliveryCondition,
      customerGroup: '',
      status: 'ปกติ',
      lat: 0,
      lng: 0,
      hasGps: false,
      schedules: {}
    });
  };

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
          
          {/* Search Box & Direct Source Truck Selector */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
            <div className="sm:col-span-7">
              <label className="block text-slate-700 font-semibold mb-1">
                ค้นหารหัสสมาชิก หรือชื่อลูกค้า (ค้นหาได้ทั้งระบบ):
              </label>
              <input
                type="text"
                placeholder="พิมพ์รหัสสมาชิก (เช่น 00033, 191429) หรือชื่อลูกค้า..."
                value={search}
                autoFocus
                onChange={e => setSearch(e.target.value)}
                className="w-full text-xs px-3 py-2 border-2 border-slate-300 rounded-lg focus:outline-none focus:border-slate-900 bg-slate-50 focus:bg-white"
              />
            </div>

            {availableTrucks.length > 0 && (
              <div className="sm:col-span-5">
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-slate-700 font-semibold">
                    กรองจากเบอร์รถสายอื่น:
                  </label>
                  {sourceTruckFilter && (
                    <button
                      type="button"
                      onClick={() => setSourceTruckFilter('')}
                      className="text-[10px] text-blue-600 hover:underline"
                    >
                      ดูทุกสาย
                    </button>
                  )}
                </div>
                <TruckSelector
                  value={sourceTruckFilter}
                  onChange={setSourceTruckFilter}
                  availableTrucks={availableTrucks}
                  fullWidth={true}
                />
              </div>
            )}
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
          <div className="flex items-center justify-between text-[11px] text-slate-500">
            <span>
              พบสมาชิกที่พร้อมดึงเข้าสายส่ง: <strong>{candidates.length.toLocaleString()} ราย</strong>
              {!search.trim() && !sourceTruckFilter && globalIndex && ' (แสดง 60 รายแรก — พิมพ์เพื่อค้นหาทั้งหมด)'}
            </span>
            {isLoadingIndex ? (
              <span className="text-blue-600 font-medium">กำลังโหลดดัชนีค้นหาทั้ง {cloudMeta?.trucksCount || 289} สาย...</span>
            ) : globalIndex ? (
              <span className="text-emerald-700 font-medium">พร้อมค้นหาทั้ง {globalIndex.length.toLocaleString()} รายชื่อ</span>
            ) : null}
          </div>

          {/* Candidates List */}
          <div className="max-h-[380px] overflow-y-auto space-y-2 border border-slate-200 rounded-xl p-2 bg-slate-50">
            {candidates.length === 0 ? (
              <div className="py-10 text-center text-slate-400">
                {isLoadingIndex
                  ? 'กำลังโหลดฐานข้อมูลทั้งระบบ กรุณารอสักครู่...'
                  : 'ไม่พบสมาชิกที่ตรงกับคำค้นหา หรือสมาชิกอยู่ในสายส่งนี้แล้ว'}
              </div>
            ) : (
              candidates.slice(0, 60).map(candidate => {
                const member = candidate.fullMember;
                const schedule = member ? (member.schedules?.[selectedDay] || Object.values(member.schedules || {})[0]) : undefined;
                const timeStr = schedule?.timeWindow || member?.targetTime || 'ดึงเมื่อกดเพิ่ม';
                const avgBottles = schedule?.avgQuantity || 0;

                const isDifferentTruck = candidate.truckNo !== selectedTruck;
                const isDifferentDay = !candidate.deliveryDays.includes(selectedDay);
                const isAddingThis = addingMemberId === candidate.id;

                let condBadgeColor = 'bg-slate-100 text-slate-700 border-slate-200';
                if (candidate.deliveryCondition.includes('โทรสั่ง')) {
                  condBadgeColor = 'bg-amber-50 text-amber-800 border-amber-200';
                } else if (candidate.deliveryCondition.includes('รอบเว้นรอบ')) {
                  condBadgeColor = 'bg-purple-50 text-purple-800 border-purple-200';
                } else if (candidate.deliveryCondition.includes('สัปดาห์ที่')) {
                  condBadgeColor = 'bg-blue-50 text-blue-800 border-blue-200';
                }

                return (
                  <div
                    key={candidate.id}
                    className="p-3 bg-white rounded-lg border border-slate-200 hover:border-slate-300 flex items-center justify-between gap-3 shadow-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-slate-900">
                          {candidate.name}
                        </span>
                        <span className="text-slate-500 font-mono text-[11px] bg-slate-100 px-1.5 py-0.5 rounded">
                          #{candidate.id}
                        </span>
                        <span className={`text-[10px] px-2 py-0.2 rounded border font-medium ${condBadgeColor}`}>
                          {candidate.deliveryCondition}
                        </span>

                        {isDifferentTruck && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-50 text-amber-800 border border-amber-200 font-semibold">
                            จากรถ {candidate.truckNo}
                          </span>
                        )}
                        {isDifferentDay && candidate.deliveryDays.length > 0 && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 border border-slate-200">
                            รอบปกติ: {candidate.deliveryDays.join(', ')}
                          </span>
                        )}
                      </div>

                      {member ? (
                        <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-2 flex-wrap">
                          <span>เวลา: <strong>{timeStr}</strong></span>
                          <span>•</span>
                          <span>จำนวน: <strong>{avgBottles} ถัง</strong></span>
                          <span>•</span>
                          <span className="truncate">{member.receiveType}</span>
                        </div>
                      ) : (
                        <div className="text-[11px] text-slate-400 mt-1">
                          อยู่บน Cloud (สาย {candidate.truckNo}) — กดปุ่มเพื่อดึงพิกัด GPS และเพิ่มเข้าสายนี้ทันที
                        </div>
                      )}
                    </div>

                    <button
                      onClick={() => handleAddClick(candidate)}
                      disabled={isAddingThis}
                      className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-xs whitespace-nowrap shadow-sm transition disabled:opacity-50"
                    >
                      {isAddingThis ? 'กำลังดึงพิกัด...' : '+ ดึงเข้าสายนี้'}
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
