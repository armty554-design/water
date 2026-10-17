import React, { useState, useMemo, useEffect, useRef } from 'react';
import L from 'leaflet';
import { Member, RebalanceResult, TruckVolumeStats, SpatialClusterCandidate } from '../types/delivery';
import { 
  calculateTruckVolumeStats, 
  runRebalanceSimulation, 
  exportRebalanceToExcel,
  findSpatialClustersForTruck,
  hasSpecialDeliveryCondition
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
  // Rebalancing mode: 'targeted' (เลือกตัดเฉพาะสาย) vs 'fleet' (เกลี่ยทั้งกองรถ)
  const [rebalanceMode, setRebalanceMode] = useState<'targeted' | 'fleet'>('targeted');

  // Core Capacity Parameters (160 bottles = 100%, 90% = 144 bottles/day)
  const [workingDays, setWorkingDays] = useState<number>(26);
  const [targetCapacityPerDay, setTargetCapacityPerDay] = useState<number>(160); // 100% capacity
  const [targetPercentage, setTargetPercentage] = useState<number>(90); // 90% target

  // Targeted Cut States
  const [donorTruck, setDonorTruck] = useState<string>('13201');
  const [targetRecipientTruck, setTargetRecipientTruck] = useState<string>('');
  const [selectedClusterId, setSelectedClusterId] = useState<string>('');

  // Special conditions
  const [preserveDeliveryDays, setPreserveDeliveryDays] = useState<boolean>(true);
  const [excludeSpecialConditions, setExcludeSpecialConditions] = useState<boolean>(true);
  const [lockedMemberIds, setLockedMemberIds] = useState<string[]>([]);

  // Fleet management states
  const [newTrucks, setNewTrucks] = useState<string[]>(['13199']);
  const [newTruckInput, setNewTruckInput] = useState<string>('');
  const [lockedTrucks, setLockedTrucks] = useState<string[]>([]);

  // Simulation execution
  const [simulationResult, setSimulationResult] = useState<RebalanceResult | null>(null);
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [isApplying, setIsApplying] = useState<boolean>(false);
  const [applyProgress, setApplyProgress] = useState<string | null>(null);
  const [applySuccessMsg, setApplySuccessMsg] = useState<string | null>(null);

  // View tabs
  const [activeTab, setActiveTab] = useState<'summary' | 'reassigned' | 'map'>('map');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterTruck, setFilterTruck] = useState<string>('ALL');

  // Map refs
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const clusterCircleRef = useRef<L.Circle | null>(null);

  // 1. Baseline Truck Statistics
  const baselineStats = useMemo(() => {
    return calculateTruckVolumeStats(
      members,
      workingDays,
      targetCapacityPerDay,
      targetPercentage,
      newTrucks
    );
  }, [members, workingDays, targetCapacityPerDay, targetPercentage, newTrucks]);

  // Set default donor truck to the most overloaded truck if not set
  useEffect(() => {
    if (baselineStats.length > 0 && !baselineStats.some(t => t.truckNo === donorTruck)) {
      const topOverloaded = baselineStats.find(t => t.status === 'overload') || baselineStats[0];
      setDonorTruck(topOverloaded.truckNo);
    }
  }, [baselineStats, donorTruck]);

  // Set default recipient to new truck or underloaded truck
  useEffect(() => {
    if (newTrucks.length > 0 && !targetRecipientTruck) {
      setTargetRecipientTruck(newTrucks[0]);
    }
  }, [newTrucks, targetRecipientTruck]);

  // Selected Donor Truck Volume Data
  const donorStat = useMemo(() => {
    return baselineStats.find(s => s.truckNo === donorTruck);
  }, [baselineStats, donorTruck]);

  const targetDailyGoal = Math.round(targetCapacityPerDay * (targetPercentage / 100)); // 144 ถัง/วัน
  const excessDailyBottles = donorStat ? Math.max(0, Math.round((donorStat.dailyAvgBottles - targetDailyGoal) * 10) / 10) : 0;

  // Spatial cluster pockets for selected donor truck
  const clusterCandidates = useMemo(() => {
    if (!donorTruck || rebalanceMode !== 'targeted') return [];
    return findSpatialClustersForTruck(
      members,
      donorTruck,
      excessDailyBottles > 0 ? excessDailyBottles : 30,
      workingDays,
      { lockedMemberIds, excludeSpecialConditions, preserveDeliveryDays }
    );
  }, [members, donorTruck, excessDailyBottles, workingDays, lockedMemberIds, excludeSpecialConditions, preserveDeliveryDays, rebalanceMode]);

  useEffect(() => {
    if (clusterCandidates.length > 0 && (!selectedClusterId || !clusterCandidates.some(c => c.clusterId === selectedClusterId))) {
      setSelectedClusterId(clusterCandidates[0].clusterId);
    }
  }, [clusterCandidates, selectedClusterId]);

  const activeCluster = useMemo(() => {
    return clusterCandidates.find(c => c.clusterId === selectedClusterId) || clusterCandidates[0] || null;
  }, [clusterCandidates, selectedClusterId]);

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
    setTargetRecipientTruck(clean);
    setNewTruckInput('');
  };

  const handleRemoveNewTruck = (truckToRemove: string) => {
    setNewTrucks(prev => prev.filter(t => t !== truckToRemove));
    if (targetRecipientTruck === truckToRemove) {
      setTargetRecipientTruck('');
    }
    if (simulationResult) setSimulationResult(null);
  };

  const handleToggleLockMember = (memberId: string) => {
    setLockedMemberIds(prev => 
      prev.includes(memberId) ? prev.filter(id => id !== memberId) : [...prev, memberId]
    );
  };

  // Run Rebalance Simulation
  const handleRunSimulation = () => {
    setIsSimulating(true);
    setApplySuccessMsg(null);

    setTimeout(() => {
      try {
        const result = runRebalanceSimulation(members, {
          workingDays,
          targetCapacityPerDay,
          targetPercentage,
          donorTruck: rebalanceMode === 'targeted' ? donorTruck : undefined,
          targetRecipientTruck: rebalanceMode === 'targeted' ? targetRecipientTruck : undefined,
          selectedClusterId: rebalanceMode === 'targeted' ? selectedClusterId : undefined,
          lockedTrucks,
          lockedMemberIds,
          preserveDeliveryDays,
          excludeSpecialConditions,
          newTrucks
        });
        setSimulationResult(result);
        setActiveTab('map'); // Switch to map to view the resulting cluster
      } catch (err) {
        console.error('Rebalance simulation error:', err);
        alert('เกิดข้อผิดพลาดในการคำนวณเกลี่ยสาย');
      } finally {
        setIsSimulating(false);
      }
    }, 80);
  };

  const handleReset = () => {
    setSimulationResult(null);
    setApplySuccessMsg(null);
  };

  // Apply Rebalance to Database and Firestore
  const handleApplyRebalance = async () => {
    if (!simulationResult) return;
    const reassignedCount = simulationResult.reassignedMembers.length;
    if (!window.confirm(`ยืนยันการนำสายส่งใหม่ไปใช้จริง? จะมีการปรับสายรถของสมาชิกจำนวน ${reassignedCount.toLocaleString()} รายการ (โดยรอบส่งวันเดิมยังคงเดิม 100%)`)) {
      return;
    }

    setIsApplying(true);
    setApplyProgress('กำลังบันทึกข้อมูลลงเครื่อง...');

    try {
      const updatedMembers = simulationResult.updatedMembers;
      await saveMembers(updatedMembers);
      onMembersUpdated(updatedMembers);

      if (isFirebaseConfigured()) {
        setApplyProgress('กำลังซิงค์ข้อมูลสายส่งใหม่ขึ้น Cloud Firestore...');
        await saveMembersToCloud(updatedMembers, (done, total) => {
          setApplyProgress(`กำลังซิงค์ขึ้น Cloud: สายรถกลุ่มที่ ${done}/${total}...`);
        });
      }

      setApplySuccessMsg(`จัดตัดสายใหม่สำเร็จ! สมาชิกจำนวน ${reassignedCount.toLocaleString()} รายการ ได้ถูกโอนย้ายไปยังสาย ${targetRecipientTruck || 'ใหม่'} เรียบร้อยแล้ว`);
      setSimulationResult(null);
    } catch (err) {
      console.error('Failed to apply rebalance:', err);
      alert('เกิดข้อผิดพลาดในการบันทึกข้อมูล');
    } finally {
      setIsApplying(false);
      setApplyProgress(null);
    }
  };

  // Leaflet Map Rendering
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
    if (clusterCircleRef.current) {
      clusterCircleRef.current.remove();
      clusterCircleRef.current = null;
    }

    const bounds = L.latLngBounds([]);
    let count = 0;

    // SCENARIO 1: We have a simulation result -> Show old stops vs reassigned cluster stops
    if (simulationResult && simulationResult.reassignedMembers.length > 0) {
      simulationResult.reassignedMembers.forEach(m => {
        if (m.hasGps && m.lat && m.lng) {
          const marker = L.circleMarker([m.lat, m.lng], {
            radius: 7,
            fillColor: '#9333ea', // Purple for new cluster
            color: '#ffffff',
            weight: 2,
            opacity: 1,
            fillOpacity: 0.9
          });

          marker.bindPopup(`
            <div style="font-family: sans-serif; font-size: 12px; line-height: 1.4;">
              <strong style="color: #1e293b;">${m.memberName}</strong> (${m.memberId})<br/>
              <span style="color: #64748b;">${m.address || '-'}</span><br/>
              <hr style="margin: 4px 0; border: none; border-top: 1px solid #e2e8f0;"/>
              <span style="color: #dc2626;">สายเดิม: ${m.oldTruck}</span> &rarr; 
              <strong style="color: #16a34a;">สายใหม่: ${m.newTruck}</strong><br/>
              <span>รอบส่ง (คงเดิม): <strong>${m.deliveryDays.join(', ')}</strong></span><br/>
              <span>ยอดส่ง: <strong>${m.monthlyBottles}</strong> ถัง/เดือน</span>
            </div>
          `);

          markersLayer.addLayer(marker);
          bounds.extend([m.lat, m.lng]);
          count++;
        }
      });
    } 
    // SCENARIO 2: Targeted mode preview -> Show donor truck points and highlight active spatial pocket cluster
    else if (rebalanceMode === 'targeted' && donorTruck) {
      const donorMembers = members.filter(m => m.truckNo.trim() === donorTruck.trim());
      const clusterMemberIds = new Set(activeCluster ? activeCluster.members.map(m => m.id) : []);

      donorMembers.forEach(m => {
        if (m.hasGps && m.lat && m.lng) {
          const inCluster = clusterMemberIds.has(m.id);
          const marker = L.circleMarker([m.lat, m.lng], {
            radius: inCluster ? 7 : 4.5,
            fillColor: inCluster ? '#9333ea' : '#3b82f6', // Purple for pocket, Blue for rest of donor truck
            color: '#ffffff',
            weight: inCluster ? 2 : 1,
            opacity: 1,
            fillOpacity: inCluster ? 0.95 : 0.6
          });

          marker.bindPopup(`
            <div style="font-family: sans-serif; font-size: 12px; line-height: 1.4;">
              <strong style="color: #1e293b;">${m.name}</strong> (${m.id})<br/>
              <span style="color: #64748b;">${m.address || '-'}</span><br/>
              <hr style="margin: 4px 0; border: none; border-top: 1px solid #e2e8f0;"/>
              <span>สายรถ: <strong>${m.truckNo}</strong></span><br/>
              <span>รอบส่ง: <strong>${m.deliveryDays.join(', ')}</strong></span><br/>
              <span>สถานะกลุ่มก้อน: <strong style="color: ${inCluster ? '#9333ea' : '#3b82f6'};">${inCluster ? 'อยู่ในกลุ่มก้อนที่จะตัด' : 'คงอยู่ในสายเดิม'}</strong></span>
            </div>
          `);

          markersLayer.addLayer(marker);
          bounds.extend([m.lat, m.lng]);
          count++;
        }
      });

      // Draw cluster circle visual boundary
      if (activeCluster && activeCluster.radiusKm > 0) {
        const circle = L.circle([activeCluster.seedLat, activeCluster.seedLng], {
          radius: activeCluster.radiusKm * 1000,
          color: '#9333ea',
          weight: 2,
          dashArray: '5, 5',
          fillColor: '#9333ea',
          fillOpacity: 0.1
        });
        circle.addTo(map);
        clusterCircleRef.current = circle;
      }
    }

    if (count > 0 && bounds.isValid()) {
      map.fitBounds(bounds, { padding: [40, 40] });
    }
  }, [activeTab, simulationResult, rebalanceMode, donorTruck, activeCluster, members]);

  // Current display stats
  const currentDisplayStats = simulationResult ? simulationResult.statsAfter : baselineStats;
  const beforeStatsMap = useMemo(() => {
    return new Map<string, TruckVolumeStats>(baselineStats.map(s => [s.truckNo, s]));
  }, [baselineStats]);

  // Filtered members in donor truck
  const donorMemberList = useMemo(() => {
    if (!donorTruck) return [];
    return members.filter(m => m.truckNo.trim() === donorTruck.trim());
  }, [members, donorTruck]);

  return (
    <div className="space-y-5">
      
      {/* Top Banner */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              จัดตัดเกลี่ยสายส่งน้ำดื่ม (Route Rebalancing)
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
              ฐาน 160 ถัง/วัน (100%) &bull; เป้าหมาย 90% ({targetDailyGoal} ถัง/วัน)
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            เลือกตัดสายรายคันเป็นกลุ่มก้อนเชิงพื้นที่บนแผนที่ (Spatial Pocket Clustering) 
            พร้อมเงื่อนไขพิเศษ <strong className="text-slate-700">คงรอบส่งวันเดิมของสมาชิก 100%</strong>
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {simulationResult && (
            <>
              <button
                onClick={() => exportRebalanceToExcel(simulationResult)}
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
                กำลังคำนวณกลุ่มก้อน...
              </span>
            ) : (
              <span>{rebalanceMode === 'targeted' ? `จำลองตัดสาย ${donorTruck} (${targetDailyGoal} ถัง)` : 'คำนวณเกลี่ยทั้งกองรถ'}</span>
            )}
          </button>

          {(simulationResult) && (
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

      {/* Mode Switcher */}
      <div className="bg-slate-100 p-1.5 rounded-xl border border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setRebalanceMode('targeted'); setSimulationResult(null); }}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
              rebalanceMode === 'targeted'
                ? 'bg-white text-blue-700 shadow-xs border border-slate-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span>🎯 โหมด 1: เลือกตัดเฉพาะสาย (Targeted Cluster Cut)</span>
          </button>

          <button
            onClick={() => { setRebalanceMode('fleet'); setSimulationResult(null); }}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
              rebalanceMode === 'fleet'
                ? 'bg-white text-blue-700 shadow-xs border border-slate-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span>⚖️ โหมด 2: เกลี่ยทั้งกองรถให้ได้ 90% (Fleet Rebalance)</span>
          </button>
        </div>

        <div className="hidden sm:flex items-center gap-4 text-xs text-slate-500 pr-3">
          <span>ความจุมาตรฐาน 100%: <strong>160 ถัง/วัน</strong></span>
          <span>&bull;</span>
          <span>เป้าหมายเกลี่ย 90%: <strong>144 ถัง/วัน</strong></span>
        </div>
      </div>

      {/* Targeted Cut Configuration Panel */}
      {rebalanceMode === 'targeted' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          
          {/* Card 1: Donor Truck Selection */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              1. เลือกเบอร์สายรถที่จะตัดยอด (Donor Truck)
            </label>
            <select
              value={donorTruck}
              onChange={e => {
                setDonorTruck(e.target.value);
                setSimulationResult(null);
              }}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-800 font-semibold bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {baselineStats.map(t => (
                <option key={t.truckNo} value={t.truckNo}>
                  สาย {t.truckNo} — ยอดส่ง {t.dailyAvgBottles} ถัง/วัน ({t.utilizationRate}%) {t.status === 'overload' ? '🔥 งานล้น' : ''}
                </option>
              ))}
            </select>

            {donorStat && (
              <div className="mt-3 p-2.5 bg-slate-50 rounded-lg border border-slate-200 text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-500">ยอดส่งเฉลี่ยปัจจุบัน:</span>
                  <strong className="text-slate-800">{donorStat.dailyAvgBottles} ถัง/วัน</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">เป้าหมาย 90%:</span>
                  <strong className="text-blue-600">{targetDailyGoal} ถัง/วัน</strong>
                </div>
                <div className="flex justify-between border-t border-slate-200 pt-1">
                  <span className="text-slate-600 font-medium">ยอดถังส่วนเกินที่ต้องตัด:</span>
                  <strong className="text-rose-600 font-bold">
                    {excessDailyBottles > 0 ? `+${excessDailyBottles} ถัง/วัน (~${Math.round(excessDailyBottles * workingDays)} ถัง/เดือน)` : '0 ถัง (ไม่เกินเป้า)'}
                  </strong>
                </div>
              </div>
            )}
          </div>

          {/* Card 2: Recipient Truck Selection */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              2. โอนเข้าสายรถปลายทาง (Recipient Truck)
            </label>
            <div className="flex gap-2 mb-2">
              <select
                value={targetRecipientTruck}
                onChange={e => setTargetRecipientTruck(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-800 font-semibold bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <optgroup label="สายรถใหม่ที่เพิ่ม">
                  {newTrucks.map(t => (
                    <option key={t} value={t}>สายใหม่: {t}</option>
                  ))}
                </optgroup>
                <optgroup label="สายรถเดิมข้างเคียง">
                  {baselineStats.filter(t => t.truckNo !== donorTruck).map(t => (
                    <option key={t.truckNo} value={t.truckNo}>
                      สายเดิม: {t.truckNo} (ปัจจุบัน {t.dailyAvgBottles} ถัง/วัน)
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>

            {/* Quick Add New Truck form */}
            <form onSubmit={handleAddNewTruck} className="flex gap-1.5 mt-2">
              <input
                type="text"
                placeholder="เพิ่มเบอร์สายใหม่ เช่น 13199"
                value={newTruckInput}
                onChange={e => setNewTruckInput(e.target.value)}
                className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="submit"
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold whitespace-nowrap transition"
              >
                + เพิ่ม
              </button>
            </form>
          </div>

          {/* Card 3: Spatial Cluster Pocket Selector */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-slate-700">
                3. เลือกกลุ่มก้อนเชิงพื้นที่บนแผนที่ (Spatial Pocket)
              </label>
              <span className="text-[10px] text-purple-700 font-semibold bg-purple-50 px-2 py-0.5 rounded border border-purple-200">
                เป็นกลุ่มก้อน 100%
              </span>
            </div>

            {clusterCandidates.length === 0 ? (
              <div className="text-xs text-slate-400 py-3 text-center">
                ไม่พบกลุ่มก้อนที่ตรงเงื่อนไข หรือสายนี้ไม่มีสมาชิกล้น
              </div>
            ) : (
              <div className="space-y-2">
                {clusterCandidates.map((c, idx) => (
                  <button
                    key={c.clusterId}
                    type="button"
                    onClick={() => setSelectedClusterId(c.clusterId)}
                    className={`w-full text-left p-2.5 rounded-lg border text-xs transition ${
                      selectedClusterId === c.clusterId
                        ? 'bg-purple-50 border-purple-400 ring-1 ring-purple-400'
                        : 'bg-white border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-800">
                        {c.label}
                      </span>
                      <span className="font-mono font-bold text-purple-700">
                        {c.memberCount} จุด
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5 flex items-center justify-between">
                      <span>รัศมีก้อน: ~{c.radiusKm} กม.</span>
                      <span>ตัดยอด: ~{c.dailyAvgBottles} ถัง/วัน</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

        </div>
      ) : (
        /* Fleet Wide Controls */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              ความจุมาตรฐานต่อคัน (ถัง/วัน)
            </label>
            <input
              type="number"
              value={targetCapacityPerDay}
              onChange={e => setTargetCapacityPerDay(parseInt(e.target.value, 10) || 160)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-800 font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-[11px] text-slate-400 mt-1 block">
              1 วันรถวิ่ง = 160 ถัง (100% capacity)
            </span>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              เป้าหมายตัดเกลี่ย (%)
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={70}
                max={100}
                value={targetPercentage}
                onChange={e => setTargetPercentage(parseInt(e.target.value, 10))}
                className="w-full accent-blue-600 cursor-pointer"
              />
              <span className="text-sm font-bold text-blue-700 w-12 text-right">
                {targetPercentage}%
              </span>
            </div>
            <span className="text-[11px] text-slate-400 mt-1 block">
              เป้าหมายที่แท้จริง = {targetDailyGoal} ถัง/วัน
            </span>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              สายรถใหม่เพื่อรองรับยอดเกลี่ย
            </label>
            <form onSubmit={handleAddNewTruck} className="flex gap-1.5">
              <input
                type="text"
                placeholder="เช่น 13199"
                value={newTruckInput}
                onChange={e => setNewTruckInput(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs text-slate-800"
              />
              <button
                type="submit"
                className="px-3 py-2 bg-blue-600 text-white rounded-lg text-xs font-semibold"
              >
                + เพิ่ม
              </button>
            </form>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {newTrucks.map(t => (
                <span key={t} className="px-2 py-0.5 rounded text-[11px] bg-purple-100 text-purple-800 font-semibold border border-purple-200 flex items-center gap-1">
                  <span>{t}</span>
                  <button onClick={() => handleRemoveNewTruck(t)} className="text-purple-600 hover:text-red-600 font-bold">×</button>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Special Conditions Bar */}
      <div className="bg-amber-50/60 border border-amber-200/80 p-3.5 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 text-amber-900 font-semibold">
          <span className="text-base">🛡️</span>
          <span>เงื่อนไขพิเศษการตัดสาย (Special Constraints):</span>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-slate-700">
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={preserveDeliveryDays}
              onChange={e => setPreserveDeliveryDays(e.target.checked)}
              className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4"
            />
            <span className="font-semibold text-slate-800">
              สมาชิกไม่เปลี่ยนวัน (คงรอบส่งวันเดิม 100%)
            </span>
          </label>

          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={excludeSpecialConditions}
              onChange={e => setExcludeSpecialConditions(e.target.checked)}
              className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4"
            />
            <span>
              ห้ามย้ายรอบสมาชิกเงื่อนไขพิเศษ (โทรสั่งก่อนหมด / รอบเว้นรอบ / เฝ้าระวัง)
            </span>
          </label>
        </div>
      </div>

      {/* Main Tabs Navigation */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        
        <div className="p-3 border-b border-slate-200 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setActiveTab('map')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                activeTab === 'map' ? 'bg-white text-blue-700 shadow-xs border border-slate-200' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>🗺️ แผนที่แสดงกลุ่มก้อน</span>
              {activeCluster && (
                <span className="px-1.5 py-0.2 bg-purple-100 text-purple-700 text-[10px] rounded-full">
                  รัศมี {activeCluster.radiusKm} กม.
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('summary')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                activeTab === 'summary' ? 'bg-white text-blue-700 shadow-xs border border-slate-200' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              ตารางเปรียบเทียบสายรถ ({currentDisplayStats.length})
            </button>

            <button
              onClick={() => setActiveTab('reassigned')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                activeTab === 'reassigned' ? 'bg-white text-blue-700 shadow-xs border border-slate-200' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              จุดส่งที่ตัดย้าย ({simulationResult ? simulationResult.reassignedMembers.length : 0})
            </button>
          </div>

          <div className="text-xs text-slate-500 hidden sm:block">
            {simulationResult ? (
              <span className="text-emerald-700 font-bold">
                ✓ จำลองตัดสายแล้ว ({simulationResult.reassignedMembers.length} จุดส่ง)
              </span>
            ) : (
              <span>กดปุ่ม <strong>"จำลองตัดสาย"</strong> ด้านบนเพื่อดูผลลัพธ์</span>
            )}
          </div>
        </div>

        {/* Tab Content: Map View */}
        {activeTab === 'map' && (
          <div className="p-4">
            <div className="mb-2 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1 text-slate-600">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-blue-500" />
                  <span>สายเดิม ({donorTruck})</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-purple-600 ring-2 ring-purple-200" />
                  <span className="font-bold text-purple-800">
                    กลุ่มก้อนที่จะตัดย้าย ({activeCluster ? `${activeCluster.memberCount} จุด` : '0 จุด'})
                  </span>
                </span>
              </div>
              <span className="text-[11px] text-slate-400">
                จุดหมุดสีม่วงคือสมาชิกที่จะถูกตัดย้ายเป็นกลุ่มก้อนเดียวเชิงพื้นที่
              </span>
            </div>

            <div 
              ref={mapContainerRef} 
              className="h-[520px] w-full rounded-lg border border-slate-200 overflow-hidden" 
            />
          </div>
        )}

        {/* Tab Content: Summary Table */}
        {activeTab === 'summary' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                  <th className="py-2.5 px-3">เบอร์รถ</th>
                  <th className="py-2.5 px-3 text-right">จุดส่ง (จุด)</th>
                  <th className="py-2.5 px-3 text-right">ยอดถังต่อเดือน</th>
                  <th className="py-2.5 px-3 text-right">ยอดส่งเฉลี่ยต่อวัน</th>
                  <th className="py-2.5 px-3 text-center">สัดส่วนต่อความจุ (ฐาน 160 ถัง)</th>
                  <th className="py-2.5 px-3 text-center">สถานะเป้าหมาย 90% ({targetDailyGoal} ถัง)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {currentDisplayStats.map(truck => {
                  const before = beforeStatsMap.get(truck.truckNo);
                  const memberDiff = before ? truck.memberCount - before.memberCount : 0;
                  const bottleDiff = before ? truck.monthlyBottles - before.monthlyBottles : 0;

                  return (
                    <tr key={truck.truckNo} className="hover:bg-slate-50 transition">
                      <td className="py-2.5 px-3 font-semibold text-slate-900">
                        <span>{truck.truckNo}</span>
                        {truck.isNew && (
                          <span className="ml-1.5 px-1.5 py-0.2 bg-purple-100 text-purple-700 text-[10px] rounded font-medium">
                            สายใหม่
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-800">
                        <span>{truck.memberCount.toLocaleString()}</span>
                        {memberDiff !== 0 && (
                          <span className={`text-[10px] ml-1 font-semibold ${memberDiff > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                            ({memberDiff > 0 ? `+${memberDiff}` : memberDiff})
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-800">
                        <span>{truck.monthlyBottles.toLocaleString()}</span>
                        {bottleDiff !== 0 && (
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
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Tab Content: Reassigned Members */}
        {activeTab === 'reassigned' && (
          <div className="overflow-x-auto">
            {!simulationResult || simulationResult.reassignedMembers.length === 0 ? (
              <div className="py-16 text-center text-xs text-slate-500">
                ยังไม่มีรายการจุดส่งที่ถูกตัดย้าย
                <div className="mt-2">
                  กดปุ่ม <strong>"จำลองตัดสาย"</strong> ด้านบนเพื่อเริ่มวิเคราะห์
                </div>
              </div>
            ) : (
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                    <th className="py-2.5 px-3">รหัสสมาชิก</th>
                    <th className="py-2.5 px-3">ชื่อ-นามสกุล</th>
                    <th className="py-2.5 px-3">ที่อยู่จัดส่ง</th>
                    <th className="py-2.5 px-3">รอบส่ง (คงเดิม 100%)</th>
                    <th className="py-2.5 px-3 text-right">ยอดถัง (ถัง/เดือน)</th>
                    <th className="py-2.5 px-3 text-center">สายเดิม</th>
                    <th className="py-2.5 px-3 text-center">สายใหม่</th>
                    <th className="py-2.5 px-3 text-center">ระยะจากศูนย์กลาง</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {simulationResult.reassignedMembers.map(m => (
                    <tr key={m.memberId} className="hover:bg-slate-50 transition">
                      <td className="py-2.5 px-3 font-semibold text-slate-900 font-mono">
                        {m.memberId}
                      </td>
                      <td className="py-2.5 px-3 font-medium text-slate-800">
                        {m.memberName}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 max-w-xs truncate" title={m.address}>
                        {m.address || '-'}
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-emerald-700">
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
                      <td className="py-2.5 px-3 text-center text-slate-500">
                        {m.distanceKm !== undefined ? `${m.distanceKm} กม.` : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

      </div>

    </div>
  );
};
