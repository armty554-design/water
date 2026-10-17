import React from 'react';
import { UserRole } from '../types/delivery';

interface NavbarProps {
  currentRole: UserRole;
  onRoleChange: (role: UserRole) => void;
  totalMembers: number;
  activeTrucksCount: number;
  completedStopsCount: number;
  totalStopsCount: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentRole,
  onRoleChange,
  totalMembers,
  activeTrucksCount,
  completedStopsCount,
  totalStopsCount
}) => {
  return (
    <header className="sticky top-0 z-50 bg-slate-900 border-b border-slate-800 text-white shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          
          {/* Brand */}
          <div className="flex items-center space-x-3">
            <span className="font-semibold text-base tracking-tight text-white">AquaRoute</span>
            <span className="text-slate-600">|</span>
            <span className="text-xs font-normal text-slate-300 hidden sm:inline">
              ระบบบริหารจัดการสายส่งน้ำดื่ม
            </span>
          </div>

          {/* Metrics summary */}
          <div className="hidden md:flex items-center space-x-6 text-xs text-slate-400">
            <div>
              <span>สมาชิกในระบบ: </span>
              <span className="font-medium text-slate-200">{totalMembers.toLocaleString()}</span>
            </div>
            <div>
              <span>จำนวนสายรถ: </span>
              <span className="font-medium text-slate-200">{activeTrucksCount} คัน</span>
            </div>
            {totalStopsCount > 0 && (
              <div>
                <span>ความคืบหน้าจัดส่ง: </span>
                <span className="font-medium text-emerald-400">
                  {completedStopsCount}/{totalStopsCount} รายการ
                </span>
              </div>
            )}
          </div>

          {/* Professional Tab Switcher */}
          <div className="flex items-center bg-slate-800 p-1 rounded-lg border border-slate-700">
            <button
              onClick={() => onRoleChange('office')}
              className={`px-3 py-1 rounded text-xs font-medium transition ${
                currentRole === 'office'
                  ? 'bg-slate-700 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              แผนกจัดส่ง (Dispatch)
            </button>
            <button
              onClick={() => onRoleChange('driver')}
              className={`px-3 py-1 rounded text-xs font-medium transition ${
                currentRole === 'driver'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              พนักงานส่งน้ำ (Driver)
            </button>
          </div>

        </div>
      </div>
    </header>
  );
};
