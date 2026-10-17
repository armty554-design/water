import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Member, DeliveryStop, DayOfWeek, UserRole } from './types/delivery';
import { AuthUser } from './types/auth';
import { Navbar } from './components/Navbar';
import { OfficeView } from './components/OfficeView';
import { DriverView } from './components/DriverView';
import { LoginView } from './components/LoginView';
import { 
  getMembers, saveMembers, getRoute, saveRoute, 
  markStopCompleted, getLastTruck, saveLastTruck 
} from './services/db';
import { getCurrentUser, clearSession } from './services/auth';
import { DeliveryConditionFilter, shouldIncludeMemberByCondition } from './services/weekHelper';
import initialMembersData from './data/initialData.json';

function getCurrentThaiDay(): DayOfWeek {
  const dayIndex = new Date().getDay();
  const days: DayOfWeek[] = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
  const day = days[dayIndex];
  return day === 'อาทิตย์' ? 'จันทร์' : day;
}

export const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [currentRole, setCurrentRole] = useState<UserRole>('office');
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedDay, setSelectedDay] = useState<DayOfWeek>(getCurrentThaiDay());
  const [selectedTruck, setSelectedTruck] = useState<string>('13106');
  const [stops, setStops] = useState<DeliveryStop[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Delivery condition filter (Default: only รอบปกติ!)
  const [conditionFilter, setConditionFilter] = useState<DeliveryConditionFilter>({
    includeRegular: true,
    includeBiWeekly: false,
    includeOnDemand: false,
    selectedMonthlyWeek: null
  });

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

  // 2. Compute Available Trucks for the Selected Day
  const availableTrucks = useMemo(() => {
    const truckCounts: Record<string, number> = {};
    members.forEach(m => {
      const deliversOnDay = m.deliveryDays.some(d => d.includes(selectedDay) || selectedDay.includes(d));
      const conditionMatches = shouldIncludeMemberByCondition(m.deliveryCondition, conditionFilter);
      if (deliversOnDay && conditionMatches && m.truckNo) {
        truckCounts[m.truckNo] = (truckCounts[m.truckNo] || 0) + 1;
      }
    });

    const list = Object.entries(truckCounts).map(([truckNo, count]) => ({ truckNo, count }));
    list.sort((a, b) => b.count - a.count);
    return list;
  }, [members, selectedDay, conditionFilter]);

  useEffect(() => {
    if (currentUser?.role === 'driver' && currentUser.assignedTruck) {
      setSelectedTruck(currentUser.assignedTruck);
      return;
    }
    if (availableTrucks.length > 0 && !availableTrucks.some(t => t.truckNo === selectedTruck)) {
      setSelectedTruck(availableTrucks[0].truckNo);
    }
  }, [availableTrucks, selectedTruck, currentUser]);

  // 3. Load or Build Stops for [selectedTruck, selectedDay, conditionFilter]
  const loadStopsForRoute = useCallback(async (
    truck: string, 
    day: DayOfWeek, 
    currentMembers: Member[],
    filter: DeliveryConditionFilter
  ) => {
    if (!truck) return;

    const savedRoute = await getRoute(truck, day);
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
      loadStopsForRoute(selectedTruck, selectedDay, members, conditionFilter);
      saveLastTruck(selectedTruck);
    }
  }, [selectedTruck, selectedDay, members, isLoading, conditionFilter, loadStopsForRoute]);

  // 4. Save Route to DB
  const handleSaveRoute = async () => {
    if (!selectedTruck || stops.length === 0) return;
    setIsSaving(true);
    try {
      await saveRoute(selectedTruck, selectedDay, stops);
      alert('บันทึกลำดับสายส่งเรียบร้อยแล้ว พนักงานส่งน้ำจะเห็นลำดับใหม่ทันที');
    } catch (err) {
      console.error(err);
      alert('บันทึกไม่สำเร็จ');
    } finally {
      setIsSaving(false);
    }
  };

  // 5. Driver Mark Complete
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
    await markStopCompleted(selectedTruck, selectedDay, memberId, isCompleted);
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
            availableTrucks={availableTrucks}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-3 text-center text-[11px] text-slate-400">
        AquaRoute • ระบบบริหารจัดการสายส่งน้ำดื่ม
      </footer>

    </div>
  );
};
