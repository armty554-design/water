import React from 'react';
import { UserRole } from '../types/delivery';
import { AuthUser } from '../types/auth';

interface NavbarProps {
  currentUser: AuthUser;
  onLogout: () => void;
  currentRole: UserRole;
  onRoleChange: (role: UserRole) => void;
  totalMembers: number;
  activeTrucksCount: number;
  completedStopsCount: number;
  totalStopsCount: number;
  isCloudConnected?: boolean;
  onOpenFirebaseModal?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentUser,
  onLogout,
  currentRole,
  onRoleChange,
  totalMembers,
  activeTrucksCount,
  completedStopsCount,
  totalStopsCount,
  isCloudConnected = false,
  onOpenFirebaseModal
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
          <div className="hidden lg:flex items-center space-x-6 text-xs text-slate-400">
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

          {/* User Profile & Actions */}
          <div className="flex items-center space-x-2.5">
            
            {/* Cloud Status / Setup */}
            {onOpenFirebaseModal && (
              <button
                onClick={onOpenFirebaseModal}
                title={isCloudConnected ? "เชื่อมต่อ Cloud Firestore แล้ว (คลิกเพื่อดูการตั้งค่า)" : "คลิกเพื่อเชื่อมต่อเซิร์ฟเวอร์ Firebase"}
                className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg border transition ${
                  isCloudConnected 
                    ? 'bg-emerald-950/70 border-emerald-700/70 text-emerald-300 hover:bg-emerald-900/80 shadow-xs'
                    : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-500'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${isCloudConnected ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
                <span>{isCloudConnected ? 'Cloud ออนไลน์' : 'เชื่อมต่อ Cloud'}</span>
              </button>
            )}

            {/* If Admin/Office, allow view switcher */}
            {currentUser.role === 'office' && (
              <div className="flex items-center bg-slate-800 p-0.5 rounded-lg border border-slate-700">
                <button
                  onClick={() => onRoleChange('office')}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition ${
                    currentRole === 'office'
                      ? 'bg-slate-700 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  แผนกจัดส่ง
                </button>
                <button
                  onClick={() => onRoleChange('driver')}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition ${
                    currentRole === 'driver'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  มุมมองคนขับ
                </button>
              </div>
            )}

            {/* User Badge */}
            <div className="hidden sm:flex items-center text-xs text-slate-300 bg-slate-800/80 px-2.5 py-1 rounded-lg border border-slate-700">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-2"></span>
              <span className="truncate max-w-[150px] font-medium">{currentUser.name}</span>
            </div>

            {/* Logout button */}
            <button
              onClick={onLogout}
              className="text-xs text-slate-400 hover:text-white border border-slate-700 hover:border-slate-500 bg-slate-800 px-2.5 py-1 rounded-lg transition"
            >
              ออกจากระบบ
            </button>

          </div>

        </div>
      </div>
    </header>
  );
};
