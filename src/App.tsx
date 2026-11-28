import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Member, DeliveryStop, DayOfWeek, DaySchedule, UserRole } from './types/delivery';
import { AuthUser } from './types/auth';
import { Mdfssv3StopInput } from './services/excelParser';
import { Navbar } from './components/Navbar';
import { OfficeView } from './components/OfficeView';
import { DriverView } from './components/DriverView';
import { LoginView } from './components/LoginView';
import { FirebaseConfigModal } from './components/FirebaseConfigModal';
import { 
  getMembers, saveMembers, getRoute, saveRoute, 
  markStopCompleted, getLastTruck, saveLastTruck,
  getLocalMembers, saveLocalMembers, getLocalCloudMeta, saveLocalCloudMeta,
  getCloudMeta, getTruckMembersFromCloud, CloudMeta
} from './services/db';
import { subscribeToRouteCloud, isFirebaseConfigured } from './services/firebase';
import { getCurrentUser, clearSession } from './services/auth';
import { 
  DeliveryConditionFilter, shouldIncludeMemberByCondition,
  getTodayDateKey, getDayOfWeekFromDate, formatDateThai 
} from './services/weekHelper';
import initialMembersData from './data/initialData.json';

export const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [currentRole, setCurrentRole] = useState<UserRole>('office');
  const [members, setMembers] = useState<Member[]>([]);
  
  // Advance Planning Date state (Default: Today's date YYYY-MM-DD)
  const [selectedDate, setSelectedDate] = useState<string>(getTodayDateKey());
  const [selectedDay, setSelectedDay] = useState<DayOfWeek>(getDayOfWeekFromDate(getTodayDateKey()));
  const [selectedTruck, setSelectedTruck] = useState<string>('13106');
  const [stops, setStops] = useState<DeliveryStop[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isFirebaseModalOpen, setIsFirebaseModalOpen] = useState<boolean>(false);
  const [isCloudConnected, setIsCloudConnected] = useState<boolean>(isFirebaseConfigured());
  const [cloudMeta, setCloudMeta] = useState<CloudMeta | null>(null);
  const [loadedTrucksSet, setLoadedTrucksSet] = useState<Set<string>>(new Set());

  // Delivery condition filter (Default: only รอบปกติ!)
  const [conditionFilter, setConditionFilter] = useState<DeliveryConditionFilter>({
    includeRegular: true,
    includeBiWeekly: false,
    includeOnDemand: false,
    selectedMonthlyWeek: null
  });

  // Date Change Handler (Syncs day of week automatically)
  const handleDateChange = (dateKey: string) => {
    setSelectedDate(dateKey);
    const newDay = getDayOfWeekFromDate(dateKey);
    setSelectedDay(newDay);
  };

  // 1. Initial Load: Fast Metadata + Active Truck On-Demand (scales smoothly to 100k+ records)
  useEffect(() => {
    async function initData() {
      setIsLoading(true);
      try {
        const session = getCurrentUser();
        if (session) {
          setCurrentUser(session);
          setCurrentRole(session.role);
        }

        const [lastTruck, cachedMeta, cachedMembers, latestMeta] = await Promise.all([
          getLastTruck(),
          getLocalCloudMeta(),
          getLocalMembers(),
          isFirebaseConfigured() ? getCloudMeta() : Promise.resolve(null)
        ]);

        const activeMeta = latestMeta || cachedMeta;
        if (activeMeta) setCloudMeta(activeMeta);

        let initialTruck = '13106';
        if (session?.role === 'driver' && session.assignedTruck) {
          initialTruck = session.assignedTruck;
        } else if (lastTruck) {
          initialTruck = lastTruck;
        } else if (activeMeta?.trucks && activeMeta.trucks.length > 0) {
          initialTruck = activeMeta.trucks[0].truckNo;
        }
        setSelectedTruck(initialTruck);

        // If Cloud has a newer dataset (or local cache is empty), load active truck fast without downloading 60MB+
        const cacheIsStale = Boolean(latestMeta && cachedMeta?.updatedAt !== latestMeta.updatedAt);

        if (latestMeta && (cacheIsStale || cachedMembers.length === 0)) {
          const truckMembers = await getTruckMembersFromCloud(initialTruck);
          await saveLocalMembers(truckMembers);
          await saveLocalCloudMeta(latestMeta);
          setMembers(truckMembers);
          setLoadedTrucksSet(new Set([initialTruck]));
        } else if (cachedMembers.length > 0) {
          const loadedSet = new Set(cachedMembers.map(m => m.truckNo?.trim()).filter(Boolean) as string[]);
          if (!loadedSet.has(initialTruck) && isFirebaseConfigured()) {
            const truckMembers = await getTruckMembersFromCloud(initialTruck);
            const merged = [...cachedMembers, ...truckMembers];
            loadedSet.add(initialTruck);
            await saveLocalMembers(merged);
            setMembers(merged);
          } else {
            setMembers(cachedMembers);
          }
          setLoadedTrucksSet(loadedSet);
        } else {
          // Offline / unconfigured fallback
          let localOrSeed = await getMembers();
          if ((!localOrSeed || localOrSeed.length === 0) && (initialMembersData as Member[]).length > 0) {
            localOrSeed = initialMembersData as Member[];
            await saveMembers(localOrSeed);
          }
          setMembers(localOrSeed);
          setLoadedTrucksSet(new Set(localOrSeed.map(m => m.truckNo?.trim()).filter(Boolean) as string[]));
        }
      } catch (err) {
        console.error('Failed to init data:', err);
      } finally {
        setIsLoading(false);
      }
    }
    initData();
  }, []);

  // Ensure a specific truck's members are loaded into memory + IndexedDB (for cross-truck AddStopModal)
  const ensureTruckLoaded = useCallback(async (truckNo: string): Promise<Member[]> => {
    const cleanTruck = truckNo.trim();
    if (!cleanTruck) return [];
    if (loadedTrucksSet.has(cleanTruck) || !isCloudConnected) {
      return members.filter(m => m.truckNo?.trim() === cleanTruck);
    }

    const truckMembers = await getTruckMembersFromCloud(cleanTruck);
    setLoadedTrucksSet(prev => new Set(prev).add(cleanTruck));
    if (truckMembers.length > 0) {
      setMembers(prev => {
        const existingIds = new Set(truckMembers.map(m => m.id));
        const merged = [...prev.filter(m => m.truckNo?.trim() !== cleanTruck && !existingIds.has(m.id)), ...truckMembers];
        saveLocalMembers(merged).catch(() => {});
        return merged;
      });
    }
    return truckMembers;
  }, [loadedTrucksSet, isCloudConnected, members]);

  // On-demand fetch whenever user switches to a truck not yet cached locally
  useEffect(() => {
    if (isLoading || !selectedTruck || !isCloudConnected) return;
    const cleanTruck = selectedTruck.trim();
    if (!cleanTruck || loadedTrucksSet.has(cleanTruck)) return;
    ensureTruckLoaded(cleanTruck);
  }, [selectedTruck, isLoading, isCloudConnected, loadedTrucksSet, ensureTruckLoaded]);

  // 2. Compute Available Trucks (merges instant 266-truck cloud index + exact local counts for loaded trucks)
  const availableTrucks = useMemo(() => {
    const metaCountMap = new Map<string, number>();
    cloudMeta?.trucks?.forEach(t => {
      if (t.truckNo) metaCountMap.set(t.truckNo.trim(), t.count);
    });

    const allTrucksSet = new Set<string>(metaCountMap.keys());
    members.forEach(m => {
      if (m.truckNo && m.truckNo.trim()) allTrucksSet.add(m.truckNo.trim());
    });

    const truckCounts: Record<string, number> = {};
    members.forEach(m => {
      const deliversOnDay = m.deliveryDays.some(d => d.includes(selectedDay) || selectedDay.includes(d));
      const conditionMatches = shouldIncludeMemberByCondition(m.deliveryCondition, conditionFilter);
      if (deliversOnDay && conditionMatches && m.truckNo) {
        const t = m.truckNo.trim();
        truckCounts[t] = (truckCounts[t] || 0) + 1;
      }
    });

    const list = Array.from(allTrucksSet).map(truckNo => ({
      truckNo,
      count: loadedTrucksSet.has(truckNo) ? (truckCounts[truckNo] || 0) : (metaCountMap.get(truckNo) || 0)
    }));

    list.sort((a, b) =>
      a.truckNo.localeCompare(b.truckNo, undefined, { numeric: true, sensitivity: 'base' })
    );

    return list;
  }, [members, cloudMeta, loadedTrucksSet, selectedDay, conditionFilter]);

  useEffect(() => {
    if (currentUser?.role === 'driver' && currentUser.assignedTruck) {
      setSelectedTruck(currentUser.assignedTruck);
      return;
    }
    // Only pick a default truck if none is selected yet
    if (!selectedTruck && availableTrucks.length > 0) {
      setSelectedTruck(availableTrucks[0].truckNo);
    }
  }, [availableTrucks, selectedTruck, currentUser]);

  // 3. Load or Build Stops for [selectedTruck, selectedDay, selectedDate, conditionFilter]
  const loadStopsForRoute = useCallback(async (
    truck: string, 
    day: DayOfWeek, 
    currentMembers: Member[],
    filter: DeliveryConditionFilter,
    dateKey: string
  ) => {
    if (!truck) return;

    // Check if there is an existing saved route for this specific date
    const savedRoute = await getRoute(truck, day, dateKey);
    if (savedRoute && savedRoute.stops && savedRoute.stops.length > 0) {
      const memberMap = new Map(currentMembers.map(m => [m.id, m]));
      const refreshedStops = savedRoute.stops.map((stop, idx) => {
        const freshMember = memberMap.get(stop.member.id) || stop.member;
        const schedule = freshMember.schedules?.[day];
        return {
          ...stop,
          sequence: idx + 1,
          member: freshMember,
          daySchedule: stop.daySchedule || schedule
        };
      });
      setStops(refreshedStops);
      return;
    }

    // Default stops: Regular round + any matched condition
    const dayFilteredMembers = currentMembers.filter(m => {
      const matchTruck = m.truckNo === truck;
      const matchDay = m.deliveryDays.some(d => d.includes(day) || day.includes(d));
      const matchCondition = shouldIncludeMemberByCondition(m.deliveryCondition, filter);
      return matchTruck && matchDay && matchCondition;
    });

    const defaultStops: DeliveryStop[] = dayFilteredMembers.map((m, idx) => ({
      sequence: idx + 1,
      member: m,
      daySchedule: m.schedules?.[day],
      isCompleted: false
    }));

    setStops(defaultStops);
  }, []);

  const membersRef = useRef<Member[]>(members);
  membersRef.current = members;
  const activeTruckLoaded = loadedTrucksSet.has(selectedTruck.trim());

  useEffect(() => {
    if (!isLoading && selectedTruck) {
      loadStopsForRoute(selectedTruck, selectedDay, membersRef.current, conditionFilter, selectedDate);
      saveLastTruck(selectedTruck);
    }
  }, [selectedTruck, selectedDay, activeTruckLoaded, isLoading, conditionFilter, selectedDate, loadStopsForRoute]);

  // Real-time Cloud Route Listener (Syncs changes between Office & Driver immediately)
  useEffect(() => {
    if (!selectedTruck || !selectedDate || !isCloudConnected) return;

    const unsub = subscribeToRouteCloud(selectedTruck, selectedDate, (cloudRoute) => {
      if (cloudRoute && cloudRoute.stops) {
        setStops(cloudRoute.stops);
      }
    });

    return () => {
      if (unsub) unsub();
    };
  }, [selectedTruck, selectedDate, isCloudConnected]);

  // 4. Save Route to DB with Date Key
  const handleSaveRoute = async () => {
    if (!selectedTruck || stops.length === 0) return;
    setIsSaving(true);
    try {
      await saveRoute(selectedTruck, selectedDay, stops, selectedDate);
      alert(`บันทึกลำดับสายส่งวันที่ ${formatDateThai(selectedDate)} เรียบร้อยแล้ว!`);
    } catch (err) {
      console.error(err);
      alert('บันทึกไม่สำเร็จ');
    } finally {
      setIsSaving(false);
    }
  };

  // 5. Clone / Copy route from 7 days ago
  const handleCopyPreviousWeek = async () => {
    const [year, month, day] = selectedDate.split('-').map(Number);
    const d = new Date(year, month - 1, day);
    d.setDate(d.getDate() - 7);
    const prevDateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    
    const prevRoute = await getRoute(selectedTruck, selectedDay, prevDateKey);
    if (prevRoute && prevRoute.stops.length > 0) {
      const clonedStops = prevRoute.stops.map((s, idx) => ({
        ...s,
        sequence: idx + 1,
        isCompleted: false,
        completedAt: undefined
      }));
      setStops(clonedStops);
      alert(`คัดลอกลำดับสายส่งจากสัปดาห์ก่อนหน้า (${formatDateThai(prevDateKey)}) จำนวน ${clonedStops.length} จุด เรียบร้อยแล้ว`);
    } else {
      alert(`ไม่พบลำดับสายส่งที่บันทึกไว้ในสัปดาห์ก่อนหน้า (${formatDateThai(prevDateKey)})`);
    }
  };

  // 6. Driver Mark Complete
  const handleMarkComplete = async (memberId: string, isCompleted: boolean) => {
    const updated = stops.map(s => {
      if (s.member.id === memberId) {
        return {
          ...s,
          isCompleted,
          completedAt: isCompleted ? new Date().toISOString() : undefined
        };
      }
      return s;
    });
    setStops(updated);
    await markStopCompleted(selectedTruck, selectedDay, memberId, isCompleted, selectedDate);
  };

  const handleMembersUpdated = useCallback((updatedMembers: Member[]) => {
    setMembers(updatedMembers);
    const counts = new Map<string, number>();
    updatedMembers.forEach(m => {
      const t = m.truckNo?.trim() || 'UNASSIGNED';
      counts.set(t, (counts.get(t) || 0) + 1);
    });
    const loadedSet = new Set(counts.keys());
    setLoadedTrucksSet(loadedSet);
    const nextMeta: CloudMeta = {
      totalMembers: updatedMembers.length,
      trucksCount: counts.size,
      trucks: Array.from(counts.entries()).map(([truckNo, count]) => ({ truckNo, count })).sort((a, b) => b.count - a.count),
      updatedAt: new Date().toISOString()
    };
    setCloudMeta(nextMeta);
    saveLocalCloudMeta(nextMeta).catch(() => {});
  }, []);

  const handleLoadInitialData = async () => {
    const seed = initialMembersData as Member[];
    await saveMembers(seed);
    handleMembersUpdated(seed);
  };

  // Import daily dispatch jobs from mdfssv3 (.csv / .xlsx), enrich with Master GPS & Addresses
  const handleImportMdfssv3 = async (truckGroups: Map<string, Mdfssv3StopInput[]>) => {
    const targetTruckNos = Array.from(truckGroups.keys()).map(t =>
      t === 'UNASSIGNED' ? selectedTruck : t.trim()
    );

    // 1. Fetch any target trucks not yet cached locally from Cloud Firestore
    let workingMembers = [...members];
    const nextLoadedSet = new Set(loadedTrucksSet);
    let membersChanged = false;

    if (isCloudConnected) {
      const missingTrucks = Array.from(new Set(targetTruckNos)).filter(t => t && !nextLoadedSet.has(t));
      if (missingTrucks.length > 0) {
        const fetchedLists = await Promise.all(missingTrucks.map(t => getTruckMembersFromCloud(t)));
        fetchedLists.forEach((list, idx) => {
          const tNo = missingTrucks[idx];
          nextLoadedSet.add(tNo);
          if (list.length > 0) {
            const incomingIds = new Set(list.map(m => m.id));
            workingMembers = [
              ...workingMembers.filter(m => m.truckNo?.trim() !== tNo && !incomingIds.has(m.id)),
              ...list
            ];
            membersChanged = true;
          }
        });
      }
    }

    if (membersChanged) {
      setLoadedTrucksSet(nextLoadedSet);
      setMembers(workingMembers);
      await saveLocalMembers(workingMembers).catch(() => {});
    }

    const memberById = new Map<string, Member>(workingMembers.map(m => [m.id.trim(), m]));

    let totalStops = 0;
    let matchedGps = 0;
    let missingGps = 0;
    let primaryTruck = selectedTruck;
    let primaryStops: DeliveryStop[] = [];
    let isFirst = true;

    for (const [rawTruck, rows] of truckGroups.entries()) {
      const truckNo = rawTruck === 'UNASSIGNED' ? selectedTruck : rawTruck.trim();
      const builtStops: DeliveryStop[] = rows.map((row, idx) => {
        const master = memberById.get(row.memberId.trim());
        const memberObj: Member = master
          ? {
              ...master,
              customerGroup: row.customerGroup || master.customerGroup
            }
          : {
              id: row.memberId,
              name: row.memberName,
              deliveryDays: [selectedDay],
              truckNo,
              receiveType: 'งานประจำวัน (mdfssv3)',
              deliveryCondition: row.jobType || 'รอบปกติ',
              customerGroup: row.customerGroup || '',
              status: row.timeStatus || 'ปกติ',
              lat: 0,
              lng: 0,
              hasGps: false,
              schedules: {}
            };

        if (memberObj.hasGps && memberObj.lat && memberObj.lng) matchedGps++;
        else missingGps++;
        totalStops++;

        const baseSched = memberObj.schedules?.[selectedDay] || Object.values(memberObj.schedules || {})[0];
        const mergedSched: DaySchedule | undefined =
          baseSched || row.timeWindow || row.avgQuantity !== undefined
            ? {
                day: baseSched?.day || selectedDay,
                dayFull: selectedDay,
                avgQuantity: row.avgQuantity ?? baseSched?.avgQuantity ?? 0,
                timeWindow: row.timeWindow || baseSched?.timeWindow || '',
                minMaxTime: baseSched?.minMaxTime,
                historyTimes: baseSched?.historyTimes || [],
                avgActualTimeMinutes: baseSched?.avgActualTimeMinutes
              }
            : undefined;

        return {
          sequence: idx + 1,
          member: memberObj,
          daySchedule: mergedSched,
          isCompleted: false,
          jobType: row.jobType,
          urgentNote: row.urgentNote,
          timeStatus: row.timeStatus,
          sourceSeq: row.sourceSeq,
          distanceFromPrevKm: row.distanceFromPrevKm
        };
      });

      await saveRoute(truckNo, selectedDay, builtStops, selectedDate);
      if (isFirst) {
        primaryTruck = truckNo;
        primaryStops = builtStops;
        isFirst = false;
      }
    }

    if (primaryTruck) {
      setSelectedTruck(primaryTruck);
      setStops(primaryStops);
    }

    return {
      truckCount: truckGroups.size,
      totalStops,
      matchedGps,
      missingGps,
      primaryTruck
    };
  };

  const handleLoginSuccess = (user: AuthUser) => {
    setCurrentUser(user);
    setCurrentRole(user.role);
    if (user.role === 'driver' && user.assignedTruck) {
      setSelectedTruck(user.assignedTruck);
    }
  };

  const handleLogout = () => {
    clearSession();
    setCurrentUser(null);
  };

  const completedCount = stops.filter(s => s.isCompleted).length;

  if (!currentUser) {
    return (
      <LoginView
        onLoginSuccess={handleLoginSuccess}
        availableTrucks={availableTrucks}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col selection:bg-slate-900 selection:text-white">
      
      {/* Navigation Header */}
      <Navbar
        currentUser={currentUser}
        onLogout={handleLogout}
        currentRole={currentRole}
        onRoleChange={setCurrentRole}
        totalMembers={cloudMeta?.totalMembers && cloudMeta.totalMembers > members.length ? cloudMeta.totalMembers : members.length}
        activeTrucksCount={availableTrucks.length}
        completedStopsCount={completedCount}
        totalStopsCount={stops.length}
        isCloudConnected={isCloudConnected}
        onOpenFirebaseModal={() => setIsFirebaseModalOpen(true)}
      />

      {/* Main Body */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-5">
        {isLoading ? (
          <div className="h-80 flex flex-col items-center justify-center text-xs text-slate-500">
            กำลังโหลดข้อมูลระบบ...
          </div>
        ) : currentRole === 'office' ? (
          <OfficeView
            members={members}
            onMembersUpdated={handleMembersUpdated}
            stops={stops}
            onStopsChange={setStops}
            selectedTruck={selectedTruck}
            onTruckChange={setSelectedTruck}
            selectedDay={selectedDay}
            onDayChange={setSelectedDay}
            selectedDate={selectedDate}
            onDateChange={handleDateChange}
            onCopyPreviousWeek={handleCopyPreviousWeek}
            availableTrucks={availableTrucks}
            onSaveRoute={handleSaveRoute}
            isSaving={isSaving}
            onLoadInitialData={handleLoadInitialData}
            onImportMdfssv3={handleImportMdfssv3}
            cloudMeta={cloudMeta}
            onLoadTruckMembers={ensureTruckLoaded}
            conditionFilter={conditionFilter}
            onConditionFilterChange={setConditionFilter}
          />
        ) : (
          <DriverView
            stops={stops}
            onMarkComplete={handleMarkComplete}
            selectedTruck={selectedTruck}
            onTruckChange={setSelectedTruck}
            selectedDay={selectedDay}
            onDayChange={setSelectedDay}
            selectedDate={selectedDate}
            onDateChange={handleDateChange}
            availableTrucks={availableTrucks}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-3.5 px-4 text-center text-xs text-slate-500">
        <div className="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2">
          <span>AquaRoute • ระบบบริหารจัดการและติดตามสายส่งน้ำดื่ม</span>
          <span className="hidden sm:inline text-slate-300">•</span>
          <span>
            พัฒนาและออกแบบโดย{' '}
            <strong className="text-slate-800 font-semibold">Wuttichai</strong>{' '}
            (<a 
              href="mailto:wuttichai@sprinkle-th.com" 
              className="text-slate-700 hover:text-blue-600 underline transition"
            >
              wuttichai@sprinkle-th.com
            </a>)
          </span>
        </div>
      </footer>

      {/* Firebase Cloud Config Modal */}
      <FirebaseConfigModal
        isOpen={isFirebaseModalOpen}
        onClose={() => setIsFirebaseModalOpen(false)}
        members={members}
        onConfigUpdated={() => setIsCloudConnected(isFirebaseConfigured())}
      />

    </div>
  );
};
