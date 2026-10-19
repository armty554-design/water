import React, { useState, useMemo, useEffect, useRef } from 'react';
import L from 'leaflet';
import { Member, RebalanceResult, TruckVolumeStats, SpatialClusterCandidate } from '../types/delivery';
import { 
  calculateTruckVolumeStats, 
  runRebalanceSimulation, 
  exportRebalanceToExcel,
  findSpatialClustersForTruck,
  calculateMemberMonthlyBottles,
  calculateDistanceKm
} from '../services/rebalance';
import { saveMembers } from '../services/db';
import { saveMembersToCloud, isFirebaseConfigured } from '../services/firebase';
import { parseAvgBottlesFile, mergeAvgBottlesIntoMembers } from '../services/excelParser';

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
  // Wizard Steps: 1 = Setup Scope, 2 = Interactive Studio, 3 = Review & Finalize
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);

  // Core Capacity Parameters
  const [workingDays, setWorkingDays] = useState<number>(26);
  const targetCapacityPerDay = 160; // 100% capacity
  const targetPercentage = 90; // 90% threshold
  const dailyTarget100 = 160;
  const dailyTarget90 = Math.round(160 * (targetPercentage / 100)); // 144
  const monthlyTarget100 = dailyTarget100 * workingDays;
  const monthlyTarget90 = dailyTarget90 * workingDays;

  // Step 1 Selections
  const [targetRecipientTruck, setTargetRecipientTruck] = useState<string>('13S01');
  const [selectedDonorTrucks, setSelectedDonorTrucks] = useState<string[]>(['13205', '13206', '13202']);
  const [selectedDeliveryDays, setSelectedDeliveryDays] = useState<string[]>(['อังคาร', 'พฤหัสบดี', 'เสาร์']);
  const [isDissolveTruck, setIsDissolveTruck] = useState<boolean>(false);
  const [donorSearchQuery, setDonorSearchQuery] = useState<string>('');
  const [recipientSearchQuery, setRecipientSearchQuery] = useState<string>('');
  const [newTruckInput, setNewTruckInput] = useState<string>('');
  const [newTrucks, setNewTrucks] = useState<string[]>(['13S01', '13199']);

  // Step 2 Interactive Staging State: Map of transferred nearby groups/stops to targetRecipientTruck
  // Key: clusterId, Value: { donorTruck: string; cluster: SpatialClusterCandidate }
  const [stagedTransfers, setStagedTransfers] = useState<Map<string, { donorTruck: string; cluster: SpatialClusterCandidate }>>(new Map());
  const [hoveredNearbyId, setHoveredNearbyId] = useState<string | null>(null);
  const [selectedIndividualMemberIds, setSelectedIndividualMemberIds] = useState<Set<string>>(new Set());

  // Simulation execution / Persistence state
  const [simulationResult, setSimulationResult] = useState<RebalanceResult | null>(null);
  const [isApplying, setIsApplying] = useState<boolean>(false);
  const [applyProgress, setApplyProgress] = useState<string | null>(null);
  const [applySuccessMsg, setApplySuccessMsg] = useState<string | null>(null);

  // Map refs
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const clusterCircleLayerRef = useRef<L.LayerGroup | null>(null);

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

  // Compute available pocket clusters for each selected donor truck
  // Each donor can produce 1-3 contiguous pocket clusters strictly for selected delivery days
  const donorClustersMap = useMemo(() => {
    const map = new Map<string, SpatialClusterCandidate[]>();

    selectedDonorTrucks.forEach(tNo => {
      const stat = baselineStats.find(s => s.truckNo === tNo);
      const currentDaily = stat ? stat.dailyAvgBottles : dailyTarget90;
      const excessDaily = Math.max(10, currentDaily - dailyTarget90);

      const clusters = findSpatialClustersForTruck(
        members,
        tNo,
        excessDaily,
        workingDays,
        {
          preserveDeliveryDays: true,
          excludeSpecialConditions: true,
          filterDays: selectedDeliveryDays
        }
      );
      map.set(tNo, clusters);
    });

    return map;
  }, [members, selectedDonorTrucks, baselineStats, dailyTarget90, workingDays, selectedDeliveryDays]);

  // Handle Adding New Truck
  const handleAddNewTruck = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = newTruckInput.trim().toUpperCase().replace(/\//g, '_');
    if (!clean) return;
    if (!newTrucks.includes(clean)) {
      setNewTrucks(prev => [...prev, clean]);
    }
    setTargetRecipientTruck(clean);
    setNewTruckInput('');
  };

  // Toggle delivery day selection
  const handleToggleDay = (day: string) => {
    if (day === 'ALL') {
      setSelectedDeliveryDays([]);
    } else {
      setSelectedDeliveryDays(prev => 
        prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
      );
    }
    setStagedTransfers(new Map());
    setSimulationResult(null);
  };

  // Toggle donor selection
  const handleToggleDonor = (tNo: string) => {
    setSelectedDonorTrucks(prev => 
      prev.includes(tNo) ? prev.filter(t => t !== tNo) : [...prev, tNo]
    );
    setStagedTransfers(new Map());
    setSimulationResult(null);
  };

  // Transfer an entire group of nearby stops to target truck
  const handleStageNearbyGroup = (donorTruck: string, group: SpatialClusterCandidate) => {
    setStagedTransfers(prev => {
      const next = new Map(prev);
      if (next.has(group.clusterId)) {
        next.delete(group.clusterId);
      } else {
        next.set(group.clusterId, { donorTruck, cluster: group });
      }
      return next;
    });
  };

  // Toggle individual stop transfer directly
  const handleToggleIndividualStop = (member: Member) => {
    setSelectedIndividualMemberIds(prev => {
      const next = new Set(prev);
      if (next.has(member.id)) {
        next.delete(member.id);
      } else {
        next.add(member.id);
      }
      return next;
    });
  };

  // Quick auto-stage: pick best contiguous nearby stops from each donor truck
  const handleAutoStageAll = () => {
    const next = new Map<string, { donorTruck: string; cluster: SpatialClusterCandidate }>();
    donorClustersMap.forEach((clusters, tNo) => {
      if (clusters.length > 0) {
        next.set(clusters[0].clusterId, { donorTruck: tNo, cluster: clusters[0] });
      }
    });
    setStagedTransfers(next);
  };

  // Unstage all
  const handleUnstageAll = () => {
    setStagedTransfers(new Map());
    setSelectedIndividualMemberIds(new Set());
  };

  // Real-Time Staged Metrics Computation
  const liveStats = useMemo(() => {
    // Collect all moved member IDs
    const movedMemberMap = new Map<string, { member: Member; oldTruck: string; newTruck: string }>();

    // 1. From staged nearby groups
    stagedTransfers.forEach(({ donorTruck, cluster }) => {
      cluster.members.forEach(m => {
        movedMemberMap.set(m.id, {
          member: m,
          oldTruck: donorTruck,
          newTruck: targetRecipientTruck
        });
      });
    });

    // 2. From individual clicked stops
    selectedIndividualMemberIds.forEach(id => {
      const m = members.find(mem => mem.id === id);
      if (m) {
        movedMemberMap.set(m.id, {
          member: m,
          oldTruck: m.truckNo.trim(),
          newTruck: targetRecipientTruck
        });
      }
    });

    // Create modified members copy
    const modifiedMembers = members.map(m => {
      if (movedMemberMap.has(m.id)) {
        return { ...m, truckNo: movedMemberMap.get(m.id)!.newTruck };
      }
      return m;
    });

    const statsAfter = calculateTruckVolumeStats(
      modifiedMembers,
      workingDays,
      targetCapacityPerDay,
      targetPercentage,
      Array.from(new Set([...newTrucks, targetRecipientTruck]))
    );

    const totalTransferredBottles = Array.from(movedMemberMap.values()).reduce((sum, item) => sum + calculateMemberMonthlyBottles(item.member), 0);
    const totalTransferredMembers = movedMemberMap.size;
    const totalTransferredDaily = workingDays > 0 ? Math.round((totalTransferredBottles / workingDays) * 10) / 10 : 0;

    return {
      modifiedMembers,
      statsAfter,
      totalTransferredBottles,
      totalTransferredMembers,
      totalTransferredDaily,
      movedMemberMap
    };
  }, [members, stagedTransfers, selectedIndividualMemberIds, targetRecipientTruck, workingDays, targetCapacityPerDay, targetPercentage, newTrucks]);

  // Finalize Simulation & Advance to Step 3
  const handleProceedToReview = () => {
    if (stagedTransfers.size === 0 && !isDissolveTruck) {
      alert('กรุณาเลือกโอนย้ายกระจุกพื้นที่อย่างน้อย 1 กลุ่ม');
      return;
    }

    // Convert live staged data into RebalanceResult
    const reassignedMembers = Array.from(liveStats.movedMemberMap.values()).map(({ member, oldTruck, newTruck }) => ({
      memberId: member.id,
      memberName: member.name,
      oldTruck,
      newTruck,
      monthlyBottles: calculateMemberMonthlyBottles(member),
      deliveryDays: member.deliveryDays || [],
      address: member.address,
      lat: member.lat,
      lng: member.lng,
      hasGps: member.hasGps,
      distanceKm: 0
    }));

    const result: RebalanceResult = {
      statsBefore: baselineStats,
      statsAfter: liveStats.statsAfter,
      reassignedMembers,
      workingDays,
      targetDailyBottles: dailyTarget90,
      updatedMembers: liveStats.modifiedMembers
    };

    setSimulationResult(result);
    setWizardStep(3);
  };

  // Commit and Persist to Cloud & IndexedDB
  const handleApplyRebalance = async () => {
    if (!simulationResult) return;
    const reassignedCount = simulationResult.reassignedMembers.length;
    if (!window.confirm(`ยืนยันการนำสายส่งใหม่ไปใช้จริง? สมาชิกจำนวน ${reassignedCount.toLocaleString()} รายการจะถูกปรับสายรถ (โดยรอบวันส่งคงเดิม 100%)`)) {
      return;
    }

    setIsApplying(true);
    setApplyProgress('กำลังบันทึกข้อมูลลงเครื่อง...');

    try {
      const updated = simulationResult.updatedMembers;
      await saveMembers(updated);
      onMembersUpdated(updated);

      if (isFirebaseConfigured()) {
        setApplyProgress('กำลังซิงค์ขึ้น Cloud Firestore...');
        await saveMembersToCloud(updated, (done, total) => {
          setApplyProgress(`กำลังซิงค์ขึ้น Cloud: กลุ่มสายรถที่ ${done}/${total}...`);
        });
      }

      setApplySuccessMsg(`จัดสายใหม่สำเร็จเรียบร้อย! ปรับปรุงสายรถให้สมาชิก ${reassignedCount.toLocaleString()} จุดส่ง`);
      setWizardStep(1);
      setStagedTransfers(new Map());
      setSimulationResult(null);
    } catch (err) {
      console.error(err);
      alert('เกิดข้อผิดพลาดในการบันทึกข้อมูล');
    } finally {
      setIsApplying(false);
      setApplyProgress(null);
    }
  };

  // Leaflet Map Rendering for Step 2 and Step 3
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      if ((mapContainerRef.current as any)._leaflet_id) {
        (mapContainerRef.current as any)._leaflet_id = null;
      }

      const map = L.map(mapContainerRef.current, {
        center: [13.7563, 100.5018],
        zoom: 11
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap'
      }).addTo(map);

      markersLayerRef.current = L.layerGroup().addTo(map);
      clusterCircleLayerRef.current = L.layerGroup().addTo(map);
      mapInstanceRef.current = map;
    }

    const map = mapInstanceRef.current;
    const markersLayer = markersLayerRef.current;
    const circleLayer = clusterCircleLayerRef.current;
    if (!map || !markersLayer || !circleLayer) return;

    const timer = setTimeout(() => {
      try {
        map.invalidateSize();
      } catch (e) {}
    }, 150);

    markersLayer.clearLayers();
    circleLayer.clearLayers();

    const bounds = L.latLngBounds([]);
    let count = 0;

    // Filter relevant members to display
    const relevantTrucks = new Set([...selectedDonorTrucks, targetRecipientTruck]);
    const stagedClusterIds = new Set(Array.from(stagedTransfers.keys()));

    // Draw Cluster Circles
    donorClustersMap.forEach((clusters, tNo) => {
      clusters.forEach(c => {
        const isStaged = stagedClusterIds.has(c.clusterId);
        const isHovered = hoveredNearbyId === c.clusterId;

        if (c.radiusKm > 0) {
          const circle = L.circle([c.seedLat, c.seedLng], {
            radius: c.radiusKm * 1000,
            color: isStaged ? '#9333ea' : (isHovered ? '#f59e0b' : '#3b82f6'),
            weight: isStaged || isHovered ? 3 : 1.5,
            dashArray: isStaged ? undefined : '4, 4',
            fillColor: isStaged ? '#9333ea' : (isHovered ? '#f59e0b' : '#3b82f6'),
            fillOpacity: isStaged ? 0.2 : 0.08
          });
          circleLayer.addLayer(circle);
        }
      });
    });

    // Draw Member Markers
    members.forEach(m => {
      if (!relevantTrucks.has(m.truckNo.trim())) return;
      if (!m.hasGps || !m.lat || !m.lng) return;

      // Filter by active delivery days if set
      if (selectedDeliveryDays.length > 0 && !m.deliveryDays.some(d => selectedDeliveryDays.some(sd => d.includes(sd)))) {
        return;
      }

      const isMoved = liveStats.movedMemberMap.has(m.id);
      const isRecipient = m.truckNo.trim() === targetRecipientTruck;
      
      let fillColor = '#3b82f6'; // donor original
      if (isMoved || isRecipient) {
        fillColor = '#9333ea'; // purple for target recipient truck
      }

      const marker = L.circleMarker([m.lat, m.lng], {
        radius: isMoved ? 6.5 : 4,
        fillColor,
        color: '#ffffff',
        weight: isMoved ? 2 : 1,
        opacity: 1,
        fillOpacity: isMoved ? 0.95 : 0.65
      });

      marker.bindPopup(`
        <div style="font-family: sans-serif; font-size: 12px; line-height: 1.4; min-width: 180px;">
          <strong style="color: #0f172a;">${m.name}</strong> (${m.id})<br/>
          <span style="color: #64748b; font-size: 11px;">${m.address || '-'}</span><br/>
          <hr style="margin: 4px 0; border: none; border-top: 1px solid #e2e8f0;"/>
          <span>สายรถ: <strong>${isMoved ? `${m.truckNo} &rarr; ${targetRecipientTruck}` : m.truckNo}</strong></span><br/>
          <span>รอบส่ง (คงเดิม): <strong>${m.deliveryDays.join(', ')}</strong></span><br/>
          <span>ยอดส่ง: <strong>${calculateMemberMonthlyBottles(m)}</strong> ถัง/เดือน</span><br/>
          <div style="margin-top: 6px; text-align: center;">
            <span style="display: inline-block; padding: 3px 8px; border-radius: 6px; font-weight: bold; font-size: 11px; background: ${isMoved ? '#f3e8ff' : '#eff6ff'}; color: ${isMoved ? '#7e22ce' : '#1d4ed8'}; border: 1px solid ${isMoved ? '#d8b4fe' : '#bfdbfe'};">
              ${isMoved ? '✓ ย้ายเข้าสาย ' + targetRecipientTruck + ' แล้ว' : 'อยู่ในสายเดิม ' + m.truckNo}
            </span>
          </div>
        </div>
      `);

      // Clicking a marker directly toggles its transfer!
      marker.on('click', () => {
        handleToggleIndividualStop(m);
      });

      markersLayer.addLayer(marker);
      bounds.extend([m.lat, m.lng]);
      count++;
    });

    if (count > 0 && bounds.isValid()) {
      map.fitBounds(bounds, { padding: [30, 30] });
    }

    return () => clearTimeout(timer);
  }, [wizardStep, members, selectedDonorTrucks, targetRecipientTruck, selectedDeliveryDays, stagedTransfers, selectedIndividualMemberIds, hoveredNearbyId, liveStats, donorClustersMap]);

  return (
    <div className="space-y-4">
      
      {/* Top Banner with Formula & Step Progress Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold text-slate-900 tracking-tight">
              ระบบจัดตัดเกลี่ยสายส่งน้ำดื่ม (Interactive Route Studio)
            </h1>
            <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
              เกณฑ์ 90% ({dailyTarget90} ถัง/วัน)
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            เครื่องมือจัดเกลี่ยสายแบบกระจุกพื้นที่ GPS ใกล้เคียงกัน &bull; 
            <strong className="text-slate-700 ml-1">สมาชิกคงรอบวันเดิม 100%</strong>
          </p>
        </div>

        {/* 3-Step Wizard Navigation Indicator */}
        <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs">
          <button
            onClick={() => setWizardStep(1)}
            className={`px-3 py-1.5 rounded-lg font-bold transition flex items-center gap-1.5 ${
              wizardStep === 1
                ? 'bg-white text-blue-700 shadow-2xs border border-slate-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span className="w-4 h-4 rounded-full bg-blue-600 text-white text-[10px] flex items-center justify-center font-bold">1</span>
            <span>ตั้งโจทย์ & เลือกรถ</span>
          </button>

          <span className="text-slate-300">&rarr;</span>

          <button
            onClick={() => setWizardStep(2)}
            className={`px-3 py-1.5 rounded-lg font-bold transition flex items-center gap-1.5 ${
              wizardStep === 2
                ? 'bg-white text-blue-700 shadow-2xs border border-slate-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span className="w-4 h-4 rounded-full bg-blue-600 text-white text-[10px] flex items-center justify-center font-bold">2</span>
            <span>เวิร์กสเปซจัดสาย (Board + Map)</span>
          </button>

          <span className="text-slate-300">&rarr;</span>

          <button
            onClick={() => setWizardStep(3)}
            disabled={!simulationResult && stagedTransfers.size === 0}
            className={`px-3 py-1.5 rounded-lg font-bold transition flex items-center gap-1.5 ${
              wizardStep === 3
                ? 'bg-white text-blue-700 shadow-2xs border border-slate-200'
                : 'text-slate-400 disabled:opacity-50'
            }`}
          >
            <span className="w-4 h-4 rounded-full bg-blue-600 text-white text-[10px] flex items-center justify-center font-bold">3</span>
            <span>สรุป & นำไปใช้</span>
          </button>
        </div>
      </div>

      {/* Progress / Success Notifications */}
      {applyProgress && (
        <div className="p-3 bg-blue-50 border border-blue-200 text-blue-800 rounded-lg text-xs flex items-center gap-2">
          <span className="w-3.5 h-3.5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          <span>{applyProgress}</span>
        </div>
      )}

      {applySuccessMsg && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-bold text-emerald-700">✓ สำเร็จ!</span>
            <span>{applySuccessMsg}</span>
          </div>
          <button onClick={() => setApplySuccessMsg(null)} className="text-emerald-700 font-bold px-1">✕</button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* STEP 1: SETUP SCOPE & GOALS                                               */}
      {/* ========================================================================= */}
      {wizardStep === 1 && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          
          {/* Card 1: Destination Truck (สายปลายทาง / สายใหม่) */}
          <div className="lg:col-span-5 bg-white p-5 rounded-xl border border-slate-200 shadow-xs space-y-4">
            <div className="border-b border-slate-100 pb-2.5">
              <span className="text-[11px] font-bold text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full uppercase tracking-wider">
                Step 1.1: สายปลายทาง
              </span>
              <h2 className="text-sm font-bold text-slate-900 mt-1">
                กำหนดสายรถที่จะรับโอน (เช่น สายใหม่ 13S01)
              </h2>
              <p className="text-xs text-slate-500">
                เลือกสายเดิมที่มีอยู่ หรือสร้างเบอร์สายใหม่เพื่อมารับยอดกระจุกที่ตัดออกมา
              </p>
            </div>

            {/* Current Selected Recipient Showcase */}
            <div className="p-3.5 bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-200 rounded-xl">
              <div className="text-xs text-purple-900 font-bold mb-1">สายปลายทางที่เลือกปัจจุบัน:</div>
              <div className="flex items-center justify-between">
                <div className="text-lg font-black text-purple-800">
                  สาย {targetRecipientTruck}
                </div>
                {(() => {
                  const stat = baselineStats.find(t => t.truckNo === targetRecipientTruck);
                  if (!stat) {
                    return <span className="px-2 py-0.5 bg-purple-200 text-purple-900 rounded text-xs font-bold">สายใหม่ (ยังไม่มียอด)</span>;
                  }
                  return (
                    <span className="text-xs font-semibold text-purple-800">
                      ปัจจุบัน: {stat.dailyAvgBottles} ถัง/วัน ({stat.memberCount} จุด)
                    </span>
                  );
                })()}
              </div>
            </div>

            {/* Quick Pick or Search Existing Trucks */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700">พิมพ์ค้นหาหรือเลือกสายปลายทาง:</label>
              <input
                type="text"
                placeholder="🔍 พิมพ์เบอร์สายปลายทาง เช่น 13S01, 13199..."
                value={recipientSearchQuery}
                onChange={e => setRecipientSearchQuery(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-medium focus:ring-2 focus:ring-purple-500 focus:outline-none"
              />

              <div className="max-h-40 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-lg p-1 bg-slate-50/50">
                {/* New Trucks Options */}
                {newTrucks.map(nt => (
                  <div
                    key={nt}
                    onClick={() => setTargetRecipientTruck(nt)}
                    className={`p-2 rounded-md cursor-pointer text-xs flex justify-between items-center transition ${
                      targetRecipientTruck === nt ? 'bg-purple-600 text-white font-bold' : 'hover:bg-slate-100 text-slate-800'
                    }`}
                  >
                    <span>สายใหม่: <strong>{nt}</strong></span>
                    <span className="text-[10px] opacity-80">พร้อมรับยอด</span>
                  </div>
                ))}

                {/* Filtered Existing Trucks */}
                {baselineStats
                  .filter(t => !selectedDonorTrucks.includes(t.truckNo))
                  .filter(t => !recipientSearchQuery || t.truckNo.toLowerCase().includes(recipientSearchQuery.toLowerCase()))
                  .slice(0, 15)
                  .map(t => (
                    <div
                      key={t.truckNo}
                      onClick={() => setTargetRecipientTruck(t.truckNo)}
                      className={`p-2 rounded-md cursor-pointer text-xs flex justify-between items-center transition ${
                        targetRecipientTruck === t.truckNo ? 'bg-purple-600 text-white font-bold' : 'hover:bg-slate-100 text-slate-800'
                      }`}
                    >
                      <span>สายเดิม: <strong>{t.truckNo}</strong></span>
                      <span className="text-[11px] opacity-80">{t.dailyAvgBottles} ถัง/วัน</span>
                    </div>
                  ))}
              </div>
            </div>

            {/* Form Add New Truck */}
            <form onSubmit={handleAddNewTruck} className="flex gap-2 pt-1 border-t border-slate-100">
              <input
                type="text"
                placeholder="เพิ่มเบอร์สายใหม่ เช่น 13S01"
                value={newTruckInput}
                onChange={e => setNewTruckInput(e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-bold text-slate-800 focus:ring-2 focus:ring-purple-500 focus:outline-none"
              />
              <button
                type="submit"
                className="px-4 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-bold whitespace-nowrap transition"
              >
                + เพิ่มสาย
              </button>
            </form>

            {/* Delivery Day Multi-Selector */}
            <div className="pt-2 border-t border-slate-100 space-y-2">
              <div className="flex justify-between items-center">
                <label className="text-xs font-bold text-slate-800">
                  Step 1.2: เลือกรอบวันที่จะตัด (เลือกได้มากกว่า 1 วัน)
                </label>
                <span className="text-[11px] font-bold text-purple-700">
                  {selectedDeliveryDays.length === 0 ? 'ตัดทุกวัน' : selectedDeliveryDays.join(', ')}
                </span>
              </div>
              <div className="grid grid-cols-4 sm:grid-cols-7 gap-1">
                <button
                  type="button"
                  onClick={() => handleToggleDay('ALL')}
                  className={`py-1.5 text-xs font-bold rounded-lg transition ${
                    selectedDeliveryDays.length === 0 ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  ทุกวัน
                </button>
                {['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'].map(d => {
                  const active = selectedDeliveryDays.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => handleToggleDay(d)}
                      className={`py-1.5 text-xs font-bold rounded-lg transition ${
                        active ? 'bg-purple-600 text-white shadow-2xs' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {active ? '✓ ' : ''}{d.replace('พฤหัสบดี', 'พฤหัส')}
                    </button>
                  );
                })}
              </div>
            </div>

          </div>

          {/* Card 2: Source Donor Trucks (สายต้นทางที่จะตัดยอด) */}
          <div className="lg:col-span-7 bg-white p-5 rounded-xl border border-slate-200 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
              <div>
                <span className="text-[11px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full uppercase tracking-wider">
                  Step 1.3: สายต้นทาง
                </span>
                <h2 className="text-sm font-bold text-slate-900 mt-1">
                  เลือกสายรถต้นทางที่จะตัดยอด (เช่น 13205, 13206, 13202)
                </h2>
                <p className="text-xs text-slate-500">
                  เลือกรถที่ยอดล้นเกิน 90% เพื่อนำกระจุกพื้นที่ GPS ใกล้เคียงกันไปเติมให้สาย {targetRecipientTruck}
                </p>
              </div>

              {/* Selected Donors Badges */}
              <div className="text-right">
                <span className="text-xs text-slate-400">เลือกแล้ว: </span>
                <strong className="text-xs text-blue-700">{selectedDonorTrucks.length} คัน</strong>
              </div>
            </div>

            {/* Quick Filter Search & Chips */}
            <div className="space-y-2">
              <input
                type="text"
                placeholder="🔍 พิมพ์ค้นหาเบอร์รถต้นทาง เช่น 13205, 13206..."
                value={donorSearchQuery}
                onChange={e => setDonorSearchQuery(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />

              {/* Selected Donor Badges Chips */}
              {selectedDonorTrucks.length > 0 && (
                <div className="flex flex-wrap gap-1.5 p-2 bg-blue-50/70 border border-blue-200 rounded-lg items-center">
                  <span className="text-xs font-bold text-blue-900 mr-1">สายที่เลือกตัด:</span>
                  {selectedDonorTrucks.map(tNo => {
                    const stat = baselineStats.find(t => t.truckNo === tNo);
                    return (
                      <span key={tNo} className="px-2.5 py-1 bg-blue-600 text-white rounded-md text-xs font-bold flex items-center gap-1.5 shadow-2xs">
                        <span>สาย {tNo} ({stat ? stat.dailyAvgBottles : 0} ถัง)</span>
                        <button onClick={() => handleToggleDonor(tNo)} className="hover:text-rose-200 text-white">✕</button>
                      </span>
                    );
                  })}
                </div>
              )}

              {/* Scrollable Checkbox List of Overloaded/All Trucks */}
              <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-lg p-1 bg-white">
                {baselineStats
                  .filter(t => t.truckNo !== targetRecipientTruck)
                  .filter(t => !donorSearchQuery || t.truckNo.toLowerCase().includes(donorSearchQuery.toLowerCase()))
                  .map(t => {
                    const isSelected = selectedDonorTrucks.includes(t.truckNo);
                    const isOver = t.status === 'overload';
                    const excess = Math.max(0, Math.round((t.dailyAvgBottles - dailyTarget90) * 10) / 10);

                    return (
                      <label
                        key={t.truckNo}
                        className={`flex items-center justify-between p-2.5 rounded-lg cursor-pointer transition text-xs ${
                          isSelected ? 'bg-blue-50/80 border border-blue-300 font-semibold' : 'hover:bg-slate-50 border border-transparent'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleDonor(t.truckNo)}
                            className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
                          />
                          <div>
                            <span className="font-bold text-slate-800 text-sm">สาย {t.truckNo}</span>
                            <span className="text-[11px] text-slate-500 ml-2">({t.memberCount} จุด &bull; {t.monthlyBottles.toLocaleString()} ถัง/ด.)</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2.5">
                          <div className="text-right">
                            <span className="font-bold text-slate-900">{t.dailyAvgBottles}</span>
                            <span className="text-[10px] text-slate-400 ml-0.5">ถัง/วัน</span>
                          </div>
                          {isOver ? (
                            <span className="px-2 py-0.5 bg-rose-100 text-rose-700 font-bold rounded text-[10px]">
                              เกิน +{excess} ถัง
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 font-medium rounded text-[10px]">
                              ปกติ
                            </span>
                          )}
                        </div>
                      </label>
                    );
                  })}
              </div>
            </div>

            {/* Bottom Next Step Button */}
            <div className="pt-3 border-t border-slate-100 flex justify-between items-center">
              <div className="text-xs text-slate-500">
                🔒 ล็อกยอดสายต้นทางไม่ให้ตกต่ำกว่า 90% ({dailyTarget90} ถัง/วัน) อัตโนมัติ
              </div>
              <button
                type="button"
                onClick={() => setWizardStep(2)}
                disabled={selectedDonorTrucks.length === 0}
                className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold shadow-xs transition flex items-center gap-2 disabled:opacity-50"
              >
                <span>เข้าสู่เวิร์กสเปซจัดสาย (Step 2)</span>
                <span>&rarr;</span>
              </button>
            </div>

          </div>

        </div>
      )}

      {/* ========================================================================= */}
      {/* STEP 2: INTERACTIVE ROUTE STUDIO (BOARD + LIVE MAP)                       */}
      {/* ========================================================================= */}
      {wizardStep === 2 && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          
          {/* LEFT PANEL: Interactive Board (45% Width) */}
          <div className="lg:col-span-5 space-y-4">
            
            {/* Action Bar Header */}
            <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  กระดานจัดย้ายกระจุกพื้นที่ (Live Staging)
                </h3>
                <span className="text-[11px] text-slate-500">
                  โอนย้ายไปยังสาย: <strong className="text-purple-700">{targetRecipientTruck}</strong>
                </span>
              </div>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={handleAutoStageAll}
                  className="px-2.5 py-1 bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 rounded-lg text-xs font-semibold transition"
                >
                  ⚡ เลือกกระจุกอัตโนมัติ
                </button>
                <button
                  type="button"
                  onClick={handleUnstageAll}
                  className="px-2 py-1 text-slate-500 hover:text-slate-800 rounded-lg text-xs transition"
                >
                  ล้าง
                </button>
              </div>
            </div>

            {/* Target Truck Volume Meter Card (สายปลายทาง เช่น 13S01) */}
            <div className="bg-gradient-to-br from-purple-900 to-indigo-900 text-white p-4 rounded-xl shadow-xs space-y-2.5">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-purple-400 animate-pulse" />
                  <span className="font-bold text-sm">สายปลายทาง: {targetRecipientTruck}</span>
                </div>
                <span className="text-xs font-bold text-purple-200 bg-purple-800/80 px-2 py-0.5 rounded-full">
                  เป้าหมาย 90% = {dailyTarget90} ถัง/วัน
                </span>
              </div>

              {/* Volume Progress Bar */}
              {(() => {
                const targetStat = liveStats.statsAfter.find(t => t.truckNo === targetRecipientTruck);
                const currentDaily = targetStat ? targetStat.dailyAvgBottles : 0;
                const percent = Math.min(100, Math.round((currentDaily / dailyTarget90) * 100));

                return (
                  <div>
                    <div className="flex justify-between text-xs mb-1 font-bold">
                      <span className="text-purple-200">
                        ยอดสะสมปัจจุบัน: <strong>{currentDaily}</strong> ถัง/วัน
                      </span>
                      <span className="text-emerald-300">
                        {percent}% ของเป้าหมาย 90%
                      </span>
                    </div>
                    <div className="w-full bg-purple-950/80 rounded-full h-3 p-0.5 border border-purple-700/60 overflow-hidden">
                      <div 
                        className="bg-gradient-to-r from-purple-400 to-emerald-400 h-full rounded-full transition-all duration-300"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] text-purple-300 mt-1">
                      <span>โอนย้ายแล้ว: <strong>{liveStats.totalTransferredMembers}</strong> จุดส่ง</span>
                      <span>รวม <strong>{liveStats.totalTransferredBottles.toLocaleString()}</strong> ถัง/เดือน</span>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* List of Source Donor Trucks & Nearby Stops Groups Cards */}
            <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
              {selectedDonorTrucks.map(tNo => {
                const beforeStat = baselineStats.find(t => t.truckNo === tNo);
                const afterStat = liveStats.statsAfter.find(t => t.truckNo === tNo);
                const clusters = donorClustersMap.get(tNo) || [];

                const beforeDaily = beforeStat ? beforeStat.dailyAvgBottles : 0;
                const afterDaily = afterStat ? afterStat.dailyAvgBottles : beforeDaily;
                const isOver90 = afterDaily >= dailyTarget90;

                return (
                  <div key={tNo} className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs space-y-2.5">
                    {/* Truck Header & Gauge */}
                    <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                      <div>
                        <span className="font-bold text-sm text-slate-900">สาย {tNo}</span>
                        <div className="text-[11px] text-slate-500">
                          เดิม {beforeDaily} &rarr; <strong className={isOver90 ? 'text-emerald-600' : 'text-amber-600'}>{afterDaily}</strong> ถัง/วัน
                        </div>
                      </div>
                      <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                        afterDaily >= dailyTarget90 
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                          : 'bg-amber-50 text-amber-700 border border-amber-200'
                      }`}>
                        {afterDaily >= dailyTarget90 ? '✓ ไม่ต่ำกว่า 90%' : '⚠️ ใกล้เคียงเป้าหมาย'}
                      </span>
                    </div>

                    {/* Nearby Stops Groups within this truck */}
                    {clusters.length === 0 ? (
                      <div className="text-xs text-slate-400 py-2 text-center bg-slate-50 rounded-lg">
                        ไม่พบจุดส่งในรอบวันที่เลือก
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {clusters.map((c, idx) => {
                          const isStaged = stagedTransfers.has(c.clusterId);
                          return (
                            <div
                              key={c.clusterId}
                              onMouseEnter={() => setHoveredNearbyId(c.clusterId)}
                              onMouseLeave={() => setHoveredNearbyId(null)}
                              className={`p-2.5 rounded-lg border text-xs transition flex items-center justify-between ${
                                isStaged 
                                  ? 'bg-purple-50 border-purple-300 ring-1 ring-purple-400' 
                                  : 'bg-slate-50 hover:bg-slate-100 border-slate-200'
                              }`}
                            >
                              <div className="space-y-0.5">
                                <div className="font-bold text-slate-800 flex items-center gap-1.5">
                                  <span>กลุ่มจุดใกล้เคียง ชุดที่ {idx + 1}</span>
                                  <span className="text-[10px] text-purple-700 bg-purple-100/70 px-1.5 py-0.2 rounded font-semibold">
                                    ระยะ ~{c.radiusKm} กม.
                                  </span>
                                </div>
                                <div className="text-[11px] text-slate-500">
                                  {c.memberCount} จุดส่ง &bull; <strong>{c.dailyAvgBottles}</strong> ถัง/วัน ({c.monthlyBottles.toLocaleString()} ถัง/ด.)
                                </div>
                              </div>

                              <button
                                type="button"
                                onClick={() => handleStageNearbyGroup(tNo, c)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1 shadow-2xs ${
                                  isStaged
                                    ? 'bg-rose-600 hover:bg-rose-700 text-white'
                                    : 'bg-purple-600 hover:bg-purple-700 text-white'
                                }`}
                              >
                                {isStaged ? '↩ ยกเลิก' : 'โอนเข้า ➔'}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Proceed to Step 3 Button */}
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setWizardStep(1)}
                className="w-1/3 py-2.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-bold transition"
              >
                &larr; ย้อนกลับ
              </button>
              <button
                type="button"
                onClick={handleProceedToReview}
                className="w-2/3 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold shadow-xs transition flex items-center justify-center gap-2"
              >
                <span>ตรวจสอบและสรุปผล (Step 3) &rarr;</span>
              </button>
            </div>

          </div>

          {/* RIGHT PANEL: Live Interactive Map (55% Width) */}
          <div className="lg:col-span-7 bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-2">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs text-slate-600 gap-2 border-b border-slate-100 pb-2">
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-blue-500" />
                  <span className="font-semibold">สายต้นทาง ({selectedDonorTrucks.join(', ')})</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-purple-600 ring-2 ring-purple-200" />
                  <span className="font-bold text-purple-800">โอนย้ายเข้าสาย {targetRecipientTruck}</span>
                </span>
              </div>
              <span className="text-[11px] text-slate-500 font-medium bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
                💡 คลิกที่หมุดบนแผนที่เพื่อเลือก/ยกเลิกจุดส่งใกล้เคียงรายจุดได้ทันที
              </span>
            </div>

            <div 
              ref={mapContainerRef}
              className="h-[620px] w-full rounded-xl border border-slate-200 overflow-hidden relative z-0"
            />
          </div>

        </div>
      )}

      {/* ========================================================================= */}
      {/* STEP 3: REVIEW & FINALIZE (BEFORE VS AFTER TABLE & SAVE)                  */}
      {/* ========================================================================= */}
      {wizardStep === 3 && simulationResult && (
        <div className="space-y-4">
          
          {/* Header Summary */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full uppercase tracking-wider">
                Step 3: ตรวจสอบผลลัพธ์
              </span>
              <h2 className="text-base font-bold text-slate-900 mt-1">
                สรุปผลการจัดเกลี่ยสายใหม่ (ก่อน vs หลัง)
              </h2>
              <p className="text-xs text-slate-500">
                โอนย้ายสมาชิกทั้งหมด <strong>{simulationResult.reassignedMembers.length}</strong> จุดส่ง 
                เข้าสาย <strong>{targetRecipientTruck}</strong> โดยคงรอบวันส่งเดิม 100%
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setWizardStep(2)}
                className="px-3.5 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-bold transition"
              >
                &larr; ปรับแต่งต่อ
              </button>

              <button
                type="button"
                onClick={() => exportRebalanceToExcel(simulationResult)}
                className="px-3.5 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-bold transition flex items-center gap-1.5"
              >
                <span>📥 ดาวน์โหลด Excel สรุปสาย</span>
              </button>

              <button
                type="button"
                onClick={handleApplyRebalance}
                disabled={isApplying}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-xs transition flex items-center gap-1.5 disabled:opacity-50"
              >
                <span>{isApplying ? 'กำลังบันทึก...' : '💾 ยืนยันและนำไปใช้จริง'}</span>
              </button>
            </div>
          </div>

          {/* Before vs After Comparison Table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-3 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-700">
              ตารางเปรียบเทียบกำลังส่งของสายรถที่เกี่ยวข้อง
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-bold">
                    <th className="py-2.5 px-3">เบอร์สายรถ</th>
                    <th className="py-2.5 px-3">บทบาท</th>
                    <th className="py-2.5 px-3 text-right">จุดส่งเดิม</th>
                    <th className="py-2.5 px-3 text-right">จุดส่งใหม่</th>
                    <th className="py-2.5 px-3 text-right">เปลี่ยนแปลง</th>
                    <th className="py-2.5 px-3 text-right">ยอดเดิม (ถัง/วัน)</th>
                    <th className="py-2.5 px-3 text-right">ยอดใหม่ (ถัง/วัน)</th>
                    <th className="py-2.5 px-3 text-center">สัดส่วนต่อเกณฑ์ 90% ({dailyTarget90} ถัง)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {simulationResult.statsAfter
                    .filter(t => selectedDonorTrucks.includes(t.truckNo) || t.truckNo === targetRecipientTruck)
                    .map(after => {
                      const before = simulationResult.statsBefore.find(s => s.truckNo === after.truckNo) || {
                        memberCount: 0,
                        monthlyBottles: 0,
                        dailyAvgBottles: 0
                      };
                      const isRecipient = after.truckNo === targetRecipientTruck;
                      const diffMembers = after.memberCount - before.memberCount;

                      return (
                        <tr key={after.truckNo} className={isRecipient ? 'bg-purple-50/60 font-semibold' : 'hover:bg-slate-50'}>
                          <td className="py-2.5 px-3 font-bold text-slate-900">
                            สาย {after.truckNo}
                          </td>
                          <td className="py-2.5 px-3">
                            {isRecipient ? (
                              <span className="px-2 py-0.5 bg-purple-200 text-purple-900 rounded text-[10px] font-bold">สายรับโอน</span>
                            ) : (
                              <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded text-[10px] font-bold">สายต้นทาง</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-500">{before.memberCount} จุด</td>
                          <td className="py-2.5 px-3 text-right font-bold text-slate-900">{after.memberCount} จุด</td>
                          <td className="py-2.5 px-3 text-right">
                            <span className={diffMembers > 0 ? 'text-purple-700 font-bold' : (diffMembers < 0 ? 'text-blue-700 font-bold' : 'text-slate-400')}>
                              {diffMembers > 0 ? `+${diffMembers}` : diffMembers}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-500">{before.dailyAvgBottles}</td>
                          <td className="py-2.5 px-3 text-right font-black text-slate-900">{after.dailyAvgBottles}</td>
                          <td className="py-2.5 px-3 text-center">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              after.dailyAvgBottles >= dailyTarget90 
                                ? 'bg-emerald-100 text-emerald-800' 
                                : 'bg-amber-100 text-amber-800'
                            }`}>
                              {after.dailyAvgBottles >= dailyTarget90 ? '✓ ผ่านเกณฑ์ 90%' : 'ต่ำกว่าเป้าหมาย'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Reassigned Members Details Table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-3 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-700 flex justify-between items-center">
              <span>รายชื่อจุดส่งที่ย้ายสาย ({simulationResult.reassignedMembers.length} รายการ)</span>
              <span className="text-[11px] text-slate-400 font-normal">รอบส่งคงเดิม 100%</span>
            </div>
            <div className="max-h-80 overflow-y-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="sticky top-0 bg-slate-100 border-b border-slate-200 font-semibold text-slate-600">
                  <tr>
                    <th className="py-2 px-3">รหัส</th>
                    <th className="py-2 px-3">ชื่อสมาชิก</th>
                    <th className="py-2 px-3">ที่อยู่</th>
                    <th className="py-2 px-3">รอบส่ง</th>
                    <th className="py-2 px-3 text-right">ยอด (ถัง/ด.)</th>
                    <th className="py-2 px-3 text-center">การย้ายสาย</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {simulationResult.reassignedMembers.map(m => (
                    <tr key={m.memberId} className="hover:bg-slate-50">
                      <td className="py-1.5 px-3 font-mono font-bold text-slate-700">{m.memberId}</td>
                      <td className="py-1.5 px-3 font-semibold text-slate-800">{m.memberName}</td>
                      <td className="py-1.5 px-3 text-slate-500 truncate max-w-xs">{m.address || '-'}</td>
                      <td className="py-1.5 px-3 font-bold text-purple-700">{m.deliveryDays.join(', ')}</td>
                      <td className="py-1.5 px-3 text-right font-bold text-slate-900">{m.monthlyBottles}</td>
                      <td className="py-1.5 px-3 text-center">
                        <span className="text-blue-600 font-bold">{m.oldTruck}</span> &rarr; <span className="text-purple-700 font-bold">{m.newTruck}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      )}

    </div>
  );
};
