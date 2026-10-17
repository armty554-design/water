export type DayOfWeek = 'จันทร์' | 'อังคาร' | 'พุธ' | 'พฤหัสบดี' | 'ศุกร์' | 'เสาร์' | 'อาทิตย์';

export type UserRole = 'office' | 'driver';

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
