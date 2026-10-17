// Helper utilities for calculating weeks of month and matching delivery conditions

export function getWeekOfMonth(date: Date = new Date()): number {
  const dayOfMonth = date.getDate();
  return Math.ceil(dayOfMonth / 7); // 1, 2, 3, 4, or 5
}

export function isBiWeeklyDue(date: Date = new Date()): boolean {
  // Simple odd-week check or standard bi-weekly alternation
  const weekNum = getWeekOfMonth(date);
  return weekNum % 2 !== 0; // Odd weeks default
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

  // Fallback for others
  return filter.includeRegular;
}
