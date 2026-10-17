import React from 'react';
import { UserRole } from '../types/delivery';
import { Truck, Building2, Droplets, MapPin, CheckCircle2 } from 'lucide-react';

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
    <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-sm transition-all">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          
          {/* Logo & App Name */}
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-brand-600 to-sky-400 flex items-center justify-center text-white shadow-md shadow-brand-500/20">
              <Droplets className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-bold text-lg text-slate-900 tracking-tight">AquaRoute</span>
                <span className="bg-brand-100 text-brand-700 text-xs font-semibold px-2 py-0.5 rounded-full">
                  ระบบจัดสายส่งน้ำ
                </span>
              </div>
              <p className="text-xs text-slate-500 hidden sm:block">
                ระบบวางแผนและติดตามสายส่งน้ำดื่มอัจฉริยะ
              </p>
            </div>
          </div>

          {/* Quick Metrics in Header */}
          <div className="hidden md:flex items-center space-x-6 text-sm">
            <div className="flex items-center space-x-1.5 text-slate-600">
              <Building2 className="w-4 h-4 text-slate-400" />
              <span>สมาชิกทั้งหมด:</span>
              <span className="font-semibold text-slate-900">{totalMembers.toLocaleString()} ราย</span>
            </div>
            <div className="flex items-center space-x-1.5 text-slate-600">
              <Truck className="w-4 h-4 text-slate-400" />
              <span>รถวิ่ง:</span>
              <span className="font-semibold text-slate-900">{activeTrucksCount} คัน</span>
            </div>
            {totalStopsCount > 0 && (
              <div className="flex items-center space-x-1.5 text-slate-600">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                <span>สถานะส่ง:</span>
                <span className="font-semibold text-emerald-600">{completedStopsCount}/{totalStopsCount} จุด</span>
              </div>
            )}
          </div>

          {/* Role Switcher Pill */}
          <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200">
            <button
              onClick={() => onRoleChange('office')}
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                currentRole === 'office'
                  ? 'bg-white text-brand-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Building2 className="w-4 h-4" />
              <span>ฝั่งออฟฟิศ</span>
            </button>
            <button
              onClick={() => onRoleChange('driver')}
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                currentRole === 'driver'
                  ? 'bg-brand-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Truck className="w-4 h-4" />
              <span>ฝั่งคนขับ</span>
            </button>
          </div>

        </div>
      </div>
    </header>
  );
};
