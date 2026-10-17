import { Member, RouteAssignment } from '../types/delivery';
import { getAllRoutes, saveRoute } from './db';

export interface MemberChange {
  memberId: string;
  name: string;
  field: 'truck' | 'gps' | 'days' | 'condition' | 'status';
  oldValue: string;
  newValue: string;
}

export interface SyncDiffReport {
  totalProcessed: number;
  addedCount: number;
  updatedCount: number;
  unchangedCount: number;
  truckChanges: { memberId: string; name: string; oldTruck: string; newTruck: string }[];
  gpsChanges: { memberId: string; name: string; oldGps: string; newGps: string }[];
  otherChanges: MemberChange[];
  cleanedRoutesCount: number;
  mergedMembers: Member[];
}

export async function syncMembersWithDiff(
  existingMembers: Member[],
  incomingMembers: Member[]
): Promise<SyncDiffReport> {
  const existingMap = new Map<string, Member>();
  existingMembers.forEach(m => existingMap.set(m.id, m));

  const mergedMembers: Member[] = [];
  const truckChanges: { memberId: string; name: string; oldTruck: string; newTruck: string }[] = [];
  const gpsChanges: { memberId: string; name: string; oldGps: string; newGps: string }[] = [];
  const otherChanges: MemberChange[] = [];

  let addedCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;

  // Track members that changed truck or days to remove them from old routes
  const changedTruckMembers = new Map<string, { oldTruck: string; newTruck: string }>();

  for (const incoming of incomingMembers) {
    const existing = existingMap.get(incoming.id);

    if (!existing) {
      // New member
      addedCount++;
      mergedMembers.push(incoming);
      continue;
    }

    // Check changes
    let isChanged = false;

    // 1. Truck number change
    if (existing.truckNo !== incoming.truckNo) {
      isChanged = true;
      truckChanges.push({
        memberId: incoming.id,
        name: incoming.name,
        oldTruck: existing.truckNo,
        newTruck: incoming.truckNo
      });
      changedTruckMembers.set(incoming.id, {
        oldTruck: existing.truckNo,
        newTruck: incoming.truckNo
      });
    }

    // 2. GPS change
    const oldGpsStr = existing.hasGps ? `${existing.lat.toFixed(6)}, ${existing.lng.toFixed(6)}` : 'ไม่มีพิกัด';
    const newGpsStr = incoming.hasGps ? `${incoming.lat.toFixed(6)}, ${incoming.lng.toFixed(6)}` : 'ไม่มีพิกัด';
    const latDiff = Math.abs(existing.lat - incoming.lat);
    const lngDiff = Math.abs(existing.lng - incoming.lng);

    if (existing.hasGps !== incoming.hasGps || latDiff > 0.0001 || lngDiff > 0.0001) {
      isChanged = true;
      gpsChanges.push({
        memberId: incoming.id,
        name: incoming.name,
        oldGps: oldGpsStr,
        newGps: newGpsStr
      });
    }

    // 3. Delivery Days change
    const oldDaysStr = existing.deliveryDays.sort().join(', ');
    const newDaysStr = incoming.deliveryDays.sort().join(', ');
    if (oldDaysStr !== newDaysStr) {
      isChanged = true;
      otherChanges.push({
        memberId: incoming.id,
        name: incoming.name,
        field: 'days',
        oldValue: oldDaysStr,
        newValue: newDaysStr
      });
    }

    // 4. Condition change
    if (existing.deliveryCondition !== incoming.deliveryCondition) {
      isChanged = true;
      otherChanges.push({
        memberId: incoming.id,
        name: incoming.name,
        field: 'condition',
        oldValue: existing.deliveryCondition,
        newValue: incoming.deliveryCondition
      });
    }

    if (isChanged) {
      updatedCount++;
      // Merge with new data while preserving existing attachments & notes
      mergedMembers.push({
        ...incoming,
        attachments: existing.attachments || incoming.attachments || []
      });
    } else {
      unchangedCount++;
      mergedMembers.push({
        ...incoming,
        attachments: existing.attachments || []
      });
    }
  }

  // Clean up old routes:
  // If a member changed truck, remove that member from the old truck's saved routes
  let cleanedRoutesCount = 0;
  if (changedTruckMembers.size > 0) {
    const allRoutes = await getAllRoutes();
    for (const [routeKey, route] of Object.entries(allRoutes)) {
      let routeModified = false;
      const filteredStops = route.stops.filter(stop => {
        const change = changedTruckMembers.get(stop.member.id);
        if (change && change.oldTruck === route.truckNo) {
          // Member moved away from this truck -> delete from old route!
          routeModified = true;
          cleanedRoutesCount++;
          return false;
        }
        return true;
      });

      if (routeModified) {
        // Re-sequence remaining stops
        const resequenced = filteredStops.map((s, idx) => ({ ...s, sequence: idx + 1 }));
        await saveRoute(route.truckNo, route.day, resequenced);
      }
    }
  }

  return {
    totalProcessed: incomingMembers.length,
    addedCount,
    updatedCount,
    unchangedCount,
    truckChanges,
    gpsChanges,
    otherChanges,
    cleanedRoutesCount,
    mergedMembers
  };
}
