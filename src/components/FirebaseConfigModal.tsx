import React, { useState } from 'react';
import { 
  getFirebaseConfig, saveFirebaseConfig, clearFirebaseConfig, 
  isFirebaseConfigured, FirebaseConfig, saveMembersToCloud 
} from '../services/firebase';
import { Member } from '../types/delivery';

interface FirebaseConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  members: Member[];
  onConfigUpdated: () => void;
}

export const FirebaseConfigModal: React.FC<FirebaseConfigModalProps> = ({
  isOpen,
  onClose,
  members,
  onConfigUpdated
}) => {
  const currentConfig = getFirebaseConfig();
  const [rawInput, setRawInput] = useState('');
  const [apiKey, setApiKey] = useState(currentConfig?.apiKey || '');
  const [projectId, setProjectId] = useState(currentConfig?.projectId || '');
  const [authDomain, setAuthDomain] = useState(currentConfig?.authDomain || '');
  const [storageBucket, setStorageBucket] = useState(currentConfig?.storageBucket || '');
  const [messagingSenderId, setMessagingSenderId] = useState(currentConfig?.messagingSenderId || '');
  const [appId, setAppId] = useState(currentConfig?.appId || '');

  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  if (!isOpen) return null;

  // Auto-parse when pasting firebaseConfig object or JSON
  const handlePasteRaw = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setRawInput(text);

    try {
      // 1. Try regex extraction from js snippet
      const extract = (key: string) => {
        const match = text.match(new RegExp(`${key}\\s*:\\s*["']([^"']+)["']`));
        return match ? match[1] : '';
      };

      const extractedApiKey = extract('apiKey');
      const extractedProjectId = extract('projectId');
      const extractedAuthDomain = extract('authDomain');
      const extractedStorageBucket = extract('storageBucket');
      const extractedSenderId = extract('messagingSenderId');
      const extractedAppId = extract('appId');

      if (extractedApiKey && extractedProjectId) {
        setApiKey(extractedApiKey);
        setProjectId(extractedProjectId);
        if (extractedAuthDomain) setAuthDomain(extractedAuthDomain);
        if (extractedStorageBucket) setStorageBucket(extractedStorageBucket);
        if (extractedSenderId) setMessagingSenderId(extractedSenderId);
        if (extractedAppId) setAppId(extractedAppId);
        setStatusMsg({ type: 'success', text: 'ตรวจพบการตั้งค่าจากโค้ดที่วางเรียบร้อยแล้ว' });
        return;
      }

      // 2. Try JSON.parse
      const json = JSON.parse(text);
      if (json.apiKey && json.projectId) {
        setApiKey(json.apiKey);
        setProjectId(json.projectId);
        setAuthDomain(json.authDomain || '');
        setStorageBucket(json.storageBucket || '');
        setMessagingSenderId(json.messagingSenderId || '');
        setAppId(json.appId || '');
        setStatusMsg({ type: 'success', text: 'นำเข้าข้อมูล JSON สำเร็จ' });
      }
    } catch {
      // not full json yet, ignore
    }
  };

  const handleSave = () => {
    if (!apiKey.trim() || !projectId.trim()) {
      setStatusMsg({ type: 'error', text: 'กรุณาระบุอย่างน้อย API Key และ Project ID' });
      return;
    }

    const config: FirebaseConfig = {
      apiKey: apiKey.trim(),
      projectId: projectId.trim(),
      authDomain: authDomain.trim() || `${projectId.trim()}.firebaseapp.com`,
      storageBucket: storageBucket.trim() || `${projectId.trim()}.appspot.com`,
      messagingSenderId: messagingSenderId.trim(),
      appId: appId.trim()
    };

    saveFirebaseConfig(config);
    setStatusMsg({ type: 'success', text: 'บันทึกการเชื่อมต่อ Cloud Firestore เรียบร้อยแล้ว!' });
    onConfigUpdated();
  };

  const handleClear = () => {
    if (confirm('คุณต้องการตัดการเชื่อมต่อ Firebase และกลับไปใช้โหมดออฟไลน์ใช่หรือไม่?')) {
      clearFirebaseConfig();
      setApiKey('');
      setProjectId('');
      setAuthDomain('');
      setStorageBucket('');
      setMessagingSenderId('');
      setAppId('');
      setRawInput('');
      setStatusMsg({ type: 'success', text: 'ตัดการเชื่อมต่อเรียบร้อยแล้ว (กลับสู่โหมดออฟไลน์)' });
      onConfigUpdated();
    }
  };

  const handleSyncAllMembers = async () => {
    if (!isFirebaseConfigured()) {
      setStatusMsg({ type: 'error', text: 'กรุณาบันทึกการเชื่อมต่อ Firebase ก่อนทำการซิงค์' });
      return;
    }
    if (members.length === 0) {
      setStatusMsg({ type: 'error', text: 'ไม่มีข้อมูลสมาชิกในระบบสำหรับอัปโหลด' });
      return;
    }

    setIsSyncing(true);
    setStatusMsg(null);
    try {
      await saveMembersToCloud(members);
      setStatusMsg({ 
        type: 'success', 
        text: `อัปโหลดข้อมูลสมาชิก ${members.length.toLocaleString()} รายชื่อขึ้น Cloud Firestore เรียบร้อยแล้ว! มือถือคนขับสามารถดึงข้อมูลได้ทันที` 
      });
    } catch (err: any) {
      console.error(err);
      setStatusMsg({ type: 'error', text: `ซิงค์ไม่สำเร็จ: ${err.message || 'เกิดข้อผิดพลาดในการเชื่อมต่อ'}` });
    } finally {
      setIsSyncing(false);
    }
  };

  const isConnected = isFirebaseConfigured();

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              ตั้งค่าฐานข้อมูลเซิร์ฟเวอร์กลาง (Firebase Cloud Firestore)
            </h3>
            <p className="text-[11px] text-slate-500">
              เชื่อมต่อ Cloud เพื่อให้คอมพิวเตอร์ Office และมือถือคนขับซิงค์งานกันแบบ Real-time
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 text-lg font-bold p-1 leading-none"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs">
          
          {/* Status Indicator */}
          <div className={`p-3 rounded-lg border flex items-center justify-between ${
            isConnected 
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900' 
              : 'bg-amber-50 border-amber-200 text-amber-900'
          }`}>
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-emerald-600 animate-pulse' : 'bg-amber-500'}`} />
              <span className="font-semibold text-xs">
                สถานะ: {isConnected ? `เชื่อมต่อ Cloud Firestore (${projectId || 'ออนไลน์'})` : 'โหมดบันทึกในเครื่อง (ยังไม่ได้เชื่อมต่อเซิร์ฟเวอร์)'}
              </span>
            </div>
            {isConnected && (
              <button
                onClick={handleClear}
                className="text-[11px] text-red-600 hover:underline font-medium"
              >
                ตัดการเชื่อมต่อ
              </button>
            )}
          </div>

          {statusMsg && (
            <div className={`p-2.5 rounded-lg text-xs border ${
              statusMsg.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'
            }`}>
              {statusMsg.text}
            </div>
          )}

          {/* Quick Paste Code Box */}
          <div className="space-y-1.5">
            <label className="block font-semibold text-slate-700 text-xs">
              วางโค้ดตั้งค่า Firebase จาก Firebase Console (Quick Paste)
            </label>
            <textarea
              rows={3}
              value={rawInput}
              onChange={handlePasteRaw}
              placeholder={'คัดลอก const firebaseConfig = { apiKey: "...", ... } มาวางที่นี่ได้ทันที'}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono focus:ring-1 focus:ring-slate-900 focus:outline-none"
            />
          </div>

          {/* Detailed Inputs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Project ID *</label>
              <input
                type="text"
                value={projectId}
                onChange={e => setProjectId(e.target.value)}
                placeholder="water-delivery-app"
                className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs focus:ring-1 focus:ring-slate-900 focus:outline-none"
              />
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1">API Key *</label>
              <input
                type="text"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="AIzaSy..."
                className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs focus:ring-1 focus:ring-slate-900 focus:outline-none"
              />
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1">Auth Domain</label>
              <input
                type="text"
                value={authDomain}
                onChange={e => setAuthDomain(e.target.value)}
                placeholder="project.firebaseapp.com"
                className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs focus:ring-1 focus:ring-slate-900 focus:outline-none"
              />
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1">App ID</label>
              <input
                type="text"
                value={appId}
                onChange={e => setAppId(e.target.value)}
                placeholder="1:123456:web:abcd"
                className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs focus:ring-1 focus:ring-slate-900 focus:outline-none"
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 pt-2">
            <button
              onClick={handleSave}
              className="flex-1 py-2 px-4 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-lg text-xs shadow-sm transition"
            >
              บันทึกการเชื่อมต่อ Cloud
            </button>
            {isConnected && (
              <button
                onClick={handleSyncAllMembers}
                disabled={isSyncing}
                className="py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg text-xs shadow-sm transition disabled:opacity-50"
              >
                {isSyncing ? 'กำลังซิงค์...' : `อัปโหลดสมาชิกขึ้น Cloud (${members.length.toLocaleString()} ราย)`}
              </button>
            )}
          </div>

          {/* Instructions Box */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-[11px] text-slate-600 space-y-1.5 leading-relaxed">
            <p className="font-bold text-slate-800">วิธีเปิดใช้งาน Firebase ฟรี (ทำเพียงครั้งเดียว):</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>เข้าเว็บ <a href="https://console.firebase.google.com" target="_blank" rel="noreferrer" className="text-blue-600 underline">console.firebase.google.com</a> แล้วกด <strong>"Add project"</strong></li>
              <li>ไปที่เมนู <strong>Build &gt; Firestore Database</strong> กด <strong>Create database</strong> (เลือก Start in test mode)</li>
              <li>ไปที่ <strong>Project settings</strong> (ไอคอนฟันเฟือง) &gt; เลื่อนลงมาที่ <strong>Your apps</strong> กดไอคอนเว็บ <strong>&lt;/&gt;</strong></li>
              <li>คัดลอกโค้ด <code className="bg-slate-200 px-1 py-0.5 rounded">firebaseConfig</code> มาวางในช่อง Quick Paste ด้านบน แล้วกดบันทึก</li>
            </ol>
          </div>

        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end">
          <button
            onClick={onClose}
            className="py-1.5 px-4 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 font-medium rounded-lg text-xs transition"
          >
            ปิดหน้าต่าง
          </button>
        </div>

      </div>
    </div>
  );
};
