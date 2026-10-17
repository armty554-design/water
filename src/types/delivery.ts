export type DayOfWeek = 'จันทร์' | 'อังคาร' | 'พุธ' | 'พฤหัสบดี' | 'ศุกร์' | 'เสาร์' | 'อาทิตย์';

export type UserRole = 'office' | 'driver' | 'rebalance';

export interface DaySchedule {
  day: string;          // e.g. "จ.", "อ.", "พ."
  dayFull: DayOfWeek;   // e.g. "จันทร์"
  avgQuantity: number;  // e.g. 17
  timeWindow: string;   // e.g. "06:00-08:00"
  minMaxTime?: string;  // e.g. "07:12-09:54"
  historyTimes: string[]; // e.g. ["2026-10-12 07:12", ...]
  avgActualTimeMinutes?: number; // Minutes from 00:00 (e.g. 07:30 = 450)
}

export interface Attachment {
  id: string;
  name: string;
  type: 'image' | 'document' | 'other';
  dataUrl: string; // Base64 or Blob URL
  createdAt: string;
  notes?: string;
}

export interface Member {
  id: string; // รหัสสมาชิก e.g. "00033"
  name: string; // ชื่อ-นามสกุล
  address?: string; // ที่อยู่จัดส่ง / สถานที่ส่งน้ำ
  deliveryDays: string[]; // e.g. ["จันทร์", "พุธ"]
  additionalRound?: string; // รอบเสริม
  truckNo: string; // เบอร์รถ e.g. "13106"
  receiveType: string; // ประเภทการรับน้ำ e.g. "สมาชิกตั้งถังหน้าบ้าน / ห้อง"
  deliveryCondition: string; // เงื่อนไขการจัดส่ง e.g. "รอบปกติ"
  customerGroup: string; // กลุ่มลูกค้า e.g. "B2C", "Key Account 1"
  warningNotes?: string; // เฝ้าระวังการจัดส่ง
  isHighBuildingNoElevator?: boolean; // สมาชิกกลุ่มอาคารสูงและไม่มีลิฟท์
  isECoupon?: boolean; // สมาชิกเป็นประเภทอี-คูปอง
  riskDamagedBottles?: boolean; // เสี่ยงทำถังน้ำดื่มเสียหาย
  lastRoundMoveDate?: string; // วันที่ย้ายรอบส่งล่าสุด
  couponPlan?: string; // แผนการเติมคูปอง
  status: string; // สถานะลูกค้า e.g. "ปกติ"
  lat: number;
  lng: number;
  hasGps: boolean;
  targetTime?: string; // Col 16 เช่น "0900", "0000"
  rawScheduleText?: string;
  avgMonthlyBottles?: number; // ยอดส่งเฉลี่ยต่อเดือนจากไฟล์ ยอดเฉลี่ย.xlsx
  schedules: Record<string, DaySchedule>; // key = DayOfWeek (e.g. "จันทร์")
  attachments?: Attachment[];
}

export interface DeliveryStop {
  sequence: number; // 1, 2, 3...
  member: Member;
  daySchedule?: DaySchedule;
  isCompleted: boolean;
  completedAt?: string;
  notes?: string;
  proofPhoto?: string;
}

export interface RouteAssignment {
  truckNo: string;
  day: DayOfWeek;
  dateKey: string; // YYYY-MM-DD
  stops: DeliveryStop[];
  updatedAt: string;
}

export interface SpatialClusterCandidate {
  clusterId: string;
  label: string;
  seedMemberId: string;
  seedLat: number;
  seedLng: number;
  radiusKm: number;
  memberCount: number;
  monthlyBottles: number;
  dailyAvgBottles: number;
  members: Member[];
}

export interface RebalanceConfig {
  workingDays: number; // default: 26 วัน
  targetCapacityPerDay: number; // default: 160 ถัง/วัน (100% capacity => 160 * workingDays = 4,160)
  targetPercentage: number; // default: 90% (144 ถัง/วัน => 144 * workingDays = 3,744)
  donorTruck?: string; // single donor truck (backwards compatible)
  donorTrucks?: string[]; // multiple selected donor trucks to cut from
  targetRecipientTruck?: string; // specific truck to receive
  targetRecipientTrucks?: string[]; // multiple recipient trucks to distribute to
  selectedTrucks?: string[];
  lockedTrucks?: string[];
  lockedMemberIds?: string[]; // specific members prohibited from moving
  preserveDeliveryDays?: boolean; // do not change member delivery day (default: true)
  excludeSpecialConditions?: boolean; // prevent members with special conditions/warnings from moving
  newTrucks: string[]; // e.g. ["13199", "13200"]
  selectedClusterId?: string;
}

export interface TruckVolumeStats {
  truckNo: string;
  memberCount: number;
  monthlyBottles: number;
  dailyAvgBottles: number; // monthlyBottles / workingDays
  targetDailyBottles: number; // targetCapacityPerDay * (targetPercentage / 100)
  utilizationRate: number; // dailyAvgBottles / targetCapacityPerDay
  status: 'optimal' | 'overload' | 'underload';
  isNew?: boolean;
}

export interface ReassignedMember {
  memberId: string;
  memberName: string;
  oldTruck: string;
  newTruck: string;
  monthlyBottles: number;
  deliveryDays: string[];
  address?: string;
  lat: number;
  lng: number;
  hasGps: boolean;
  distanceKm?: number;
}

export interface RebalanceResult {
  statsBefore: TruckVolumeStats[];
  statsAfter: TruckVolumeStats[];
  reassignedMembers: ReassignedMember[];
  workingDays: number;
  targetDailyBottles: number;
  updatedMembers: Member[];
}

