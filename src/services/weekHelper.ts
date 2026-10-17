import { DayOfWeek } from '../types/delivery';

export function getWeekOfMonth(date: Date = new Date()): number {
  const dayOfMonth = date.getDate();
  return Math.ceil(dayOfMonth / 7); // 1, 2, 3, 4, or 5
}

export function isBiWeeklyDue(date: Date = new Date()): boolean {
  const weekNum = getWeekOfMonth(date);
  return weekNum % 2 !== 0;
}

export interface DeliveryConditionFilter {
  includeRegular: boolean;      // รอบปกติ (Default: true)
  includeBiWeekly: boolean;     // รอบเว้นรอบ (Default: false)
  includeOnDemand: boolean;     // โทรสั่งก่อนน้ำหมด (Default: false)
  selectedMonthlyWeek: number | null; // 1, 2, 3, 4, or null
}

export function shouldIncludeMemberByCondition(
  condition: string,
  filter: DeliveryConditionFilter
): boolean {
  const cond = condition || 'รอบปกติ';

  if (cond.includes('รอบปกติ')) {
    return filter.includeRegular;
  }

  if (cond.includes('รอบเว้นรอบ')) {
    return filter.includeBiWeekly;
  }

  if (cond.includes('โทรสั่ง')) {
    return filter.includeOnDemand;
  }

  if (cond.includes('สัปดาห์ที่ 1')) {
    return filter.selectedMonthlyWeek === 1;
  }
  if (cond.includes('สัปดาห์ที่ 2')) {
    return filter.selectedMonthlyWeek === 2;
  }
  if (cond.includes('สัปดาห์ที่ 3')) {
    return filter.selectedMonthlyWeek === 3;
  }
  if (cond.includes('สัปดาห์ที่ 4')) {
    return filter.selectedMonthlyWeek === 4;
  }

  return filter.includeRegular;
}

const THAI_DAYS: DayOfWeek[] = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

const THAI_MONTHS = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
];

export function getDayOfWeekFromDate(dateStr: string): DayOfWeek {
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  const dayName = THAI_DAYS[d.getDay()];
  return dayName === 'อาทิตย์' ? 'จันทร์' : dayName;
}

export function formatDateThai(dateStr: string): string {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  const dayName = THAI_DAYS[d.getDay()];
  const monthName = THAI_MONTHS[d.getMonth()];
  const thaiYear = d.getFullYear() + 543;
  return `${dayName}ที่ ${d.getDate()} ${monthName} ${thaiYear}`;
}

export function getTodayDateKey(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getRelativeDateKey(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
