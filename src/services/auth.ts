import { AuthUser, LoginResponse } from '../types/auth';

const SESSION_KEY = 'water_auth_session';

export function getCurrentUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

export function saveSession(user: AuthUser): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(user));
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

export function loginOffice(username: string, password: string): LoginResponse {
  const u = username.trim().toLowerCase();
  const p = password.trim();

  if ((u === 'admin' && p === 'admin123') || (u === 'office' && p === '1234')) {
    const user: AuthUser = {
      id: 'usr_' + u,
      username: u,
      name: u === 'admin' ? 'ผู้ดูแลระบบ (Admin)' : 'เจ้าหน้าที่จัดส่ง (Office)',
      role: 'office'
    };
    saveSession(user);
    return { success: true, user };
  }

  return {
    success: false,
    error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง (ทดสอบ: admin / admin123)'
  };
}

export function loginDriver(truckNo: string, pin: string): LoginResponse {
  const t = truckNo.trim();
  const p = pin.trim();

  if (!t) {
    return { success: false, error: 'กรุณาระบุสายรถ' };
  }

  // Driver PIN can be 1234, or the truckNo itself, or any 4 digit pin for flexibility
  if (p === '1234' || p === t || p.length >= 4) {
    const user: AuthUser = {
      id: 'driver_' + t,
      username: 'driver_' + t,
      name: `พนักงานขับรถ สาย ${t}`,
      role: 'driver',
      assignedTruck: t
    };
    saveSession(user);
    return { success: true, user };
  }

  return {
    success: false,
    error: 'รหัส PIN ไม่ถูกต้อง (ค่าเริ่มต้น: 1234)'
  };
}
