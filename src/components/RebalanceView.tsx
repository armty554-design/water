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
  // Mode: 'targeted' (เลือกตัดเฉพาะสาย - รองรับหลายคันพร้อมกัน) vs 'fleet' (เกลี่ยทั้งกองรถ)
  const [rebalanceMode, setRebalanceMode] = useState<'targeted' | 'fleet'>('targeted');

  // Core Capacity Parameters
  // 160 * 26 = 4,160 คือ 100%, 90% = 144 * 26 = 3,744
  const [workingDays, setWorkingDays] = useState<number>(26); // กำหนดวันทำงานต่อเดือนได้อิสระ
  const targetCapacityPerDay = 160; // 160 ถัง/วัน คือ 100%
  const targetPercentage = 90; // 90%

  // Multi-Truck Donor Selection (เลือกตัดเบอร์ได้มากกว่า 1 คัน)
  const [selectedDonorTrucks, setSelectedDonorTrucks] = useState<string[]>(['13201', '13205']);
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
  const [activeTab, setActiveTab] = useState<'map' | 'summary' | 'reassigned'>('map');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterTruck, setFilterTruck] = useState<string>('ALL');

  // Map refs
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const clusterCirclesRef = useRef<L.Circle[]>([]);

  // Calculated Capacity Targets based on Working Days (160 * workingDays = 100%)
  const dailyTarget100 = 160; // 160 ถัง/วัน
  const dailyTarget90 = Math.round(160 * (targetPercentage / 100)); // 144 ถัง/วัน
  const monthlyTarget100 = dailyTarget100 * workingDays; // e.g. 160 * 26 = 4,160 ถัง/เดือน
  const monthlyTarget90 = Math.round(dailyTarget90 * workingDays); // e.g. 144 * 26 = 3,744 ถัง/เดือน

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

  // Set default recipient to new truck or underloaded truck
  useEffect(() => {
    if (newTrucks.length > 0 && !targetRecipientTruck) {
      setTargetRecipientTruck(newTrucks[0]);
    }
  }, [newTrucks, targetRecipientTruck]);

  // Aggregate Excess across all selected donor trucks
  const selectedDonorsStats = useMemo(() => {
    return baselineStats.filter(t => selectedDonorTrucks.includes(t.truckNo));
  }, [baselineStats, selectedDonorTrucks]);

  const totalExcessDaily = useMemo(() => {
    return selectedDonorsStats.reduce((sum, t) => {
      const excess = Math.max(0, t.dailyAvgBottles - dailyTarget90);
      return sum + excess;
    }, 0);
  }, [selectedDonorsStats, dailyTarget90]);

  const totalExcessMonthly = Math.round(totalExcessDaily * workingDays);

  // Spatial cluster pockets for selected donor trucks
  const clustersByTruck = useMemo(() => {
    if (rebalanceMode !== 'targeted' || selectedDonorTrucks.length === 0) return [];
    
    const allClusters: { truckNo: string; clusters: SpatialClusterCandidate[] }[] = [];
    selectedDonorTrucks.forEach(tNo => {
      const stat = baselineStats.find(s => s.truckNo === tNo);
      const excess = stat ? Math.max(10, stat.dailyAvgBottles - dailyTarget90) : 30;
      const clusters = findSpatialClustersForTruck(
        members,
        tNo,
        excess,
        workingDays,
        { lockedMemberIds, excludeSpecialConditions, preserveDeliveryDays }
      );
      if (clusters.length > 0) {
        allClusters.push({ truckNo: tNo, clusters });
      }
    });
    return allClusters;
  }, [members, selectedDonorTrucks, dailyTarget90, workingDays, lockedMemberIds, excludeSpecialConditions, preserveDeliveryDays, rebalanceMode, baselineStats]);

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

  // Toggle donor truck selection (multi-select)
  const handleToggleDonorTruck = (truckNo: string) => {
    setSelectedDonorTrucks(prev => {
      if (prev.includes(truckNo)) {
        return prev.filter(t => t !== truckNo);
      } else {
        return [...prev, truckNo];
      }
    });
    setSimulationResult(null);
  };

  // Quick select all overloaded trucks
  const handleSelectAllOverloaded = () => {
    const overloaded = baselineStats.filter(t => t.status === 'overload').map(t => t.truckNo);
    setSelectedDonorTrucks(overloaded);
    setSimulationResult(null);
  };

  const handleClearSelectedDonors = () => {
    setSelectedDonorTrucks([]);
    setSimulationResult(null);
  };

  // Run Rebalance Simulation
  const handleRunSimulation = () => {
    if (rebalanceMode === 'targeted' && selectedDonorTrucks.length === 0) {
      alert('กรุณาเลือกสายรถที่จะตัดยอดอย่างน้อย 1 คัน');
      return;
    }

    setIsSimulating(true);
    setApplySuccessMsg(null);

    setTimeout(() => {
      try {
        const result = runRebalanceSimulation(members, {
          workingDays,
          targetCapacityPerDay,
          targetPercentage,
          donorTrucks: rebalanceMode === 'targeted' ? selectedDonorTrucks : undefined,
          targetRecipientTruck: rebalanceMode === 'targeted' ? targetRecipientTruck : undefined,
          targetRecipientTrucks: newTrucks,
          selectedClusterId: (selectedDonorTrucks.length === 1 && selectedClusterId) ? selectedClusterId : undefined,
          lockedTrucks,
          lockedMemberIds,
          preserveDeliveryDays,
          excludeSpecialConditions,
          newTrucks
        });
        setSimulationResult(result);
        setActiveTab('map');
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
    if (!window.confirm(`ยืนยันการนำสายส่งใหม่ไปใช้จริง? จะมีการปรับสายรถของสมาชิกจำนวน ${reassignedCount.toLocaleString()} รายการ (โดยรอบส่งวันเดิมคงเดิม 100%)`)) {
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
          setApplyProgress(`กำลังซิงค์ขึ้น Cloud: กลุ่มสายรถที่ ${done}/${total}...`);
        });
      }

      setApplySuccessMsg(`จัดตัดสายใหม่สำเร็จ! สมาชิกจำนวน ${reassignedCount.toLocaleString()} รายการ ได้รับการโอนย้ายเรียบร้อยแล้ว`);
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
    clusterCirclesRef.current.forEach(c => c.remove());
    clusterCirclesRef.current = [];

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
              <span>รอบส่ง (คงเดิม 100%): <strong>${m.deliveryDays.join(', ')}</strong></span><br/>
              <span>ยอดส่ง: <strong>${m.monthlyBottles}</strong> ถัง/เดือน</span>
            </div>
          `);

          markersLayer.addLayer(marker);
          bounds.extend([m.lat, m.lng]);
          count++;
        }
      });
    } 
    // SCENARIO 2: Targeted mode preview -> Show selected donor trucks points & spatial pockets
    else if (rebalanceMode === 'targeted' && selectedDonorTrucks.length > 0) {
      // Collect all cluster member IDs across all selected trucks
      const allClusterMemberIds = new Set<string>();
      clustersByTruck.forEach(item => {
        const topCluster = item.clusters[0];
        if (topCluster) {
          topCluster.members.forEach(m => allClusterMemberIds.add(m.id));

          // Draw circle boundary for this cluster
          if (topCluster.radiusKm > 0) {
            const circle = L.circle([topCluster.seedLat, topCluster.seedLng], {
              radius: topCluster.radiusKm * 1000,
              color: '#9333ea',
              weight: 2,
              dashArray: '5, 5',
              fillColor: '#9333ea',
              fillOpacity: 0.12
            });
            circle.addTo(map);
            clusterCirclesRef.current.push(circle);
          }
        }
      });

      const donorMembers = members.filter(m => selectedDonorTrucks.includes(m.truckNo.trim()));

      donorMembers.forEach(m => {
        if (m.hasGps && m.lat && m.lng) {
          const inCluster = allClusterMemberIds.has(m.id);
          const marker = L.circleMarker([m.lat, m.lng], {
            radius: inCluster ? 7 : 4.5,
            fillColor: inCluster ? '#9333ea' : '#3b82f6',
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
              <span>รอบส่ง (คงเดิม): <strong>${m.deliveryDays.join(', ')}</strong></span><br/>
              <span>สถานะ: <strong style="color: ${inCluster ? '#9333ea' : '#3b82f6'};">${inCluster ? 'อยู่ในกลุ่มก้อนที่จะตัดย้าย' : 'คงอยู่ในสายเดิม'}</strong></span>
            </div>
          `);

          markersLayer.addLayer(marker);
          bounds.extend([m.lat, m.lng]);
          count++;
        }
      });
    }

    if (count > 0 && bounds.isValid()) {
      map.fitBounds(bounds, { padding: [40, 40] });
    }
  }, [activeTab, simulationResult, rebalanceMode, selectedDonorTrucks, clustersByTruck, members]);

  // Current display stats
  const currentDisplayStats = simulationResult ? simulationResult.statsAfter : baselineStats;
  const beforeStatsMap = useMemo(() => {
    return new Map<string, TruckVolumeStats>(baselineStats.map(s => [s.truckNo, s]));
  }, [baselineStats]);

  return (
    <div className="space-y-5">
      
      {/* Top Banner with Exact Calculation Formula */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              ระบบจัดตัดเกลี่ยสายส่งน้ำดื่ม (Route Rebalancing)
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
              เกณฑ์ 160 ถัง/วัน &bull; เป้าหมาย 90%
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            ตัดยอดสายรถล้นเป็นกลุ่มก้อนเชิงพื้นที่บนแผนที่ (Spatial Pocket Cluster) พร้อมเงื่อนไข 
            <strong className="text-slate-700 ml-1">สมาชิกไม่เปลี่ยนวันส่ง 100%</strong>
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
              <span>
                {rebalanceMode === 'targeted' 
                  ? `จำลองตัดสาย (${selectedDonorTrucks.length} คันที่เลือก)` 
                  : 'คำนวณเกลี่ยทั้งกองรถ'}
              </span>
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

      {/* Formula & Working Days Bar (160 * workingDays = 100%, 90% = 144 * workingDays) */}
      <div className="bg-gradient-to-r from-blue-900 to-indigo-900 text-white p-4 rounded-xl shadow-xs">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-wider font-semibold text-blue-200">
                สูตรคำนวณเกณฑ์กำลังส่งต่อเดือน
              </span>
              <span className="text-[10px] bg-blue-800/80 text-blue-200 px-2 py-0.5 rounded-full border border-blue-700">
                {workingDays} วันทำงาน
              </span>
            </div>
            <div className="text-sm sm:text-base font-bold flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="text-emerald-300">
                100% ความจุ = 160 × {workingDays} = <strong>{monthlyTarget100.toLocaleString()}</strong> ถัง/เดือน
              </span>
              <span className="text-blue-300">|</span>
              <span className="text-amber-300">
                90% เป้าหมาย = 144 × {workingDays} = <strong>{monthlyTarget90.toLocaleString()}</strong> ถัง/เดือน
              </span>
            </div>
          </div>

          {/* Working Days Input Control (ให้กำหนดวันทำงานได้อิสระ) */}
          <div className="flex items-center gap-2 bg-blue-950/70 p-2 rounded-lg border border-blue-700/60">
            <label className="text-xs text-blue-200 whitespace-nowrap">
              กำหนดวันทำงาน:
            </label>
            <input
              type="number"
              min={15}
              max={31}
              value={workingDays}
              onChange={e => {
                const val = Math.max(1, parseInt(e.target.value, 10) || 26);
                setWorkingDays(val);
                setSimulationResult(null);
              }}
              className="w-16 px-2 py-1 bg-blue-900 border border-blue-600 rounded text-center text-sm font-bold text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <span className="text-xs text-blue-300">วัน/เดือน</span>
          </div>

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
            <span>🎯 โหมด 1: เลือกตัดสายรายคัน (เลือกได้มากกว่า 1 คัน)</span>
          </button>

          <button
            onClick={() => { setRebalanceMode('fleet'); setSimulationResult(null); }}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
              rebalanceMode === 'fleet'
                ? 'bg-white text-blue-700 shadow-xs border border-slate-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span>⚖️ โหมด 2: เกลี่ยทั้งกองรถให้อยู่ในเกณฑ์ 90%</span>
          </button>
        </div>
      </div>

      {/* Multi-Truck Targeted Cut Panel */}
      {rebalanceMode === 'targeted' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          
          {/* Column 1: Multi-Truck Donor Selector (7 Cols) */}
          <div className="lg:col-span-7 bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-3">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
              <div>
                <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <span>1. เลือกเบอร์สายรถที่จะตัดยอด</span>
                  <span className="text-[11px] font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                    เลือกแล้ว {selectedDonorTrucks.length} คัน
                  </span>
                </label>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  สามารถติ๊กเลือกได้หลายคันพร้อมกันเพื่อตัดกลุ่มก้อนที่มียอดเกิน 90% ({dailyTarget90} ถัง/วัน)
                </p>
              </div>

              <div className="flex items-center gap-1.5 text-xs">
                <button
                  type="button"
                  onClick={handleSelectAllOverloaded}
                  className="px-2 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded text-[11px] font-semibold transition"
                >
                  + เลือกทุกสายที่เกิน 90%
                </button>
                <button
                  type="button"
                  onClick={handleClearSelectedDonors}
                  className="px-2 py-1 text-slate-500 hover:text-slate-800 rounded text-[11px] transition"
                >
                  ล้าง
                </button>
              </div>
            </div>

            {/* Scrollable Checkbox List of All Trucks */}
            <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1 divide-y divide-slate-50">
              {baselineStats.map(t => {
                const isSelected = selectedDonorTrucks.includes(t.truckNo);
                const isOver = t.status === 'overload';
                const excess = Math.max(0, Math.round((t.dailyAvgBottles - dailyTarget90) * 10) / 10);

                return (
                  <label
                    key={t.truckNo}
                    className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition text-xs ${
                      isSelected
                        ? 'bg-blue-50/80 border border-blue-300'
                        : 'hover:bg-slate-50 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleToggleDonorTruck(t.truckNo)}
                        className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
                      />
                      <div>
                        <span className="font-bold text-slate-800 text-sm">
                          สาย {t.truckNo}
                        </span>
                        <span className="text-[11px] text-slate-500 ml-2">
                          ({t.memberCount} จุด &bull; {t.monthlyBottles.toLocaleString()} ถัง/ด.)
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <span className="font-bold text-slate-800">{t.dailyAvgBottles}</span>
                        <span className="text-[10px] text-slate-400 ml-0.5">ถัง/วัน</span>
                      </div>

                      {isOver ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700 border border-rose-200">
                          เกิน +{excess} ถัง
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200">
                          ปกติ
                        </span>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>

            {/* Selected Donors Summary Banner */}
            {selectedDonorTrucks.length > 0 && (
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="text-slate-500">สายที่เลือกตัด: </span>
                  <strong className="text-slate-800">{selectedDonorTrucks.join(', ')}</strong>
                </div>
                <div>
                  <span className="text-slate-600">ยอดส่วนเกินที่จะตัดออกรวม: </span>
                  <strong className="text-rose-600 font-bold">
                    +{totalExcessDaily} ถัง/วัน ({totalExcessMonthly.toLocaleString()} ถัง/เดือน)
                  </strong>
                </div>
              </div>
            )}
          </div>

          {/* Column 2: Recipient Truck & Clusters (5 Cols) */}
          <div className="lg:col-span-5 space-y-4">
            
            {/* Recipient Truck */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
              <label className="block text-xs font-bold text-slate-800 mb-1.5">
                2. สายรถปลายทางที่จะรับโอน (Recipient Truck)
              </label>
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
                <optgroup label="สายรถเดิม">
                  {baselineStats.filter(t => !selectedDonorTrucks.includes(t.truckNo)).map(t => (
                    <option key={t.truckNo} value={t.truckNo}>
                      สายเดิม: {t.truckNo} (ปัจจุบัน {t.dailyAvgBottles} ถัง/วัน)
                    </option>
                  ))}
                </optgroup>
              </select>

              {/* Add New Truck Form */}
              <form onSubmit={handleAddNewTruck} className="flex gap-1.5 mt-2.5">
                <input
                  type="text"
                  placeholder="เพิ่มสายใหม่ เช่น 13200"
                  value={newTruckInput}
                  onChange={e => setNewTruckInput(e.target.value)}
                  className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="submit"
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold whitespace-nowrap transition"
                >
                  + เพิ่มสายใหม่
                </button>
              </form>

              {newTrucks.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {newTrucks.map(t => (
                    <span key={t} className="px-2 py-0.5 rounded text-[11px] bg-purple-100 text-purple-800 font-semibold border border-purple-200 flex items-center gap-1">
                      <span>{t}</span>
                      <button onClick={() => handleRemoveNewTruck(t)} className="text-purple-600 hover:text-red-600 font-bold">×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Clusters Summary */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-bold text-slate-800">
                  3. กลุ่มก้อนเชิงพื้นที่ที่จะถูกตัดย้าย
                </label>
                <span className="text-[10px] text-purple-700 font-semibold bg-purple-50 px-2 py-0.5 rounded border border-purple-200">
                  กลุ่มก้อนบนแผนที่
                </span>
              </div>

              {clustersByTruck.length === 0 ? (
                <div className="text-xs text-slate-400 py-3 text-center">
                  เลือกสายรถด้านซ้ายเพื่อวิเคราะห์กลุ่มก้อน
                </div>
              ) : (
                <div className="space-y-1.5 max-h-44 overflow-y-auto">
                  {clustersByTruck.map(item => {
                    const topCluster = item.clusters[0];
                    return (
                      <div key={item.truckNo} className="p-2 bg-purple-50/60 rounded-lg border border-purple-200 text-xs">
                        <div className="flex justify-between font-bold text-slate-800">
                          <span>สาย {item.truckNo}</span>
                          <span className="text-purple-700">{topCluster.memberCount} จุดส่ง</span>
                        </div>
                        <div className="flex justify-between text-[11px] text-slate-500 mt-0.5">
                          <span>รัศมีก้อน: ~{topCluster.radiusKm} กม.</span>
                          <span>ยอดตัด: ~{topCluster.dailyAvgBottles} ถัง/วัน</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

          </div>

        </div>
      ) : (
        /* Fleet Mode Controls */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              ความจุมาตรฐานต่อคัน
            </label>
            <div className="text-sm font-bold text-slate-800 p-2 bg-slate-50 rounded border border-slate-200">
              160 ถัง/วัน ({monthlyTarget100.toLocaleString()} ถัง/เดือน)
            </div>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              เป้าหมายตัดเกลี่ย (90%)
            </label>
            <div className="text-sm font-bold text-blue-700 p-2 bg-blue-50 rounded border border-blue-200">
              144 ถัง/วัน ({monthlyTarget90.toLocaleString()} ถัง/เดือน)
            </div>
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
              <button type="submit" className="px-3 py-2 bg-blue-600 text-white rounded-lg text-xs font-semibold">
                + เพิ่ม
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Special Constraints Bar (สมาชิกไม่เปลี่ยนวัน / ห้ามย้ายรอบ) */}
      <div className="bg-amber-50/60 border border-amber-200/80 p-3.5 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 text-amber-900 font-semibold">
          <span className="text-base">🛡️</span>
          <span>เงื่อนไขพิเศษการตัดสาย:</span>
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

      {/* Tabs & Visualizations */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        
        <div className="p-3 border-b border-slate-200 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setActiveTab('map')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                activeTab === 'map' ? 'bg-white text-blue-700 shadow-xs border border-slate-200' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>🗺️ แผนที่กลุ่มก้อนที่เลือกตัด</span>
            </button>

            <button
              onClick={() => setActiveTab('summary')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                activeTab === 'summary' ? 'bg-white text-blue-700 shadow-xs border border-slate-200' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              ตารางเปรียบเทียบทุกสายรถ ({currentDisplayStats.length})
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
              <span>กดปุ่ม <strong>"จำลองตัดสาย"</strong> ด้านบนเพื่อประมวลผล</span>
            )}
          </div>
        </div>

        {/* Tab 1: Map View */}
        {activeTab === 'map' && (
          <div className="p-4">
            <div className="mb-2 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1 text-slate-600">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-blue-500" />
                  <span>สายเดิมที่เลือก ({selectedDonorTrucks.join(', ') || 'ไม่มี'})</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-purple-600 ring-2 ring-purple-200" />
                  <span className="font-bold text-purple-800">
                    กลุ่มก้อนเชิงพื้นที่ที่จะตัดย้าย
                  </span>
                </span>
              </div>
              <span className="text-[11px] text-slate-400">
                วงกลมประสีม่วงแสดงขอบเขตกลุ่มก้อนเชิงพื้นที่ (รัศมีเป็นกลุ่มก้อนชัดเจน)
              </span>
            </div>

            <div 
              ref={mapContainerRef} 
              className="h-[520px] w-full rounded-lg border border-slate-200 overflow-hidden" 
            />
          </div>
        )}

        {/* Tab 2: Summary Table */}
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
                  <th className="py-2.5 px-3 text-center">สถานะเป้าหมาย 90% ({dailyTarget90} ถัง)</th>
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
                        {selectedDonorTrucks.includes(truck.truckNo) && (
                          <span className="ml-1.5 px-1.5 py-0.2 bg-blue-100 text-blue-700 text-[10px] rounded font-medium">
                            สายที่เลือกตัด
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

        {/* Tab 3: Reassigned Members */}
        {activeTab === 'reassigned' && (
          <div className="overflow-x-auto">
            {!simulationResult || simulationResult.reassignedMembers.length === 0 ? (
              <div className="py-16 text-center text-xs text-slate-500">
                ยังไม่มีรายการจุดส่งที่ถูกตัดย้าย
                <div className="mt-2">
                  เลือกสายรถที่ต้องการตัดด้านบน แล้วกด <strong>"จำลองตัดสาย"</strong>
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
