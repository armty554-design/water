import * as XLSX from 'xlsx';
import { Member, DaySchedule, DayOfWeek } from '../types/delivery';

const DAY_MAP: Record<string, DayOfWeek> = {
  'จ.': 'จันทร์',
  'อ.': 'อังคาร',
  'พ.': 'พุธ',
  'พฤ.': 'พฤหัสบดี',
  'ศ.': 'ศุกร์',
  'ส.': 'เสาร์',
  'อา.': 'อาทิตย์',
  'จันทร์': 'จันทร์',
  'อังคาร': 'อังคาร',
  'พุธ': 'พุธ',
  'พฤหัสบดี': 'พฤหัสบดี',
  'ศุกร์': 'ศุกร์',
  'เสาร์': 'เสาร์',
  'อาทิตย์': 'อาทิตย์'
};

export function parseScheduleText(text: string): Record<string, DaySchedule> {
  const result: Record<string, DaySchedule> = {};
  if (!text || typeof text !== 'string') return result;

  // Split by double newline or sections starting with "วัน="
  const blocks = text.split(/(?=วัน=)/g);

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const dayMatch = trimmed.match(/วัน=([^ \n\r]+)/);
    if (!dayMatch) continue;
    const shortDay = dayMatch[1].trim();
    const dayFull = DAY_MAP[shortDay] || (shortDay as DayOfWeek);

    const avgMatch = trimmed.match(/avg=([0-9.]+)/);
    const avgQuantity = avgMatch ? parseFloat(avgMatch[1]) : 0;

    const timeMatch = trimmed.match(/เวลา=([0-9:.-]+)/);
    const timeWindow = timeMatch ? timeMatch[1].trim() : '';

    const minMaxMatch = trimmed.match(/Min-Max=([0-9:.-]+)/);
    const minMaxTime = minMaxMatch ? minMaxMatch[1].trim() : undefined;

    const roundsMatch = trimmed.match(/4รอบ=([^\n\r]+)/);
    const historyTimes: string[] = [];
    let avgActualTimeMinutes: number | undefined = undefined;

    if (roundsMatch) {
      const dates = roundsMatch[1].split(',').map(s => s.trim()).filter(Boolean);
      historyTimes.push(...dates);

      // Extract time portion "HH:MM"
      const timeMinutes: number[] = [];
      for (const d of dates) {
        const tMatch = d.match(/(\d{1,2}):(\d{2})/);
        if (tMatch) {
          const hours = parseInt(tMatch[1], 10);
          const mins = parseInt(tMatch[2], 10);
          timeMinutes.push(hours * 60 + mins);
        }
      }

      if (timeMinutes.length > 0) {
        const sum = timeMinutes.reduce((a, b) => a + b, 0);
        avgActualTimeMinutes = Math.round(sum / timeMinutes.length);
      }
    }

    // Fallback if no 4รอบ, try timeWindow start time
    if (avgActualTimeMinutes === undefined && timeWindow) {
      const startMatch = timeWindow.match(/^(\d{1,2}):(\d{2})/);
      if (startMatch) {
        avgActualTimeMinutes = parseInt(startMatch[1], 10) * 60 + parseInt(startMatch[2], 10);
      }
    }

    result[dayFull] = {
      day: shortDay,
      dayFull,
      avgQuantity,
      timeWindow,
      minMaxTime,
      historyTimes,
      avgActualTimeMinutes
    };
  }

  return result;
}

export function parseExcelFile(arrayBuffer: ArrayBuffer): Member[] {
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  // Find header row (usually contains "รหัสสมาชิก")
  let headerIndex = -1;
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const row = rows[i];
    if (row && row.some(cell => typeof cell === 'string' && cell.includes('รหัสสมาชิก'))) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) {
    headerIndex = 5; // default fallback
  }

  let addressColIndex = -1;
  if (rows[headerIndex]) {
    addressColIndex = rows[headerIndex].findIndex(cell => 
      typeof cell === 'string' && (cell.includes('ที่อยู่') || cell.toLowerCase().includes('address'))
    );
  }

  const members: Member[] = [];

  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[0]) continue;

    const id = String(row[0]).trim();
    const name = String(row[1] || '').trim();
    if (!id || !name) continue;

    const rawDays = String(row[2] || '').trim();
    const deliveryDays = rawDays
      ? rawDays.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    const additionalRound = row[3] ? String(row[3]).trim() : undefined;
    const truckNo = String(row[4] || 'ไม่ระบุ').trim();
    const receiveType = String(row[5] || 'ปกติ').trim();
    const deliveryCondition = String(row[6] || 'รอบปกติ').trim();
    const customerGroup = String(row[7] || '').trim();
    const warningNotes = row[8] ? String(row[8]).trim() : undefined;
    const isHighBuildingNoElevator = Boolean(row[9]);
    const isECoupon = Boolean(row[10]);
    const riskDamagedBottles = Boolean(row[11]);
    const lastRoundMoveDate = row[12] ? String(row[12]).trim() : undefined;
    const couponPlan = row[13] ? String(row[13]).trim() : undefined;
    const status = String(row[14] || 'ปกติ').trim();

    // Parse GPS
    let lat = 0;
    let lng = 0;
    let hasGps = false;
    const rawGps = row[15] ? String(row[15]).trim() : '';
    if (rawGps && rawGps.includes(',')) {
      const parts = rawGps.split(',').map(p => parseFloat(p.trim()));
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        lat = parts[0];
        lng = parts[1];
        hasGps = true;
      }
    }

    const targetTime = row[16] !== undefined ? String(row[16]).trim() : undefined;
    const rawScheduleText = row[17] ? String(row[17]).trim() : '';
    const schedules = parseScheduleText(rawScheduleText);
    const address = addressColIndex !== -1 && row[addressColIndex] ? String(row[addressColIndex]).trim() : undefined;

    members.push({
      id,
      name,
      address,
      deliveryDays,
      additionalRound,
      truckNo,
      receiveType,
      deliveryCondition,
      customerGroup,
      warningNotes,
      isHighBuildingNoElevator,
      isECoupon,
      riskDamagedBottles,
      lastRoundMoveDate,
      couponPlan,
      status,
      lat,
      lng,
      hasGps,
      targetTime,
      rawScheduleText,
      schedules,
      attachments: []
    });
  }

  return members;
}
