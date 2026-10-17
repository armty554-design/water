import React, { useState } from 'react';
import { AuthUser } from '../types/auth';
import { loginOffice, loginDriver } from '../services/auth';
import { TruckSelector } from './TruckSelector';

interface LoginViewProps {
  onLoginSuccess: (user: AuthUser) => void;
  availableTrucks: { truckNo: string; count: number }[];
}

export const LoginView: React.FC<LoginViewProps> = ({
  onLoginSuccess,
  availableTrucks
}) => {
  const [tab, setTab] = useState<'office' | 'driver'>('office');

  // Office form state
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin123');

  // Driver form state
  const defaultTruck = availableTrucks[0]?.truckNo || '13106';
  const [truckNo, setTruckNo] = useState(defaultTruck);
  const [driverPin, setDriverPin] = useState('1234');

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleOfficeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setIsSubmitting(true);

    const res = loginOffice(username, password);
    if (res.success && res.user) {
      onLoginSuccess(res.user);
    } else {
      setErrorMsg(res.error || 'เข้าสู่ระบบไม่สำเร็จ');
      setIsSubmitting(false);
    }
  };

  const handleDriverSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setIsSubmitting(true);

    const res = loginDriver(truckNo, driverPin);
    if (res.success && res.user) {
      onLoginSuccess(res.user);
    } else {
      setErrorMsg(res.error || 'เข้าสู่ระบบไม่สำเร็จ');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col justify-center py-12 sm:px-6 lg:px-8 selection:bg-blue-600 selection:text-white">
      
      {/* Brand Header */}
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">AquaRoute</h2>
        <p className="mt-1 text-xs text-slate-500">ระบบบริหารจัดการและติดตามสายส่งน้ำดื่ม</p>
      </div>

      {/* Main Login Card */}
      <div className="mt-6 sm:mx-auto sm:w-full sm:max-w-md px-4">
        <div className="bg-white py-6 px-6 shadow-sm border border-slate-200 rounded-xl sm:px-8">
          
          {/* Role Tabs */}
          <div className="flex border-b border-slate-200 mb-5 text-xs font-semibold">
            <button
              onClick={() => { setTab('office'); setErrorMsg(null); }}
              className={`flex-1 pb-2.5 text-center transition border-b-2 ${
                tab === 'office'
                  ? 'border-slate-900 text-slate-900'
                  : 'border-transparent text-slate-400 hover:text-slate-600'
              }`}
            >
              แผนกจัดส่ง (Office)
            </button>
            <button
              onClick={() => { setTab('driver'); setErrorMsg(null); }}
              className={`flex-1 pb-2.5 text-center transition border-b-2 ${
                tab === 'driver'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-400 hover:text-slate-600'
              }`}
            >
              พนักงานส่งน้ำ (Driver)
            </button>
          </div>

          {errorMsg && (
            <div className="mb-4 p-2.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg">
              {errorMsg}
            </div>
          )}

          {/* Form: Office */}
          {tab === 'office' && (
            <form onSubmit={handleOfficeSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-700 font-medium mb-1">
                  ชื่อผู้ใช้ (Username)
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="admin"
                  required
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-1 focus:ring-slate-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-medium mb-1">
                  รหัสผ่าน (Password)
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-1 focus:ring-slate-900 focus:outline-none"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-medium text-xs shadow-sm transition disabled:opacity-50"
                >
                  {isSubmitting ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบส่วนงานจัดส่ง'}
                </button>
              </div>

              <div className="mt-3 text-[11px] text-slate-400 bg-slate-50 p-2 rounded border border-slate-100 text-center">
                บัญชีทดสอบ: <strong>admin</strong> | รหัสผ่าน: <strong>admin123</strong>
              </div>
            </form>
          )}

          {/* Form: Driver */}
          {tab === 'driver' && (
            <form onSubmit={handleDriverSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-700 font-medium mb-1">
                  เลือกรหัสสายรถประจำ
                </label>
                <TruckSelector
                  value={truckNo}
                  onChange={setTruckNo}
                  availableTrucks={availableTrucks}
                  fullWidth={true}
                />
              </div>

              <div>
                <label className="block text-slate-700 font-medium mb-1">
                  รหัส PIN ประจำตัว (4 หลัก)
                </label>
                <input
                  type="password"
                  value={driverPin}
                  onChange={e => setDriverPin(e.target.value)}
                  placeholder="1234"
                  maxLength={6}
                  required
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono text-center tracking-widest focus:ring-1 focus:ring-blue-600 focus:outline-none"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium text-xs shadow-sm transition disabled:opacity-50"
                >
                  {isSubmitting ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่หน้างานส่งน้ำ'}
                </button>
              </div>

              <div className="mt-3 text-[11px] text-slate-400 bg-slate-50 p-2 rounded border border-slate-100 text-center">
                รหัส PIN เริ่มต้นของคนขับ: <strong>1234</strong>
              </div>
            </form>
          )}

        </div>
      </div>

    </div>
  );
};
