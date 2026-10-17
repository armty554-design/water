import React, { useState, useMemo, useEffect, useRef } from 'react';
import L from 'leaflet';
import { Member, RebalanceResult, TruckVolumeStats } from '../types/delivery';
import { 
  calculateTruckVolumeStats, 
  runRebalanceSimulation, 
  exportRebalanceToExcel 
} from '../services/rebalance';
import { saveMembers } from '../services/db';
import { saveMembersToCloud, isFirebaseConfigured } from '../services/firebase';

interface RebalanceViewProps {
  members: Member[];
  onMembersUpdated: (updatedMembers: Member[]) => void;
}

const TRUCK_PALETTE = [
  '#2563eb', '#16a34a', '#d97706', '#9333ea', '#dc2626', 
  '#0891b2', '#4f46e5', '#ca8a04', '#059669', '#e11d48',
  '#7c3aed', '#0284c7', '#ea580c', '#15803d', '#be123c'
];

export const RebalanceView: React.FC<RebalanceViewProps> = ({
  members,
  onMembersUpdated
}) => {
  // Rebalancing configuration parameters
  const [workingDays, setWorkingDays] = useState<number>(26);
  const [targetPercentage, setTargetPercentage] = useState<number>(90);
  const [targetCapacityPerDay, setTargetCapacityPerDay] = useState<number>(220);
  const [newTrucks, setNewTrucks] = useState<string[]>([]);
  const [newTruckInput, setNewTruckInput] = useState<string>('');
  const [lockedTrucks, setLockedTrucks] = useState<string[]>([]);

  // Simulation state
  const [simulationResult, setSimulationResult] = useState<RebalanceResult | null>(null);
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [isApplying, setIsApplying] = useState<boolean>(false);
  const [applyProgress, setApplyProgress] = useState<string | null>(null);
  const [applySuccessMsg, setApplySuccessMsg] = useState<string | null>(null);

  // View state
  const [activeTab, setActiveTab] = useState<'summary' | 'reassigned' | 'map'>('summary');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterTruck, setFilterTruck] = useState<string>('ALL');

  // Map refs
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);

  // 1. Initial Baseline Stats Before Any Simulation
  const baselineStats = useMemo(() => {
    return calculateTruckVolumeStats(
      members,
      workingDays,
      targetCapacityPerDay,
      targetPercentage,
      newTrucks
    );
  }, [members, workingDays, targetCapacityPerDay, targetPercentage, newTrucks]);

  // Fleet volume totals
  const totalFleetMonthlyBottles = useMemo(() => {
    return baselineStats.reduce((sum, t) => sum + t.monthlyBottles, 0);
  }, [baselineStats]);

  const fleetDailyAverage = useMemo(() => {
    return workingDays > 0 ? Math.round((totalFleetMonthlyBottles / workingDays) * 10) / 10 : 0;
  }, [totalFleetMonthlyBottles, workingDays]);

  const fleetAveragePerTruck = useMemo(() => {
    const truckCount = baselineStats.filter(t => !t.isNew).length || 1;
    return Math.round((fleetDailyAverage / truckCount) * 10) / 10;
  }, [fleetDailyAverage, baselineStats]);

  // Set target capacity automatically from fleet average
  const handleUseFleetAverage = () => {
    // If target load is 90%, then capacity = fleetAveragePerTruck / 0.9
    const calculatedCapacity = Math.round(fleetAveragePerTruck / (targetPercentage / 100));
    setTargetCapacityPerDay(calculatedCapacity);
  };

  // Add new truck
  const handleAddNewTruck = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = newTruckInput.trim().toUpperCase().replace(/\//g, '_');
    if (!clean) return;

    const existingTrucks = new Set(members.map(m => m.truckNo.trim()));
    if (existingTrucks.has(clean) || newTrucks.includes(clean)) {
      alert(`มีเบอร์รถ ${clean} อยู่ในระบบแล้ว`);
      return;
    }

    setNewTrucks(prev => [...prev, clean]);
    setNewTruckInput('');
  };

  const handleRemoveNewTruck = (truckToRemove: string) => {
    setNewTrucks(prev => prev.filter(t => t !== truckToRemove));
    if (simulationResult) {
      setSimulationResult(null); // invalidate simulation
    }
  };

  const handleToggleLockTruck = (truckNo: string) => {
    setLockedTrucks(prev => 
      prev.includes(truckNo) ? prev.filter(t => t !== truckNo) : [...prev, truckNo]
    );
  };

  // Run simulation
  const handleRunSimulation = () => {
    setIsSimulating(true);
    setApplySuccessMsg(null);

    // Timeout allows UI to render spinner
    setTimeout(() => {
      try {
        const result = runRebalanceSimulation(members, {
          workingDays,
          targetCapacityPerDay,
          targetPercentage,
          newTrucks,
          lockedTrucks
        });
        setSimulationResult(result);
      } catch (err) {
        console.error('Rebalance simulation error:', err);
        alert('เกิดข้อผิดพลาดในการคำนวณเกลี่ยสายส่ง');
      } finally {
        setIsSimulating(false);
      }
    }, 100);
  };

  const handleReset = () => {
    setSimulationResult(null);
    setNewTrucks([]);
    setLockedTrucks([]);
    setApplySuccessMsg(null);
  };

  // Apply rebalance to local DB and Firestore
  const handleApplyRebalance = async () => {
    if (!simulationResult) return;
    const reassignedCount = simulationResult.reassignedMembers.length;
    if (!window.confirm(`ยืนยันการนำสายส่งใหม่ไปใช้จริง? จะมีการปรับสายรถของสมาชิกจำนวน ${reassignedCount.toLocaleString()} รายการ`)) {
      return;
    }

    setIsApplying(true);
    setApplyProgress('กำลังบันทึกข้อมูลลงเครื่อง...');

    try {
      const updatedMembers = simulationResult.updatedMembers;
      // 1. Save to local IndexedDB
      await saveMembers(updatedMembers);
      onMembersUpdated(updatedMembers);

      // 2. If Cloud Firestore configured, sync to Cloud
      if (isFirebaseConfigured()) {
        setApplyProgress('กำลังซิงค์ข้อมูลสายส่งใหม่ขึ้น Cloud Firestore...');
        await saveMembersToCloud(updatedMembers, (done, total) => {
          setApplyProgress(`กำลังซิงค์ขึ้น Cloud: กลุ่มที่ ${done}/${total}...`);
        });
      }

      setApplySuccessMsg(`จัดสายใหม่สำเร็จ! ปรับปรุงข้อมูลสมาชิก ${reassignedCount.toLocaleString()} รายการ และอัปเดตลงฐานข้อมูลเรียบร้อยแล้ว`);
      setSimulationResult(null); // clear after applying
    } catch (err) {
      console.error('Failed to apply rebalance:', err);
      alert('เกิดข้อผิดพลาดในการบันทึกข้อมูลสายส่งใหม่');
    } finally {
      setIsApplying(false);
      setApplyProgress(null);
    }
  };

  // Export Excel
  const handleExportExcel = () => {
    if (!simulationResult) return;
    exportRebalanceToExcel(simulationResult);
  };

  // Active stats to display (either simulation result after or baseline before)
  const currentDisplayStats = simulationResult ? simulationResult.statsAfter : baselineStats;
  const beforeStatsMap = useMemo(() => {
    return new Map<string, TruckVolumeStats>(baselineStats.map(s => [s.truckNo, s]));
  }, [baselineStats]);

  // Leaflet map initialization
  useEffect(() => {
    if (activeTab !== 'map' || !mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [13.7563, 100.5018],
        zoom: 11
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap'
      }).addTo(map);

      markersLayerRef.current = L.layerGroup().addTo(map);
      mapInstanceRef.current = map;
    }

    const map = mapInstanceRef.current;
    const markersLayer = markersLayerRef.current;
    if (!map || !markersLayer) return;

    markersLayer.clearLayers();

    // Map truck numbers to distinct colors
    const truckColorMap = new Map<string, string>();
    const allTrucks = Array.from(new Set(members.map(m => m.truckNo.trim()).concat(newTrucks)));
    allTrucks.forEach((t, i) => {
      truckColorMap.set(t, TRUCK_PALETTE[i % TRUCK_PALETTE.length]);
    });

    const bounds = L.latLngBounds([]);
    let renderedCount = 0;

    // If simulation result exists, show reassigned members specifically
    if (simulationResult && simulationResult.reassignedMembers.length > 0) {
      simulationResult.reassignedMembers.forEach(m => {
        if (m.hasGps && m.lat && m.lng && renderedCount < 500) {
          const newColor = truckColorMap.get(m.newTruck) || '#2563eb';
          const marker = L.circleMarker([m.lat, m.lng], {
            radius: 7,
            fillColor: newColor,
            color: '#ffffff',
            weight: 2,
            opacity: 1,
            fillOpacity: 0.85
          });

          marker.bindPopup(`
            <div style="font-family: sans-serif; font-size: 12px; line-height: 1.4;">
              <strong style="color: #1e293b;">${m.memberName}</strong> (${m.memberId})<br/>
              <span style="color: #64748b;">${m.address || 'ไม่มีที่อยู่'}</span><br/>
              <hr style="margin: 4px 0; border: none; border-top: 1px solid #e2e8f0;"/>
              <span style="color: #dc2626;">สายเดิม: ${m.oldTruck}</span> &rarr; 
              <strong style="color: #16a34a;">สายใหม่: ${m.newTruck}</strong><br/>
              <span>ยอดส่ง: <strong>${m.monthlyBottles}</strong> ถัง/เดือน</span>
            </div>
          `);

          markersLayer.addLayer(marker);
          bounds.extend([m.lat, m.lng]);
          renderedCount++;
        }
      });
    } else {
      // Default: render sample members from trucks
      const sample = members.slice(0, 400);
      sample.forEach(m => {
        if (m.hasGps && m.lat && m.lng) {
          const color = truckColorMap.get(m.truckNo.trim()) || '#64748b';
          const marker = L.circleMarker([m.lat, m.lng], {
            radius: 5,
            fillColor: color,
            color: '#ffffff',
            weight: 1.5,
            opacity: 0.9,
            fillOpacity: 0.75
          });
          markersLayer.addLayer(marker);
          bounds.extend([m.lat, m.lng]);
          renderedCount++;
        }
      });
    }

    if (renderedCount > 0 && bounds.isValid()) {
      map.fitBounds(bounds, { padding: [30, 30] });
    }
  }, [activeTab, simulationResult, members, newTrucks]);

  // Filtered truck summary list
  const filteredSummary = useMemo(() => {
    return currentDisplayStats.filter(s => {
      if (filterTruck !== 'ALL' && s.truckNo !== filterTruck) return false;
      if (!searchQuery.trim()) return true;
      return s.truckNo.toLowerCase().includes(searchQuery.toLowerCase());
    });
  }, [currentDisplayStats, filterTruck, searchQuery]);

  // Filtered reassigned members list
  const filteredReassigned = useMemo(() => {
    if (!simulationResult) return [];
    return simulationResult.reassignedMembers.filter(m => {
      if (filterTruck !== 'ALL' && m.newTruck !== filterTruck && m.oldTruck !== filterTruck) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        m.memberId.toLowerCase().includes(q) ||
        m.memberName.toLowerCase().includes(q) ||
        (m.address && m.address.toLowerCase().includes(q)) ||
        m.oldTruck.toLowerCase().includes(q) ||
        m.newTruck.toLowerCase().includes(q)
      );
    });
  }, [simulationResult, filterTruck, searchQuery]);

  // Optimal trucks count
  const optimalCount = currentDisplayStats.filter(s => s.status === 'optimal').length;
  const overloadCount = currentDisplayStats.filter(s => s.status === 'overload').length;
  const underloadCount = currentDisplayStats.filter(s => s.status === 'underload').length;

  return (
    <div className="space-y-6">
      
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              จัดเกลี่ยสายส่งน้ำดื่ม (Route Rebalancing)
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
              เป้าหมายยอดส่ง {targetPercentage}%
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            คำนวณและเกลี่ยภาระงานของสายรถให้อยู่ในระดับ ~{targetPercentage}% ต่อเดือน โดยคิดยอดส่งจาก 
            <strong className="text-slate-700"> (ยอดถังทั้งหมดที่วิ่งในเดือน ÷ วันที่ทำงาน)</strong>
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {simulationResult && (
            <>
              <button
                onClick={handleExportExcel}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 shadow-xs transition"
              >
                <span>ดาวน์โหลด Excel</span>
              </button>

              <button
                onClick={handleApplyRebalance}
                disabled={isApplying}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition disabled:opacity-50"
              >
                <span>{isApplying ? 'กำลังบันทึก...' : 'ยืนยันและนำไปใช้จริง'}</span>
              </button>
            </>
          )}

          <button
            onClick={handleRunSimulation}
            disabled={isSimulating}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white shadow-xs transition disabled:opacity-50"
          >
            {isSimulating ? (
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                กำลังคำนวณ...
              </span>
            ) : (
              <span>คำนวณเกลี่ยสาย 90%</span>
            )}
          </button>

          {(simulationResult || newTrucks.length > 0) && (
            <button
              onClick={handleReset}
              className="px-3 py-2 rounded-lg text-xs font-medium text-slate-500 hover:text-slate-800 border border-slate-200 hover:bg-slate-50 transition"
            >
              รีเซ็ต
            </button>
          )}
        </div>
      </div>

      {/* Progress / Success Notifications */}
      {applyProgress && (
        <div className="p-3.5 bg-blue-50 border border-blue-200 text-blue-800 rounded-lg text-xs flex items-center gap-2">
          <span className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          <span>{applyProgress}</span>
        </div>
      )}

      {applySuccessMsg && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-emerald-700">สำเร็จ!</span>
            <span>{applySuccessMsg}</span>
          </div>
          <button 
            onClick={() => setApplySuccessMsg(null)}
            className="text-emerald-600 hover:text-emerald-900 text-xs font-bold px-1"
          >
            ✕
          </button>
        </div>
      )}

      {/* Configuration & Control Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        
        {/* Working Days */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <label className="block text-xs font-medium text-slate-600 mb-1.5">
            จำนวนวันทำงานต่อเดือน (วัน)
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={15}
              max={31}
              value={workingDays}
              onChange={e => setWorkingDays(Math.max(1, parseInt(e.target.value, 10) || 26))}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-xs text-slate-400 whitespace-nowrap">วัน</span>
          </div>
          <span className="text-[11px] text-slate-400 mt-1 block">
            ค่าเฉลี่ยปกติ: 26 วัน (จันทร์-เสาร์)
          </span>
        </div>

        {/* Target Capacity Per Truck Per Day */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium text-slate-600">
              ความจุสูงสุดต่อคัน (ถัง/วัน)
            </label>
            <button
              onClick={handleUseFleetAverage}
              className="text-[11px] font-medium text-blue-600 hover:text-blue-800 underline"
              title="ตั้งค่าความจุจากค่าเฉลี่ยจริงของสายรถทั้งหมด"
            >
              ใช้เฉลี่ยกองรถ ({fleetAveragePerTruck})
            </button>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={50}
              max={600}
              value={targetCapacityPerDay}
              onChange={e => setTargetCapacityPerDay(Math.max(10, parseInt(e.target.value, 10) || 200))}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-xs text-slate-400 whitespace-nowrap">ถัง/วัน</span>
          </div>
          <span className="text-[11px] text-slate-400 mt-1 block">
            เป้าหมายส่ง {targetPercentage}% = <strong className="text-slate-700">{Math.round(targetCapacityPerDay * (targetPercentage / 100))}</strong> ถัง/วัน
          </span>
        </div>

        {/* Target Utilization Percentage */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <label className="block text-xs font-medium text-slate-600 mb-1.5">
            เป้าหมายโหลดงานต่อสายรถ (%)
          </label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={70}
              max={100}
              step={1}
              value={targetPercentage}
              onChange={e => setTargetPercentage(parseInt(e.target.value, 10))}
              className="w-full accent-blue-600 cursor-pointer"
            />
            <span className="text-sm font-bold text-blue-700 w-12 text-right">
              {targetPercentage}%
            </span>
          </div>
          <div className="flex justify-between text-[10px] text-slate-400 mt-1">
            <span>70% (เบา)</span>
            <span>85-90% (แนะนำ)</span>
            <span>100% (เต็มพิกัด)</span>
          </div>
        </div>

        {/* Add New Truck */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <label className="block text-xs font-medium text-slate-600 mb-1.5">
            + เพิ่มสายรถใหม่ (เพื่อเกลี่ยงาน)
          </label>
          <form onSubmit={handleAddNewTruck} className="flex gap-2">
            <input
              type="text"
              placeholder="เช่น 13199"
              value={newTruckInput}
              onChange={e => setNewTruckInput(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition whitespace-nowrap"
            >
              เพิ่ม
            </button>
          </form>

          {/* New trucks list badge */}
          {newTrucks.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {newTrucks.map(t => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-purple-100 text-purple-800 border border-purple-200"
                >
                  <span>{t}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveNewTruck(t)}
                    className="hover:text-red-600 text-purple-600 font-bold"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

      </div>

      {/* KPI Overview Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        
        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-[11px] text-slate-500">ยอดถังรวมทั้งเดือน</div>
          <div className="text-lg font-bold text-slate-900 mt-1">
            {totalFleetMonthlyBottles.toLocaleString()}
          </div>
          <div className="text-[10px] text-slate-400">ถัง/เดือน</div>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-[11px] text-slate-500">ยอดส่งเฉลี่ยรวม/วัน</div>
          <div className="text-lg font-bold text-blue-600 mt-1">
            {fleetDailyAverage.toLocaleString()}
          </div>
          <div className="text-[10px] text-slate-400">ถัง/วัน ({workingDays} วันงาน)</div>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-[11px] text-slate-500">จำนวนสายรถทั้งหมด</div>
          <div className="text-lg font-bold text-slate-900 mt-1 flex items-center gap-1.5">
            <span>{currentDisplayStats.length}</span>
            {newTrucks.length > 0 && (
              <span className="text-xs text-purple-600 font-semibold">
                (+{newTrucks.length} สายใหม่)
              </span>
            )}
          </div>
          <div className="text-[10px] text-slate-400">คัน</div>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-emerald-100 bg-emerald-50/30 shadow-xs">
          <div className="text-[11px] text-emerald-800 font-medium">ตรงเป้า 90% (85-95%)</div>
          <div className="text-lg font-bold text-emerald-700 mt-1">
            {optimalCount}
          </div>
          <div className="text-[10px] text-emerald-600 font-medium">สายรถ</div>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-amber-100 bg-amber-50/30 shadow-xs">
          <div className="text-[11px] text-amber-800 font-medium">สูงกว่าเป้า (&gt;95%)</div>
          <div className="text-lg font-bold text-amber-700 mt-1">
            {overloadCount}
          </div>
          <div className="text-[10px] text-amber-600 font-medium">สายรถล้น</div>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-[11px] text-slate-500">จุดส่งที่ย้ายสาย</div>
          <div className="text-lg font-bold text-purple-700 mt-1">
            {simulationResult ? simulationResult.reassignedMembers.length.toLocaleString() : '0'}
          </div>
          <div className="text-[10px] text-slate-400">
            {simulationResult ? 'จำลองย้ายแล้ว' : 'กดคำนวณ'}
          </div>
        </div>

      </div>

      {/* Visual Workload Distribution (Horizontal/Vertical Chart) */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-4">
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              แผนภูมิการกระจายภาระงาน (ยอดส่งเฉลี่ยต่อวัน เทียบกับเป้าหมาย {targetPercentage}%)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              เส้นประสีเขียว = เป้าหมาย {Math.round(targetCapacityPerDay * (targetPercentage / 100))} ถัง/วัน
              {simulationResult ? ' (แสดงผลหลังเกลี่ยสาย)' : ' (แสดงสถานะปัจจุบัน)'}
            </p>
          </div>

          <div className="flex items-center gap-3 text-xs text-slate-600">
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />
              <span>ตรงเป้า 90%</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-amber-500" />
              <span>งานล้น</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-blue-400" />
              <span>ยอดต่ำ</span>
            </span>
          </div>
        </div>

        {/* Scrollable Bar Visual */}
        <div className="overflow-x-auto pb-2">
          <div className="min-w-[700px] h-36 flex items-end gap-1.5 pt-6 pb-2 border-b border-slate-200 relative">
            
            {/* Target 90% Reference Line */}
            {(() => {
              const targetVal = targetCapacityPerDay * (targetPercentage / 100);
              const maxVal = Math.max(...currentDisplayStats.map(s => s.dailyAvgBottles), targetVal * 1.3, 100);
              const topPercent = 100 - (targetVal / maxVal) * 100;
              return (
                <div 
                  className="absolute left-0 right-0 border-b-2 border-dashed border-emerald-500 z-10 flex items-center justify-end pr-2 pointer-events-none"
                  style={{ top: `${topPercent}%` }}
                >
                  <span className="bg-emerald-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded shadow-xs">
                    เป้า {Math.round(targetVal)} ถัง/วัน ({targetPercentage}%)
                  </span>
                </div>
              );
            })()}

            {/* Bars */}
            {currentDisplayStats.map(truck => {
              const targetVal = targetCapacityPerDay * (targetPercentage / 100);
              const maxVal = Math.max(...currentDisplayStats.map(s => s.dailyAvgBottles), targetVal * 1.3, 100);
              const heightPercent = Math.min(100, Math.max(8, (truck.dailyAvgBottles / maxVal) * 100));

              let barColor = 'bg-emerald-500';
              if (truck.status === 'overload') barColor = 'bg-amber-500';
              if (truck.status === 'underload') barColor = 'bg-blue-400';
              if (truck.isNew) barColor = 'bg-purple-500';

              return (
                <div 
                  key={truck.truckNo}
                  className="flex-1 flex flex-col items-center h-full justify-end group relative"
                >
                  {/* Tooltip */}
                  <div className="absolute -top-10 opacity-0 group-hover:opacity-100 transition pointer-events-none bg-slate-900 text-white text-[10px] rounded px-2 py-1 whitespace-nowrap z-20 shadow-md">
                    <strong>{truck.truckNo}</strong>: {truck.dailyAvgBottles} ถัง/วัน ({truck.utilizationRate}%)
                  </div>

                  <div 
                    className={`w-full rounded-t transition-all duration-300 ${barColor}`}
                    style={{ height: `${heightPercent}%` }}
                  />
                  <span className="text-[9px] text-slate-500 truncate w-full text-center mt-1">
                    {truck.truckNo}
                  </span>
                </div>
              );
            })}

          </div>
        </div>
      </div>

      {/* Tabs: Summary Table / Reassigned Stops / Map View */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        
        {/* Tab Controls & Filter Bar */}
        <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-slate-50/50">
          
          <div className="flex items-center gap-1 bg-slate-200/70 p-1 rounded-lg">
            <button
              onClick={() => setActiveTab('summary')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                activeTab === 'summary' 
                  ? 'bg-white text-slate-900 shadow-xs' 
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              ตารางสรุปรายสายรถ ({currentDisplayStats.length})
            </button>

            <button
              onClick={() => setActiveTab('reassigned')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                activeTab === 'reassigned' 
                  ? 'bg-white text-slate-900 shadow-xs' 
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              จุดส่งที่ย้ายสาย ({simulationResult ? simulationResult.reassignedMembers.length : 0})
            </button>

            <button
              onClick={() => setActiveTab('map')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                activeTab === 'map' 
                  ? 'bg-white text-slate-900 shadow-xs' 
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              แผนที่การกระจายสายส่ง
            </button>
          </div>

          {/* Search & Filter */}
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <input
              type="text"
              placeholder="ค้นหาเบอร์รถ / สมาชิก..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 w-full sm:w-56"
            />

            <select
              value={filterTruck}
              onChange={e => setFilterTruck(e.target.value)}
              className="px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="ALL">ทุกสายรถ</option>
              {currentDisplayStats.map(t => (
                <option key={t.truckNo} value={t.truckNo}>{t.truckNo}</option>
              ))}
            </select>
          </div>

        </div>

        {/* Tab 1: Summary Table */}
        {activeTab === 'summary' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                  <th className="py-2.5 px-3">เบอร์รถ</th>
                  <th className="py-2.5 px-3">สถานะ</th>
                  <th className="py-2.5 px-3 text-right">จุดส่ง (จุด)</th>
                  <th className="py-2.5 px-3 text-right">ยอดถังต่อเดือน</th>
                  <th className="py-2.5 px-3 text-right">ยอดส่งเฉลี่ยต่อวัน</th>
                  <th className="py-2.5 px-3 text-center">สัดส่วนต่อความจุ</th>
                  <th className="py-2.5 px-3 text-center">สถานะเป้าหมาย 90%</th>
                  <th className="py-2.5 px-3 text-center">ล็อกสาย</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredSummary.map(truck => {
                  const before = beforeStatsMap.get(truck.truckNo);
                  const memberDiff = before ? truck.memberCount - before.memberCount : 0;
                  const bottleDiff = before ? truck.monthlyBottles - before.monthlyBottles : 0;

                  const isLocked = lockedTrucks.includes(truck.truckNo);

                  return (
                    <tr 
                      key={truck.truckNo}
                      className="hover:bg-slate-50/80 transition"
                    >
                      <td className="py-2.5 px-3 font-semibold text-slate-900">
                        <div className="flex items-center gap-1.5">
                          <span>{truck.truckNo}</span>
                          {truck.isNew && (
                            <span className="px-1.5 py-0.2 bg-purple-100 text-purple-700 text-[10px] rounded font-medium">
                              สายใหม่
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="py-2.5 px-3 text-slate-500">
                        {truck.isNew ? 'เพิ่มใหม่' : 'สายเดิม'}
                      </td>

                      <td className="py-2.5 px-3 text-right text-slate-800">
                        <span>{truck.memberCount.toLocaleString()}</span>
                        {simulationResult && memberDiff !== 0 && (
                          <span className={`text-[10px] ml-1 font-semibold ${memberDiff > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                            ({memberDiff > 0 ? `+${memberDiff}` : memberDiff})
                          </span>
                        )}
                      </td>

                      <td className="py-2.5 px-3 text-right text-slate-800">
                        <span>{truck.monthlyBottles.toLocaleString()}</span>
                        {simulationResult && bottleDiff !== 0 && (
                          <span className={`text-[10px] ml-1 font-semibold ${bottleDiff > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                            ({bottleDiff > 0 ? `+${bottleDiff}` : bottleDiff})
                          </span>
                        )}
                        <span className="text-[10px] text-slate-400 ml-1">ถัง</span>
                      </td>

                      <td className="py-2.5 px-3 text-right font-medium text-slate-900">
                        <span className="text-sm font-bold text-blue-700">{truck.dailyAvgBottles}</span>
                        <span className="text-[10px] text-slate-400 ml-1">ถัง/วัน</span>
                      </td>

                      <td className="py-2.5 px-3 text-center">
                        <div className="w-24 mx-auto">
                          <div className="flex items-center justify-between text-[10px] font-semibold mb-0.5">
                            <span className="text-slate-600">{truck.utilizationRate}%</span>
                            <span className="text-slate-400">/ 100%</span>
                          </div>
                          <div className="h-1.5 w-full bg-slate-200 rounded-full overflow-hidden">
                            <div 
                              className={`h-full rounded-full ${
                                truck.status === 'optimal' ? 'bg-emerald-500' :
                                truck.status === 'overload' ? 'bg-amber-500' : 'bg-blue-400'
                              }`}
                              style={{ width: `${Math.min(100, truck.utilizationRate)}%` }}
                            />
                          </div>
                        </div>
                      </td>

                      <td className="py-2.5 px-3 text-center">
                        {truck.status === 'optimal' ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
                            ตรงเป้า 90%
                          </span>
                        ) : truck.status === 'overload' ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-800 border border-amber-200">
                            สูงกว่าเป้า
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-100 text-blue-800 border border-blue-200">
                            ต่ำกว่าเป้า
                          </span>
                        )}
                      </td>

                      <td className="py-2.5 px-3 text-center">
                        <button
                          type="button"
                          onClick={() => handleToggleLockTruck(truck.truckNo)}
                          className={`px-2 py-0.5 rounded text-[10px] font-medium transition ${
                            isLocked 
                              ? 'bg-rose-100 text-rose-800 border border-rose-200' 
                              : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                          }`}
                          title={isLocked ? "ปลดล็อกสายนี้" : "ล็อกไม่ให้ย้ายลูกค้าออกจากสายนี้"}
                        >
                          {isLocked ? 'ล็อกแล้ว' : 'ไม่ล็อก'}
                        </button>
                      </td>

                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Tab 2: Reassigned Members List */}
        {activeTab === 'reassigned' && (
          <div className="overflow-x-auto">
            {!simulationResult || simulationResult.reassignedMembers.length === 0 ? (
              <div className="py-16 text-center text-xs text-slate-500">
                ยังไม่มีการจำลองการจัดสาย หรือไม่มีจุดส่งที่ต้องย้ายสาย
                <div className="mt-2">
                  กดปุ่ม <strong>"คำนวณเกลี่ยสาย 90%"</strong> ด้านบนเพื่อเริ่มวิเคราะห์
                </div>
              </div>
            ) : (
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                    <th className="py-2.5 px-3">รหัสสมาชิก</th>
                    <th className="py-2.5 px-3">ชื่อ-นามสกุล</th>
                    <th className="py-2.5 px-3">ที่อยู่จัดส่ง</th>
                    <th className="py-2.5 px-3">รอบส่ง</th>
                    <th className="py-2.5 px-3 text-right">ยอดถัง (ถัง/เดือน)</th>
                    <th className="py-2.5 px-3 text-center">สายเดิม</th>
                    <th className="py-2.5 px-3 text-center">สายใหม่</th>
                    <th className="py-2.5 px-3 text-center">พิกัด GPS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredReassigned.map(m => (
                    <tr key={m.memberId} className="hover:bg-slate-50/80 transition">
                      <td className="py-2.5 px-3 font-semibold text-slate-900 font-mono">
                        {m.memberId}
                      </td>
                      <td className="py-2.5 px-3 font-medium text-slate-800">
                        {m.memberName}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 max-w-xs truncate" title={m.address}>
                        {m.address || '-'}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600">
                        {m.deliveryDays.join(', ') || '-'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-semibold text-blue-700">
                        {m.monthlyBottles}
                      </td>
                      <td className="py-2.5 px-3 text-center text-rose-600 font-medium">
                        {m.oldTruck}
                      </td>
                      <td className="py-2.5 px-3 text-center text-emerald-600 font-bold">
                        {m.newTruck}
                      </td>
                      <td className="py-2.5 px-3 text-center text-slate-400 text-[11px]">
                        {m.hasGps ? (
                          <span className="text-emerald-600 font-semibold">มี GPS</span>
                        ) : (
                          <span>ไม่มี GPS</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Tab 3: Map View */}
        {activeTab === 'map' && (
          <div className="p-3">
            <div className="mb-2 text-xs text-slate-500 flex items-center justify-between">
              <span>
                {simulationResult 
                  ? `แสดงจุดส่งที่ย้ายสาย (${simulationResult.reassignedMembers.length} จุด) แยกสีตามสายรถใหม่`
                  : 'แสดงตัวอย่างจุดส่งของสายรถปัจจุบัน'}
              </span>
              <span className="text-[11px] text-slate-400">
                คลิกที่หมุดบนแผนที่เพื่อดูข้อมูลสมาชิก
              </span>
            </div>
            <div 
              ref={mapContainerRef} 
              className="h-[520px] w-full rounded-lg border border-slate-200 overflow-hidden" 
            />
          </div>
        )}

      </div>

    </div>
  );
};
