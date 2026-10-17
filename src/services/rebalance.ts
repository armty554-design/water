import * as XLSX from 'xlsx';
import { 
  Member, 
  RebalanceConfig, 
  RebalanceResult, 
  TruckVolumeStats, 
  ReassignedMember,
  SpatialClusterCandidate 
} from '../types/delivery';
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
  if (condition.includes('สัปดาห์เว้นสัปดาห์') || condition.includes('รอบเว้นรอบ')) {
    runsMultiplier = 2.16;
  } else if (condition.includes('รายเดือน') || condition.includes('สัปดาห์ที่')) {
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
 * Checks if a member has special conditions that should restrict changing round/days.
 */
export function hasSpecialDeliveryCondition(member: Member): boolean {
  const cond = (member.deliveryCondition || '').trim();
  const warning = (member.warningNotes || '').trim();
  
  // Non-standard conditions that should not be disrupted
  if (
    cond.includes('โทรสั่ง') ||
    cond.includes('เว้น') ||
    cond.includes('สัปดาห์ที่') ||
    cond.includes('แผนการเติมคูปอง') ||
    member.riskDamagedBottles ||
    member.isHighBuildingNoElevator ||
    warning === '1' ||
    warning.length > 0
  ) {
    return true;
  }
  return false;
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
export function calculateCentroid(memberList: Member[]): { lat: number; lng: number; count: number } {
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
    return { lat: 13.7563, lng: 100.5018, count: 0 };
  }
  return { lat: sumLat / count, lng: sumLng / count, count };
}

/**
 * Finds contiguous spatial cluster candidates (กลุ่มก้อนเชิงพื้นที่) within a donor truck.
 * Used for targeted cutting so stops are grouped tightly on the map instead of randomly scattered.
 */
export function findSpatialClustersForTruck(
  members: Member[],
  truckNo: string,
  targetDailyBottlesCut: number,
  workingDays: number,
  options: {
    lockedMemberIds?: string[];
    excludeSpecialConditions?: boolean;
    preserveDeliveryDays?: boolean;
    filterDay?: string;
  } = {}
): SpatialClusterCandidate[] {
  const {
    lockedMemberIds = [],
    excludeSpecialConditions = true,
    filterDay
  } = options;

  const lockedSet = new Set(lockedMemberIds);

  // Filter eligible members from donor truck
  const donorMembers = members.filter(m => {
    if (m.truckNo.trim() !== truckNo.trim()) return false;
    if (lockedSet.has(m.id)) return false;
    if (excludeSpecialConditions && hasSpecialDeliveryCondition(m)) return false;
    if (filterDay && !m.deliveryDays.includes(filterDay)) return false;
    return true;
  });

  if (donorMembers.length === 0) return [];

  const targetMonthlyBottlesCut = targetDailyBottlesCut * workingDays;
  const centroid = calculateCentroid(donorMembers);

  // Compute distance from centroid for each member
  const withDistance = donorMembers
    .filter(m => m.hasGps && m.lat && m.lng)
    .map(m => ({
      member: m,
      distFromCenter: calculateDistanceKm(centroid.lat, centroid.lng, m.lat, m.lng)
    }));

  if (withDistance.length === 0) return [];

  // Sort by furthest distance from center to find boundary/edge seeds
  withDistance.sort((a, b) => b.distFromCenter - a.distFromCenter);

  // Select up to 3 distinct seed points around different geographic sectors (Edge, North/East, South/West)
  const seedCandidates: Member[] = [];
  seedCandidates.push(withDistance[0].member); // furthest edge

  // Find second seed that is far from first seed
  for (let i = 1; i < withDistance.length; i++) {
    const candidate = withDistance[i].member;
    const d = calculateDistanceKm(seedCandidates[0].lat, seedCandidates[0].lng, candidate.lat, candidate.lng);
    if (d > 3.0) { // at least 3km apart
      seedCandidates.push(candidate);
      break;
    }
  }

  // Find third seed if possible
  if (seedCandidates.length === 2) {
    for (let i = 1; i < withDistance.length; i++) {
      const candidate = withDistance[i].member;
      const d1 = calculateDistanceKm(seedCandidates[0].lat, seedCandidates[0].lng, candidate.lat, candidate.lng);
      const d2 = calculateDistanceKm(seedCandidates[1].lat, seedCandidates[1].lng, candidate.lat, candidate.lng);
      if (d1 > 2.5 && d2 > 2.5) {
        seedCandidates.push(candidate);
        break;
      }
    }
  }

  const clusters: SpatialClusterCandidate[] = [];

  seedCandidates.forEach((seed, index) => {
    // Sort all donor members by distance to this seed
    const sortedBySeed = [...donorMembers].map(m => {
      let d = 10;
      if (m.hasGps && m.lat && m.lng) {
        d = calculateDistanceKm(seed.lat, seed.lng, m.lat, m.lng);
      }
      return { member: m, distToSeed: d };
    }).sort((a, b) => a.distToSeed - b.distToSeed);

    // Expand cluster pocket radially until target cut bottles is reached
    const clusterMembers: Member[] = [];
    let accumulatedMonthlyBottles = 0;
    let maxRadiusKm = 0;

    for (const item of sortedBySeed) {
      clusterMembers.push(item.member);
      accumulatedMonthlyBottles += calculateMemberMonthlyBottles(item.member);
      if (item.distToSeed < 9000 && item.distToSeed > maxRadiusKm) {
        maxRadiusKm = item.distToSeed;
      }

      if (accumulatedMonthlyBottles >= targetMonthlyBottlesCut) {
        break;
      }
    }

    const clusterDailyBottles = workingDays > 0 ? Math.round((accumulatedMonthlyBottles / workingDays) * 10) / 10 : 0;

    clusters.push({
      clusterId: `cluster-${truckNo}-${index + 1}`,
      label: `กลุ่มก้อนที่ ${index + 1} (รัศมี ${maxRadiusKm.toFixed(1)} กม., ~${clusterDailyBottles} ถัง/วัน)`,
      seedMemberId: seed.id,
      seedLat: seed.lat,
      seedLng: seed.lng,
      radiusKm: Math.round(maxRadiusKm * 100) / 100,
      memberCount: clusterMembers.length,
      monthlyBottles: Math.round(accumulatedMonthlyBottles),
      dailyAvgBottles: clusterDailyBottles,
      members: clusterMembers
    });
  });

  return clusters;
}

/**
 * Runs the rebalancing simulation to reach ~90% target workload across trucks.
 * Supports:
 * - Targeted Cluster Cut: Cuts a contiguous pocket from a specific donor truck into a recipient/new truck.
 * - Fleet-wide Rebalance: Leveling across fleet with spatial contiguous groupings.
 */
export function runRebalanceSimulation(
  members: Member[],
  config: RebalanceConfig
): RebalanceResult {
  const {
    workingDays = 26,
    targetCapacityPerDay = 160, // 160 bottles = 100%
    targetPercentage = 90,       // 90% = 144 bottles/day
    donorTruck,
    targetRecipientTruck,
    selectedClusterId,
    lockedTrucks = [],
    lockedMemberIds = [],
    preserveDeliveryDays = true,
    excludeSpecialConditions = true,
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

  const workingMembers: Member[] = members.map(m => ({ ...m }));
  const reassignedMembers: ReassignedMember[] = [];
  const lockedMemberSet = new Set(lockedMemberIds);

  // --- MODE A: TARGETED SINGLE-TRUCK CLUSTER CUT ---
  if (donorTruck && donorTruck.trim()) {
    const cleanDonor = donorTruck.trim();
    const donorStat = statsBefore.find(s => s.truckNo === cleanDonor);

    // Calculate how many bottles to cut to bring donor truck down to 90% (or targetDailyBottles)
    const currentDaily = donorStat ? donorStat.dailyAvgBottles : targetDailyBottles;
    const excessDaily = Math.max(10, currentDaily - targetDailyBottles);

    // Pick target recipient: either specified recipient, or first new truck, or an underloaded truck
    let recipientTruck = (targetRecipientTruck || '').trim();
    if (!recipientTruck) {
      if (newTrucks.length > 0) {
        recipientTruck = newTrucks[0];
      } else {
        // Find underloaded truck
        const under = statsBefore.filter(s => s.truckNo !== cleanDonor && s.dailyAvgBottles < targetDailyBottles);
        recipientTruck = under.length > 0 ? under[under.length - 1].truckNo : (newTrucks[0] || '13NEW01');
      }
    }

    // Find spatial clusters in donor truck
    const clusters = findSpatialClustersForTruck(
      workingMembers,
      cleanDonor,
      excessDaily,
      workingDays,
      { lockedMemberIds, excludeSpecialConditions, preserveDeliveryDays }
    );

    let chosenCluster = clusters.find(c => c.clusterId === selectedClusterId) || clusters[0];

    if (chosenCluster && chosenCluster.members.length > 0) {
      const movedIds = new Set(chosenCluster.members.map(m => m.id));

      workingMembers.forEach(m => {
        if (m.truckNo.trim() === cleanDonor && movedIds.has(m.id)) {
          const oldTruck = m.truckNo;
          m.truckNo = recipientTruck;

          // Preserve member's delivery days unchanged!
          // (preserveDeliveryDays ensures round remains identical)
          const monthlyBottles = calculateMemberMonthlyBottles(m);
          reassignedMembers.push({
            memberId: m.id,
            memberName: m.name,
            oldTruck,
            newTruck: recipientTruck,
            monthlyBottles,
            deliveryDays: m.deliveryDays || [],
            address: m.address,
            lat: m.lat,
            lng: m.lng,
            hasGps: m.hasGps,
            distanceKm: calculateDistanceKm(chosenCluster.seedLat, chosenCluster.seedLng, m.lat, m.lng)
          });
        }
      });
    }

    const statsAfter = calculateTruckVolumeStats(
      workingMembers,
      workingDays,
      targetCapacityPerDay,
      targetPercentage,
      newTrucks.includes(recipientTruck) ? newTrucks : [...newTrucks, recipientTruck]
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

  // --- MODE B: FLEET-WIDE 90% REBALANCE (SPATIAL POCKET LEVELING) ---
  const truckMembersMap = new Map<string, Member[]>();
  workingMembers.forEach(m => {
    const t = m.truckNo.trim();
    if (!truckMembersMap.has(t)) truckMembersMap.set(t, []);
    truckMembersMap.get(t)!.push(m);
  });

  newTrucks.forEach(t => {
    const cleanT = t.trim();
    if (!truckMembersMap.has(cleanT)) truckMembersMap.set(cleanT, []);
  });

  const truckMonthlyMap = new Map<string, number>();
  const truckCentroidMap = new Map<string, { lat: number; lng: number }>();

  for (const [t, mList] of truckMembersMap.entries()) {
    const totalBottles = mList.reduce((acc, curr) => acc + calculateMemberMonthlyBottles(curr), 0);
    truckMonthlyMap.set(t, totalBottles);
    const centroid = calculateCentroid(mList);
    truckCentroidMap.set(t, { lat: centroid.lat, lng: centroid.lng });
  }

  // Seed new trucks near most overloaded lines
  newTrucks.forEach(nt => {
    const cleanT = nt.trim();
    if ((truckMembersMap.get(cleanT)?.length || 0) === 0) {
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

  const lockedTruckSet = new Set(lockedTrucks);
  const maxIterations = 3000;
  let iteration = 0;

  while (iteration < maxIterations) {
    iteration++;

    const donors: { truck: string; excess: number }[] = [];
    const recipients: { truck: string; deficit: number }[] = [];

    for (const [t, load] of truckMonthlyMap.entries()) {
      if (lockedTruckSet.has(t)) continue;

      const diff = load - targetMonthlyBottles;
      if (diff > targetDailyBottles * 0.3) {
        donors.push({ truck: t, excess: diff });
      } else if (diff < -targetDailyBottles * 0.3) {
        recipients.push({ truck: t, deficit: -diff });
      }
    }

    if (donors.length === 0 || recipients.length === 0) break;

    donors.sort((a, b) => b.excess - a.excess);
    recipients.sort((a, b) => b.deficit - a.deficit);

    const topDonor = donors[0];
    const donorMembers = truckMembersMap.get(topDonor.truck) || [];
    if (donorMembers.length <= 1) break;

    let bestCandidateIdx = -1;
    let bestRecipientTruck = '';
    let bestScore = Infinity;

    for (let i = 0; i < donorMembers.length; i++) {
      const candidate = donorMembers[i];
      if (lockedMemberSet.has(candidate.id)) continue;
      if (excludeSpecialConditions && hasSpecialDeliveryCondition(candidate)) continue;

      const candidateBottles = calculateMemberMonthlyBottles(candidate);

      for (const rec of recipients) {
        if (candidateBottles > rec.deficit + targetDailyBottles * 0.4) continue;

        const recCentroid = truckCentroidMap.get(rec.truck);
        let dist = 10;
        if (candidate.hasGps && recCentroid) {
          dist = calculateDistanceKm(candidate.lat, candidate.lng, recCentroid.lat, recCentroid.lng);
        }

        if (dist < bestScore) {
          bestScore = dist;
          bestCandidateIdx = i;
          bestRecipientTruck = rec.truck;
        }
      }
    }

    if (bestCandidateIdx === -1) break;

    const [movedMember] = donorMembers.splice(bestCandidateIdx, 1);
    const oldTruck = movedMember.truckNo;
    movedMember.truckNo = bestRecipientTruck;

    const recipientMembers = truckMembersMap.get(bestRecipientTruck)!;
    recipientMembers.push(movedMember);

    const transferredBottles = calculateMemberMonthlyBottles(movedMember);
    truckMonthlyMap.set(oldTruck, (truckMonthlyMap.get(oldTruck) || 0) - transferredBottles);
    truckMonthlyMap.set(bestRecipientTruck, (truckMonthlyMap.get(bestRecipientTruck) || 0) + transferredBottles);

    if (movedMember.hasGps) {
      const oldCentroid = truckCentroidMap.get(bestRecipientTruck) || { lat: movedMember.lat, lng: movedMember.lng };
      const newCount = recipientMembers.filter(m => m.hasGps).length;
      truckCentroidMap.set(bestRecipientTruck, {
        lat: oldCentroid.lat + (movedMember.lat - oldCentroid.lat) / Math.max(1, newCount),
        lng: oldCentroid.lng + (movedMember.lng - oldCentroid.lng) / Math.max(1, newCount)
      });
    }

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
      '% โหลดต่อความจุ (ฐาน 160 ถัง)',
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
      'รอบส่งประจำสัปดาห์ (คงเดิม)',
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
