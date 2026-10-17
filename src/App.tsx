import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Member, DeliveryStop, DayOfWeek, UserRole } from './types/delivery';
import { Navbar } from './components/Navbar';
import { OfficeView } from './components/OfficeView';
import { DriverView } from './components/DriverView';
import { 
  getMembers, saveMembers, getRoute, saveRoute, 
  markStopCompleted, getLastTruck, saveLastTruck 
} from './services/db';
import initialMembersData from './data/initialData.json';

// Helper to get current Day of Week in Thai
function getCurrentThaiDay(): DayOfWeek {
  const dayIndex = new Date().getDay(); // 0 = Sunday, 1 = Monday...
  const days: DayOfWeek[] = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
  const day = days[dayIndex];
  // Default to Monday if Sunday (as most deliveries run Mon-Sat)
  return day === 'อาทิตย์' ? 'จันทร์' : day;
}

export const App: React.FC = () => {
  const [currentRole, setCurrentRole] = useState<UserRole>('office');
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedDay, setSelectedDay] = useState<DayOfWeek>(getCurrentThaiDay());
  const [selectedTruck, setSelectedTruck] = useState<string>('13106');
  const [stops, setStops] = useState<DeliveryStop[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // 1. Initial Load: Load from IndexedDB or seed initialData
  useEffect(() => {
    async function initData() {
      setIsLoading(true);
      try {
        let loadedMembers = await getMembers();
        if (!loadedMembers || loadedMembers.length === 0) {
          // Use bundled sample data
          loadedMembers = initialMembersData as Member[];
          await saveMembers(loadedMembers);
        }
        setMembers(loadedMembers);

        // Load last truck
        const lastTruck = await getLastTruck();
        if (lastTruck) {
          setSelectedTruck(lastTruck);
        } else if (loadedMembers.length > 0) {
          // Find first truck with stops on this day
          const firstTruck = loadedMembers.find(m => m.deliveryDays.includes(selectedDay))?.truckNo || loadedMembers[0].truckNo;
          setSelectedTruck(firstTruck);
        }
      } catch (err) {
        console.error('Failed to init members:', err);
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
      // Check if member has delivery on selectedDay
      const deliversOnDay = m.deliveryDays.some(d => d.includes(selectedDay) || selectedDay.includes(d));
      if (deliversOnDay && m.truckNo) {
        truckCounts[m.truckNo] = (truckCounts[m.truckNo] || 0) + 1;
      }
    });

    const list = Object.entries(truckCounts).map(([truckNo, count]) => ({ truckNo, count }));
    list.sort((a, b) => b.count - a.count);
    return list;
  }, [members, selectedDay]);

  // If current selectedTruck is not in availableTrucks, switch to first available
  useEffect(() => {
    if (availableTrucks.length > 0 && !availableTrucks.some(t => t.truckNo === selectedTruck)) {
      setSelectedTruck(availableTrucks[0].truckNo);
    }
  }, [availableTrucks, selectedTruck]);

  // 3. Load or Build Stops for [selectedTruck, selectedDay]
  const loadStopsForRoute = useCallback(async (truck: string, day: DayOfWeek, currentMembers: Member[]) => {
    if (!truck) return;

    // Check if there is an existing saved route in IndexedDB
    const savedRoute = await getRoute(truck, day);
    if (savedRoute && savedRoute.stops && savedRoute.stops.length > 0) {
      // Merge with latest member details
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

    // Otherwise, generate fresh default stops
    const dayFilteredMembers = currentMembers.filter(m => {
      const matchTruck = m.truckNo === truck;
      const matchDay = m.deliveryDays.some(d => d.includes(day) || day.includes(d));
      return matchTruck && matchDay;
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
      loadStopsForRoute(selectedTruck, selectedDay, members);
      saveLastTruck(selectedTruck);
    }
  }, [selectedTruck, selectedDay, members, isLoading, loadStopsForRoute]);

  // 4. Save Route to DB
  const handleSaveRoute = async () => {
    if (!selectedTruck || stops.length === 0) return;
    setIsSaving(true);
    try {
      await saveRoute(selectedTruck, selectedDay, stops);
      alert('บันทึกลำดับสายส่งเรียบร้อยแล้ว! ฝั่งคนขับจะเห็นลำดับใหม่ทันที');
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

  // 6. Manual Reset or Reload default dataset
  const handleLoadInitialData = async () => {
    const seed = initialMembersData as Member[];
    await saveMembers(seed);
    setMembers(seed);
  };

  const completedCount = stops.filter(s => s.isCompleted).length;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col selection:bg-brand-500 selection:text-white">
      
      {/* Navigation Header */}
      <Navbar
        currentRole={currentRole}
        onRoleChange={setCurrentRole}
        totalMembers={members.length}
        activeTrucksCount={availableTrucks.length}
        completedStopsCount={completedCount}
        totalStopsCount={stops.length}
      />

      {/* Main App Body */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {isLoading ? (
          <div className="h-96 flex flex-col items-center justify-center space-y-4">
            <div className="w-12 h-12 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin"></div>
            <p className="text-sm font-medium text-slate-500">กำลังเตรียมข้อมูลระบบจัดสายส่งน้ำ...</p>
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
      <footer className="border-t border-slate-200 bg-white py-4 text-center text-xs text-slate-400">
        ระบบจัดสายส่งน้ำดื่มสำหรับสมาชิก • AquaRoute Delivery System
      </footer>

    </div>
  );
};
