import * as XLSX from 'xlsx';
import { Member, RebalanceConfig, RebalanceResult, TruckVolumeStats, ReassignedMember } from '../types/delivery';
import { calculateDistanceKm } from './autoSequence';

/**
 * Calculates monthly bottle volume for a single member.
 * Formula considers scheduled drop quantities and frequency per month.
 */
export function calculateMemberMonthlyBottles(member: Member): number {
  let totalBottles = 0;
  const condition = member.deliveryCondition || '';

  // Determine weeks/runs per month based on delivery condition
  let runsMultiplier = 4.33; // ~4.33 weeks per month for regular weekly runs
  if (condition.includes('สัปดาห์เว้นสัปดาห์')) {
    runsMultiplier = 2.16;
  } else if (condition.includes('รายเดือน')) {
    runsMultiplier = 1.0;
  }

  const schedules = member.schedules;
  let hasValidSchedule = false;

  if (schedules && typeof schedules === 'object') {
    for (const dayKey of Object.keys(schedules)) {
      const sched = schedules[dayKey];
      if (sched && typeof sched.avgQuantity === 'number' && sched.avgQuantity > 0) {
        totalBottles += sched.avgQuantity * runsMultiplier;
        hasValidSchedule = true;
      }
    }
  }

  // Fallback if schedule didn't specify avgQuantity or it was 0
  if (!hasValidSchedule || totalBottles === 0) {
    const daysCount = member.deliveryDays && member.deliveryDays.length > 0 ? member.deliveryDays.length : 1;
    // Default estimated 5 bottles per regular drop if unrecorded
    totalBottles = daysCount * runsMultiplier * 5;
  }

  return Math.round(totalBottles * 10) / 10;
}

/**
 * Calculates workload statistics for each truck:
 * - Total monthly bottles
 * - Daily average bottles = monthlyBottles / workingDays
 * - Target daily bottles = targetCapacityPerDay * (targetPercentage / 100)
 * - Utilization rate = dailyAvgBottles / targetCapacityPerDay
 */
export function calculateTruckVolumeStats(
  members: Member[],
  workingDays: number,
  targetCapacityPerDay: number,
  targetPercentage: number,
  newTrucks: string[] = []
): TruckVolumeStats[] {
  const groups: Record<string, { count: number; monthlyBottles: number }> = {};

  // Initialize existing and new trucks
  newTrucks.forEach(t => {
    const cleanT = t.trim();
    if (cleanT && !groups[cleanT]) {
      groups[cleanT] = { count: 0, monthlyBottles: 0 };
    }
  });

  members.forEach(m => {
    const truck = (m.truckNo || 'UNASSIGNED').trim();
    if (!groups[truck]) {
      groups[truck] = { count: 0, monthlyBottles: 0 };
    }
    groups[truck].count += 1;
    groups[truck].monthlyBottles += calculateMemberMonthlyBottles(m);
  });

  const targetDailyBottles = targetCapacityPerDay * (targetPercentage / 100);
  const lowerOptimal = (targetPercentage - 5) / 100;
  const upperOptimal = (targetPercentage + 5) / 100;

  const statsList: TruckVolumeStats[] = Object.entries(groups).map(([truckNo, data]) => {
    const dailyAvgBottles = workingDays > 0 ? Math.round((data.monthlyBottles / workingDays) * 10) / 10 : 0;
    const utilizationRate = targetCapacityPerDay > 0 ? (dailyAvgBottles / targetCapacityPerDay) : 0;

    let status: 'optimal' | 'overload' | 'underload' = 'optimal';
    if (utilizationRate > upperOptimal) {
      status = 'overload';
    } else if (utilizationRate < lowerOptimal) {
      status = 'underload';
    }

    return {
      truckNo,
      memberCount: data.count,
      monthlyBottles: Math.round(data.monthlyBottles),
      dailyAvgBottles,
      targetDailyBottles: Math.round(targetDailyBottles * 10) / 10,
      utilizationRate: Math.round(utilizationRate * 1000) / 10, // in percent e.g. 89.5%
      status,
      isNew: newTrucks.includes(truckNo)
    };
  });

  // Sort: highest daily bottles first
  statsList.sort((a, b) => b.dailyAvgBottles - a.dailyAvgBottles);
  return statsList;
}

/**
 * Calculates geographical centroid (average lat, lng) for a set of members.
 */
function calculateCentroid(memberList: Member[]): { lat: number; lng: number; count: number } {
  let sumLat = 0;
  let sumLng = 0;
  let count = 0;

  for (const m of memberList) {
    if (m.hasGps && m.lat && m.lng) {
      sumLat += m.lat;
      sumLng += m.lng;
      count++;
    }
  }

  if (count === 0) {
    // Default Bangkok coordinates if no GPS found
    return { lat: 13.7563, lng: 100.5018, count: 0 };
  }
  return { lat: sumLat / count, lng: sumLng / count, count };
}

/**
 * Runs the rebalancing simulation to reach ~90% target workload across trucks.
 */
export function runRebalanceSimulation(
  members: Member[],
  config: RebalanceConfig
): RebalanceResult {
  const {
    workingDays = 26,
    targetCapacityPerDay = 220,
    targetPercentage = 90,
    lockedTrucks = [],
    newTrucks = []
  } = config;

  const targetDailyBottles = targetCapacityPerDay * (targetPercentage / 100);
  const targetMonthlyBottles = targetDailyBottles * workingDays;

  // 1. Calculate Baseline Stats Before Rebalancing
  const statsBefore = calculateTruckVolumeStats(
    members,
    workingDays,
    targetCapacityPerDay,
    targetPercentage,
    newTrucks
  );

  // Deep clone members to avoid mutating existing state
  const workingMembers: Member[] = members.map(m => ({ ...m }));
  const reassignedMembers: ReassignedMember[] = [];

  // Group working members by truck
  const truckMembersMap = new Map<string, Member[]>();
  workingMembers.forEach(m => {
    const t = m.truckNo.trim();
    if (!truckMembersMap.has(t)) truckMembersMap.set(t, []);
    truckMembersMap.get(t)!.push(m);
  });

  // Ensure newly added trucks exist in the map
  newTrucks.forEach(t => {
    const cleanT = t.trim();
    if (!truckMembersMap.has(cleanT)) truckMembersMap.set(cleanT, []);
  });

  // Calculate truck bottle totals and centroids
  const truckMonthlyMap = new Map<string, number>();
  const truckCentroidMap = new Map<string, { lat: number; lng: number }>();

  for (const [t, mList] of truckMembersMap.entries()) {
    const totalBottles = mList.reduce((acc, curr) => acc + calculateMemberMonthlyBottles(curr), 0);
    truckMonthlyMap.set(t, totalBottles);
    const centroid = calculateCentroid(mList);
    truckCentroidMap.set(t, { lat: centroid.lat, lng: centroid.lng });
  }

  // For new trucks with no members yet, seed centroid near the most overloaded truck
  newTrucks.forEach(nt => {
    const cleanT = nt.trim();
    if ((truckMembersMap.get(cleanT)?.length || 0) === 0) {
      // Find truck with highest monthly load
      let maxTruck = '';
      let maxLoad = -1;
      for (const [t, load] of truckMonthlyMap.entries()) {
        if (!lockedTrucks.includes(t) && !newTrucks.includes(t) && load > maxLoad) {
          maxLoad = load;
          maxTruck = t;
        }
      }
      if (maxTruck && truckCentroidMap.has(maxTruck)) {
        const baseCentroid = truckCentroidMap.get(maxTruck)!;
        truckCentroidMap.set(cleanT, { lat: baseCentroid.lat, lng: baseCentroid.lng });
      }
    }
  });

  // 2. Iterative Load Leveling Algorithm
  const lockedSet = new Set(lockedTrucks);
  const maxIterations = 3000;
  let iteration = 0;

  while (iteration < maxIterations) {
    iteration++;

    // Find donor trucks (monthlyBottles > targetMonthlyBottles * 1.02)
    const donors: { truck: string; excess: number }[] = [];
    // Find recipient trucks (monthlyBottles < targetMonthlyBottles * 0.98)
    const recipients: { truck: string; deficit: number }[] = [];

    for (const [t, load] of truckMonthlyMap.entries()) {
      if (lockedSet.has(t)) continue;

      const diff = load - targetMonthlyBottles;
      if (diff > targetDailyBottles * 0.5) { // excess of at least half a day's load
        donors.push({ truck: t, excess: diff });
      } else if (diff < -targetDailyBottles * 0.5) { // deficit of at least half a day's load
        recipients.push({ truck: t, deficit: -diff });
      }
    }

    if (donors.length === 0 || recipients.length === 0) {
      break; // Balanced!
    }

    // Sort donors by highest excess, recipients by highest deficit
    donors.sort((a, b) => b.excess - a.excess);
    recipients.sort((a, b) => b.deficit - a.deficit);

    const topDonor = donors[0];
    const donorMembers = truckMembersMap.get(topDonor.truck) || [];
    if (donorMembers.length <= 1) break;

    // Pick a recipient that is geographically viable or has highest deficit
    // Evaluate candidates from donorMembers:
    // We want a member whose monthly bottles is <= topDonor.excess + 20
    // and is closest to one of the recipients
    let bestCandidateIdx = -1;
    let bestRecipientTruck = '';
    let bestScore = Infinity; // lower score = closer distance + good fit

    for (let i = 0; i < donorMembers.length; i++) {
      const candidate = donorMembers[i];
      const candidateBottles = calculateMemberMonthlyBottles(candidate);

      // Don't move a single massive key account that completely overwhelms the recipient
      for (const rec of recipients) {
        if (candidateBottles > rec.deficit + targetDailyBottles * 0.5) {
          continue; // would overload recipient too much
        }

        const recCentroid = truckCentroidMap.get(rec.truck);
        let dist = 10; // default distance penalty if no GPS
        if (candidate.hasGps && recCentroid) {
          dist = calculateDistanceKm(candidate.lat, candidate.lng, recCentroid.lat, recCentroid.lng);
        }

        // Score balances distance and deficit match
        const score = dist;
        if (score < bestScore) {
          bestScore = score;
          bestCandidateIdx = i;
          bestRecipientTruck = rec.truck;
        }
      }
    }

    if (bestCandidateIdx === -1 || !bestRecipientTruck) {
      // If no perfect fit, pick the member closest to the top recipient
      const rec = recipients[0];
      const recCentroid = truckCentroidMap.get(rec.truck);
      let minDist = Infinity;
      for (let i = 0; i < donorMembers.length; i++) {
        const candidate = donorMembers[i];
        let dist = 10;
        if (candidate.hasGps && recCentroid) {
          dist = calculateDistanceKm(candidate.lat, candidate.lng, recCentroid.lat, recCentroid.lng);
        }
        if (dist < minDist) {
          minDist = dist;
          bestCandidateIdx = i;
          bestRecipientTruck = rec.truck;
        }
      }
    }

    if (bestCandidateIdx === -1) {
      break; // No further valid candidate to transfer
    }

    // Execute transfer of candidate
    const [movedMember] = donorMembers.splice(bestCandidateIdx, 1);
    const oldTruck = movedMember.truckNo;
    movedMember.truckNo = bestRecipientTruck;

    const recipientMembers = truckMembersMap.get(bestRecipientTruck)!;
    recipientMembers.push(movedMember);

    const transferredBottles = calculateMemberMonthlyBottles(movedMember);
    truckMonthlyMap.set(oldTruck, (truckMonthlyMap.get(oldTruck) || 0) - transferredBottles);
    truckMonthlyMap.set(bestRecipientTruck, (truckMonthlyMap.get(bestRecipientTruck) || 0) + transferredBottles);

    // Update recipient centroid incrementally
    if (movedMember.hasGps) {
      const oldCentroid = truckCentroidMap.get(bestRecipientTruck) || { lat: movedMember.lat, lng: movedMember.lng };
      const newCount = recipientMembers.filter(m => m.hasGps).length;
      truckCentroidMap.set(bestRecipientTruck, {
        lat: oldCentroid.lat + (movedMember.lat - oldCentroid.lat) / Math.max(1, newCount),
        lng: oldCentroid.lng + (movedMember.lng - oldCentroid.lng) / Math.max(1, newCount)
      });
    }

    // Record reassignment
    reassignedMembers.push({
      memberId: movedMember.id,
      memberName: movedMember.name,
      oldTruck,
      newTruck: bestRecipientTruck,
      monthlyBottles: transferredBottles,
      deliveryDays: movedMember.deliveryDays || [],
      address: movedMember.address,
      lat: movedMember.lat,
      lng: movedMember.lng,
      hasGps: movedMember.hasGps,
      distanceKm: Math.round(bestScore * 10) / 10
    });
  }

  // 3. Calculate Final Stats After Rebalancing
  const statsAfter = calculateTruckVolumeStats(
    workingMembers,
    workingDays,
    targetCapacityPerDay,
    targetPercentage,
    newTrucks
  );

  return {
    statsBefore,
    statsAfter,
    reassignedMembers,
    workingDays,
    targetDailyBottles: Math.round(targetDailyBottles * 10) / 10,
    updatedMembers: workingMembers
  };
}

/**
 * Exports rebalancing results to an Excel (.xlsx) workbook.
 */
export function exportRebalanceToExcel(result: RebalanceResult, filename = 'รายงานการจัดเกลี่ยสายส่ง_90percent.xlsx'): void {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Truck Workload Comparison (Before vs After)
  const truckRows: any[] = [
    [
      'เบอร์รถ',
      'สถานะสาย',
      'จุดส่งเดิม (จุด)',
      'จุดส่งใหม่ (จุด)',
      'เปลี่ยนแปลง (จุด)',
      'ยอดถังเดิม (ถัง/เดือน)',
      'ยอดถังใหม่ (ถัง/เดือน)',
      'ยอดส่งเฉลี่ยต่อวันเดิม (ถัง/วัน)',
      'ยอดส่งเฉลี่ยต่อวันใหม่ (ถัง/วัน)',
      'เป้าหมาย 90% (ถัง/วัน)',
      '% โหลดต่อความจุ',
      'สถานะเป้าหมาย'
    ]
  ];

  const beforeMap = new Map<string, TruckVolumeStats>(result.statsBefore.map(s => [s.truckNo, s]));

  result.statsAfter.forEach(after => {
    const before = beforeMap.get(after.truckNo) || {
      memberCount: 0,
      monthlyBottles: 0,
      dailyAvgBottles: 0,
      utilizationRate: 0
    };

    const diffMembers = after.memberCount - before.memberCount;
    const statusThai = 
      after.status === 'optimal' ? 'ตรงเป้า 90%' :
      after.status === 'overload' ? 'สูงกว่าเป้า' : 'ต่ำกว่าเป้า';

    truckRows.push([
      after.truckNo,
      after.isNew ? 'สายใหม่' : 'สายเดิม',
      before.memberCount,
      after.memberCount,
      diffMembers > 0 ? `+${diffMembers}` : String(diffMembers),
      before.monthlyBottles,
      after.monthlyBottles,
      before.dailyAvgBottles,
      after.dailyAvgBottles,
      result.targetDailyBottles,
      `${after.utilizationRate}%`,
      statusThai
    ]);
  });

  const wsTrucks = XLSX.utils.aoa_to_sheet(truckRows);
  XLSX.utils.book_append_sheet(wb, wsTrucks, 'สรุปเปรียบเทียบสายรถ');

  // Sheet 2: Reassigned Members Details
  const memberRows: any[] = [
    [
      'รหัสสมาชิก',
      'ชื่อ-นามสกุล',
      'ที่อยู่จัดส่ง',
      'รอบส่งประจำสัปดาห์',
      'ยอดส่ง (ถัง/เดือน)',
      'สายรถเดิม',
      'สายรถใหม่',
      'พิกัด GPS'
    ]
  ];

  result.reassignedMembers.forEach(m => {
    memberRows.push([
      m.memberId,
      m.memberName,
      m.address || '-',
      m.deliveryDays.join(', '),
      m.monthlyBottles,
      m.oldTruck,
      m.newTruck,
      m.hasGps ? `${m.lat}, ${m.lng}` : 'ไม่มี GPS'
    ]);
  });

  const wsMembers = XLSX.utils.aoa_to_sheet(memberRows);
  XLSX.utils.book_append_sheet(wb, wsMembers, 'รายการจุดส่งที่ย้ายสาย');

  // Trigger browser file download
  XLSX.writeFile(wb, filename);
}
