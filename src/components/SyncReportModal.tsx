import React, { useState } from 'react';
import { SyncDiffReport } from '../services/memberSync';

interface SyncReportModalProps {
  report: SyncDiffReport;
  onClose: () => void;
}

export const SyncReportModal: React.FC<SyncReportModalProps> = ({
  report,
  onClose
}) => {
  const [tab, setTab] = useState<'truck' | 'gps' | 'other'>('truck');

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden border border-slate-200">
        
        {/* Header */}
        <div className="bg-slate-900 text-white px-5 py-3.5 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-sm">ผลการตรวจสอบและอัปเดตข้อมูลสมาชิก</h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              ระบบตรวจสอบความเปลี่ยนแปลงของเบอร์รถและพิกัด GPS พร้อมลบออกจากสายส่งเดิมอัตโนมัติ
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-xs px-2 py-1 rounded"
          >
            ปิด
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4 text-xs">
          
          {/* Summary Metric Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="bg-slate-50 border border-slate-200 p-2.5 rounded-lg text-center">
              <div className="text-[10px] text-slate-500">ประมวลผลทั้งหมด</div>
              <div className="text-base font-bold text-slate-900 mt-0.5">
                {report.totalProcessed.toLocaleString()}
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 p-2.5 rounded-lg text-center">
              <div className="text-[10px] text-blue-700">สมาชิกใหม่</div>
              <div className="text-base font-bold text-blue-900 mt-0.5">
                +{report.addedCount.toLocaleString()}
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 p-2.5 rounded-lg text-center">
              <div className="text-[10px] text-amber-700">ย้ายเบอร์รถ / เปลี่ยน GPS</div>
              <div className="text-base font-bold text-amber-900 mt-0.5">
                {report.updatedCount.toLocaleString()}
              </div>
            </div>

            <div className="bg-emerald-50 border border-emerald-200 p-2.5 rounded-lg text-center">
              <div className="text-[10px] text-emerald-700">ลบออกจากสายส่งเดิม</div>
              <div className="text-base font-bold text-emerald-900 mt-0.5">
                {report.cleanedRoutesCount.toLocaleString()} จุด
              </div>
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="flex border-b border-slate-200 gap-2 text-xs">
            <button
              onClick={() => setTab('truck')}
              className={`pb-2 px-1 font-semibold transition border-b-2 ${
                tab === 'truck'
                  ? 'border-slate-900 text-slate-900'
                  : 'border-transparent text-slate-400 hover:text-slate-600'
              }`}
            >
              รายการย้ายเบอร์รถ ({report.truckChanges.length})
            </button>
            <button
              onClick={() => setTab('gps')}
              className={`pb-2 px-1 font-semibold transition border-b-2 ${
                tab === 'gps'
                  ? 'border-slate-900 text-slate-900'
                  : 'border-transparent text-slate-400 hover:text-slate-600'
              }`}
            >
              รายการเปลี่ยนพิกัด GPS ({report.gpsChanges.length})
            </button>
            <button
              onClick={() => setTab('other')}
              className={`pb-2 px-1 font-semibold transition border-b-2 ${
                tab === 'other'
                  ? 'border-slate-900 text-slate-900'
                  : 'border-transparent text-slate-400 hover:text-slate-600'
              }`}
            >
              เปลี่ยนรอบ/เงื่อนไข ({report.otherChanges.length})
            </button>
          </div>

          {/* Tab Content List */}
          <div className="max-h-[300px] overflow-y-auto space-y-1.5 border border-slate-200 rounded-xl p-2 bg-slate-50">
            {tab === 'truck' && (
              report.truckChanges.length === 0 ? (
                <div className="py-8 text-center text-slate-400">
                  ไม่พบสมาชิกที่เปลี่ยนแปลงเบอร์รถ
                </div>
              ) : (
                report.truckChanges.map((tc, idx) => (
                  <div
                    key={tc.memberId + '_' + idx}
                    className="p-2.5 bg-white rounded-lg border border-slate-200 flex items-center justify-between text-xs"
                  >
                    <div>
                      <div className="font-semibold text-slate-900">{tc.name}</div>
                      <div className="text-slate-400 text-[10px]">รหัส: #{tc.memberId}</div>
                    </div>
                    <div className="text-right">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500 line-through">รถ {tc.oldTruck}</span>
                        <span className="text-slate-400">→</span>
                        <span className="font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                          รถ {tc.newTruck}
                        </span>
                      </div>
                      <div className="text-[10px] text-emerald-600 mt-0.5">
                        ✓ ลบออกจากสายรถเดิมแล้ว
                      </div>
                    </div>
                  </div>
                ))
              )
            )}

            {tab === 'gps' && (
              report.gpsChanges.length === 0 ? (
                <div className="py-8 text-center text-slate-400">
                  ไม่พบสมาชิกที่เปลี่ยนแปลงพิกัด GPS
                </div>
              ) : (
                report.gpsChanges.map((gc, idx) => (
                  <div
                    key={gc.memberId + '_' + idx}
                    className="p-2.5 bg-white rounded-lg border border-slate-200 flex items-center justify-between text-xs"
                  >
                    <div>
                      <div className="font-semibold text-slate-900">{gc.name}</div>
                      <div className="text-slate-400 text-[10px]">รหัส: #{gc.memberId}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-slate-500 text-[11px] line-through">{gc.oldGps}</div>
                      <div className="font-semibold text-emerald-700 text-[11px] mt-0.5">
                        ใหม่: {gc.newGps}
                      </div>
                    </div>
                  </div>
                ))
              )
            )}

            {tab === 'other' && (
              report.otherChanges.length === 0 ? (
                <div className="py-8 text-center text-slate-400">
                  ไม่พบการเปลี่ยนแปลงรอบส่งหรือเงื่อนไข
                </div>
              ) : (
                report.otherChanges.map((oc, idx) => (
                  <div
                    key={oc.memberId + '_' + idx}
                    className="p-2.5 bg-white rounded-lg border border-slate-200 flex items-center justify-between text-xs"
                  >
                    <div>
                      <div className="font-semibold text-slate-900">{oc.name}</div>
                      <div className="text-slate-400 text-[10px]">รหัส: #{oc.memberId} ({oc.field})</div>
                    </div>
                    <div className="text-right text-[11px]">
                      <span className="text-slate-400 line-through mr-1">{oc.oldValue || '(ว่าง)'}</span>
                      <span className="font-semibold text-slate-800">→ {oc.newValue}</span>
                    </div>
                  </div>
                ))
              )
            )}
          </div>

          <div className="flex justify-end pt-2">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold shadow-sm transition"
            >
              รับทราบผลการตรวจสอบ
            </button>
          </div>

        </div>

      </div>
    </div>
  );
};
