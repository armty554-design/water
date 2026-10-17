import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Member, DeliveryStop, DayOfWeek, UserRole } from './types/delivery';
import { AuthUser } from './types/auth';
import { Navbar } from './components/Navbar';
import { OfficeView } from './components/OfficeView';
import { DriverView } from './components/DriverView';
import { LoginView } from './components/LoginView';
import { FirebaseConfigModal } from './components/FirebaseConfigModal';
import { 
  getMembers, saveMembers, getRoute, saveRoute, 
  markStopCompleted, getLastTruck, saveLastTruck 
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

  // 1. Initial Load: Auth Session & Data
  useEffect(() => {
    async function initData() {
      setIsLoading(true);
      try {
        const session = getCurrentUser();
        if (session) {
          setCurrentUser(session);
          setCurrentRole(session.role);
          if (session.role === 'driver' && session.assignedTruck) {
            setSelectedTruck(session.assignedTruck);
          }
        }

        let loadedMembers = await getMembers();
        if (!loadedMembers || loadedMembers.length === 0) {
          loadedMembers = initialMembersData as Member[];
          await saveMembers(loadedMembers);
        }
        setMembers(loadedMembers);

        if (!session || session.role !== 'driver') {
          const lastTruck = await getLastTruck();
          if (lastTruck) {
            setSelectedTruck(lastTruck);
          } else if (loadedMembers.length > 0) {
            const firstTruck = loadedMembers.find(m => m.deliveryDays.includes(selectedDay))?.truckNo || loadedMembers[0].truckNo;
            setSelectedTruck(firstTruck);
          }
        }
      } catch (err) {
        console.error('Failed to init data:', err);
      } finally {
        setIsLoading(false);
      }
    }
    initData();
  }, []);

  // 2. Compute Available Trucks for the Selected Day (includes all trucks, sorted by today's stops)
  const availableTrucks = useMemo(() => {
    const allTrucksSet = new Set<string>();
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
      count: truckCounts[truckNo] || 0
    }));

    list.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.truckNo.localeCompare(b.truckNo);
    });

    return list;
  }, [members, selectedDay, conditionFilter]);

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
          daySchedule: schedule
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

  useEffect(() => {
    if (!isLoading && selectedTruck) {
      loadStopsForRoute(selectedTruck, selectedDay, members, conditionFilter, selectedDate);
      saveLastTruck(selectedTruck);
    }
  }, [selectedTruck, selectedDay, members, isLoading, conditionFilter, selectedDate, loadStopsForRoute]);

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

  const handleLoadInitialData = async () => {
    const seed = initialMembersData as Member[];
    await saveMembers(seed);
    setMembers(seed);
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
        totalMembers={members.length}
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
            onMembersUpdated={setMembers}
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
