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

  const headerRow: any[] = rows[headerIndex] || [];
  const findCol = (keywords: string[], fallback: number): number => {
    const idx = headerRow.findIndex(cell => 
      typeof cell === 'string' && keywords.some(k => cell.includes(k) || cell.toLowerCase().includes(k.toLowerCase()))
    );
    return idx !== -1 ? idx : fallback;
  };

  // Dynamically detect column indices to support both new and old Excel formats
  const colId = findCol(['รหัสสมาชิก', 'id'], 0);
  const colName = findCol(['ชื่อ-นามสกุล', 'ชื่อ', 'name'], 1);
  const colAddress = findCol(['ที่อยู่จัดส่ง', 'ที่อยู่', 'address'], -1);
  const colDays = findCol(['รอบส่งประจำสัปดาห์', 'รอบส่ง'], 2);
  const colAddRound = findCol(['รอบเสริม'], 3);
  const colTruck = findCol(['เบอร์รถ', 'สายรถ', 'truck'], 4);
  const colReceive = findCol(['ประเภทการรับน้ำ', 'รับน้ำ'], 5);
  const colCondition = findCol(['เงื่อนไขการจัดส่ง', 'เงื่อนไข'], 6);
  const colGroup = findCol(['กลุ่มลูกค้า'], 7);
  const colWarning = findCol(['เฝ้าระวัง'], 8);
  const colHighBuilding = findCol(['อาคารสูง'], 9);
  const colECoupon = findCol(['อี-คูปอง', 'e-coupon'], 10);
  const colRiskDamaged = findCol(['ถังน้ำดื่มเสียหาย'], 11);
  const colLastMove = findCol(['ย้ายรอบส่ง'], 12);
  const colCouponPlan = findCol(['แผนการเติมคูปอง'], 13);
  const colStatus = findCol(['สถานะลูกค้า', 'สถานะ'], 14);
  const colGps = findCol(['พิกัด GPS', 'GPS'], 15);
  const colSchedule = findCol(['ยอดส่งเฉลี่ย', 'เวลาส่งเฉลี่ย', 'avg', '4รอบ'], 17);

  // Check if there is a separate target time column
  const colTargetTime = headerRow.findIndex((cell, idx) => 
    idx !== colSchedule && typeof cell === 'string' && cell.trim() === 'เวลา'
  );

  const members: Member[] = [];

  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[colId]) continue;

    const id = String(row[colId]).trim();
    const name = String(row[colName] || '').trim();
    if (!id || !name) continue;

    const rawDays = colDays !== -1 && row[colDays] ? String(row[colDays]).trim() : '';
    const deliveryDays = rawDays
      ? rawDays.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    const additionalRound = colAddRound !== -1 && row[colAddRound] ? String(row[colAddRound]).trim() : undefined;
    const truckNo = colTruck !== -1 && row[colTruck] ? String(row[colTruck]).trim() : 'ไม่ระบุ';
    const receiveType = colReceive !== -1 && row[colReceive] ? String(row[colReceive]).trim() : 'ปกติ';
    const deliveryCondition = colCondition !== -1 && row[colCondition] ? String(row[colCondition]).trim() : 'รอบปกติ';
    const customerGroup = colGroup !== -1 && row[colGroup] ? String(row[colGroup]).trim() : '';
    const warningNotes = colWarning !== -1 && row[colWarning] ? String(row[colWarning]).trim() : undefined;
    const isHighBuildingNoElevator = colHighBuilding !== -1 ? Boolean(row[colHighBuilding]) : false;
    const isECoupon = colECoupon !== -1 ? Boolean(row[colECoupon]) : false;
    const riskDamagedBottles = colRiskDamaged !== -1 ? Boolean(row[colRiskDamaged]) : false;
    const lastRoundMoveDate = colLastMove !== -1 && row[colLastMove] ? String(row[colLastMove]).trim() : undefined;
    const couponPlan = colCouponPlan !== -1 && row[colCouponPlan] ? String(row[colCouponPlan]).trim() : undefined;
    const status = colStatus !== -1 && row[colStatus] ? String(row[colStatus]).trim() : 'ปกติ';

    // Parse GPS
    let lat = 0;
    let lng = 0;
    let hasGps = false;
    const rawGps = colGps !== -1 && row[colGps] ? String(row[colGps]).trim() : '';
    if (rawGps && rawGps.includes(',')) {
      const parts = rawGps.split(',').map(p => parseFloat(p.trim()));
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        lat = parts[0];
        lng = parts[1];
        hasGps = true;
      }
    }

    const targetTime = colTargetTime !== -1 && row[colTargetTime] !== undefined 
      ? String(row[colTargetTime]).trim() 
      : undefined;

    const rawScheduleText = colSchedule !== -1 && row[colSchedule] ? String(row[colSchedule]).trim() : '';
    const schedules = parseScheduleText(rawScheduleText);
    const address = colAddress !== -1 && row[colAddress] ? String(row[colAddress]).trim() : undefined;

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
