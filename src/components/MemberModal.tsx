import React, { useState } from 'react';
import { Member, Attachment } from '../types/delivery';
import { X, Upload, Camera, FileText, Trash2, MapPin, Save, Image as ImageIcon, AlertCircle } from 'lucide-react';
import { addAttachment, updateSingleMember } from '../services/db';

interface MemberModalProps {
  member: Member;
  onClose: () => void;
  onUpdated: (updatedMember: Member) => void;
}

export const MemberModal: React.FC<MemberModalProps> = ({
  member,
  onClose,
  onUpdated
}) => {
  const [formData, setFormData] = useState({
    name: member.name,
    truckNo: member.truckNo,
    receiveType: member.receiveType,
    deliveryCondition: member.deliveryCondition,
    lat: member.lat.toString(),
    lng: member.lng.toString(),
    targetTime: member.targetTime || '',
    warningNotes: member.warningNotes || ''
  });

  const [attachments, setAttachments] = useState<Attachment[]>(member.attachments || []);
  const [newNote, setNewNote] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    const file = files[0];
    const reader = new FileReader();

    reader.onload = async (event) => {
      const dataUrl = event.target?.result as string;
      const isImg = file.type.startsWith('image/');

      const newAtt: Attachment = {
        id: 'att_' + Date.now(),
        name: file.name,
        type: isImg ? 'image' : 'document',
        dataUrl,
        createdAt: new Date().toLocaleDateString('th-TH', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        }),
        notes: newNote.trim() || undefined
      };

      await addAttachment(member.id, newAtt);
      setAttachments(prev => [newAtt, ...prev]);
      setNewNote('');
      setIsUploading(false);
    };

    reader.readAsDataURL(file);
  };

  const handleSaveInfo = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);

    const latNum = parseFloat(formData.lat) || 0;
    const lngNum = parseFloat(formData.lng) || 0;
    const hasGps = latNum !== 0 && lngNum !== 0;

    const updated: Member = {
      ...member,
      name: formData.name,
      truckNo: formData.truckNo,
      receiveType: formData.receiveType,
      deliveryCondition: formData.deliveryCondition,
      lat: latNum,
      lng: lngNum,
      hasGps,
      targetTime: formData.targetTime,
      warningNotes: formData.warningNotes,
      attachments
    };

    await updateSingleMember(member.id, updated);
    onUpdated(updated);
    setIsSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <span className="bg-brand-500 text-white text-xs font-bold px-2.5 py-1 rounded-full">
              รหัส {member.id}
            </span>
            <h3 className="font-bold text-lg truncate max-w-sm sm:max-w-md">
              {member.name}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Tabs */}
        <div className="p-6 max-h-[80vh] overflow-y-auto space-y-6">

          {/* Form */}
          <form onSubmit={handleSaveInfo} className="space-y-4">
            <h4 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <span>ข้อมูลการจัดส่งและสมาชิก</span>
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  ชื่อ-นามสกุล / บริษัท
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  className="w-full text-sm px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  เบอร์รถประจำ
                </label>
                <input
                  type="text"
                  value={formData.truckNo}
                  onChange={e => setFormData({ ...formData, truckNo: e.target.value })}
                  className="w-full text-sm px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  ประเภทการรับน้ำ
                </label>
                <input
                  type="text"
                  value={formData.receiveType}
                  onChange={e => setFormData({ ...formData, receiveType: e.target.value })}
                  placeholder="เช่น ตั้งถังหน้าบ้าน / สมาชิกอยู่รอรับ"
                  className="w-full text-sm px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  เงื่อนไขการจัดส่ง
                </label>
                <input
                  type="text"
                  value={formData.deliveryCondition}
                  onChange={e => setFormData({ ...formData, deliveryCondition: e.target.value })}
                  className="w-full text-sm px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1 flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5 text-brand-500" />
                  <span>พิกัด GPS ละติจูด (Latitude)</span>
                </label>
                <input
                  type="text"
                  value={formData.lat}
                  onChange={e => setFormData({ ...formData, lat: e.target.value })}
                  placeholder="เช่น 13.773275"
                  className="w-full text-sm px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1 flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5 text-brand-500" />
                  <span>พิกัด GPS ลองจิจูด (Longitude)</span>
                </label>
                <input
                  type="text"
                  value={formData.lng}
                  onChange={e => setFormData({ ...formData, lng: e.target.value })}
                  placeholder="เช่น 100.799165"
                  className="w-full text-sm px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                หมายเหตุ / เฝ้าระวังการจัดส่ง
              </label>
              <textarea
                value={formData.warningNotes}
                onChange={e => setFormData({ ...formData, warningNotes: e.target.value })}
                rows={2}
                placeholder="เช่น บันไดแคบ มีสุนัขดุ ติดต่อป้อมรปภ.ก่อน"
                className="w-full text-sm px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 focus:outline-none"
              />
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={isSaving}
                className="flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-sm font-semibold shadow-md transition disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                <span>{isSaving ? 'กำลังบันทึก...' : 'บันทึกข้อมูลสมาชิก'}</span>
              </button>
            </div>
          </form>

          <hr className="border-slate-200" />

          {/* Attachments Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <ImageIcon className="w-4 h-4 text-brand-600" />
                  <span>ไฟล์แนบและรูปภาพประกอบ ({attachments.length})</span>
                </h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  รูปถ่ายหน้าบ้าน, จุดวางถังน้ำดื่ม, สลิปโอนเงิน หรือเอกสารประจำสมาชิก
                </p>
              </div>
            </div>

            {/* Upload Box */}
            <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl p-4">
              <div className="flex flex-col sm:flex-row items-center gap-3">
                <input
                  type="text"
                  value={newNote}
                  onChange={e => setNewNote(e.target.value)}
                  placeholder="คำอธิบายรูป (เช่น รูปวางถังข้างประตู)..."
                  className="flex-1 w-full text-xs px-3 py-2 border border-slate-300 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
                />

                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <label className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-4 py-2 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-medium cursor-pointer shadow-sm transition">
                    <Upload className="w-4 h-4 text-brand-600" />
                    <span>เลือกไฟล์/รูป</span>
                    <input
                      type="file"
                      onChange={handleFileUpload}
                      className="hidden"
                      accept="image/*,application/pdf"
                    />
                  </label>

                  <label className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-xs font-medium cursor-pointer shadow-sm transition">
                    <Camera className="w-4 h-4" />
                    <span>ถ่ายรูป</span>
                    <input
                      type="file"
                      capture="environment"
                      accept="image/*"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>
            </div>

            {/* Attachments Grid */}
            {attachments.length === 0 ? (
              <div className="text-center py-6 text-slate-400 text-xs">
                ยังไม่มีไฟล์หรือรูปภาพแนบสำหรับลูกค้ารายนี้
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {attachments.map((att) => (
                  <div
                    key={att.id}
                    className="relative group bg-slate-50 border border-slate-200 rounded-xl overflow-hidden p-2 flex flex-col justify-between hover:shadow-md transition"
                  >
                    {att.type === 'image' ? (
                      <div
                        onClick={() => setPreviewImage(att.dataUrl)}
                        className="w-full h-28 rounded-lg overflow-hidden cursor-pointer bg-slate-200"
                      >
                        <img
                          src={att.dataUrl}
                          alt={att.name}
                          className="w-full h-full object-cover group-hover:scale-105 transition"
                        />
                      </div>
                    ) : (
                      <div className="w-full h-28 rounded-lg bg-slate-100 flex flex-col items-center justify-center text-slate-500">
                        <FileText className="w-8 h-8 text-brand-500" />
                        <span className="text-[10px] mt-1 truncate px-2">{att.name}</span>
                      </div>
                    )}

                    <div className="mt-2 text-left">
                      <p className="text-[11px] font-semibold text-slate-800 truncate">
                        {att.notes || att.name}
                      </p>
                      <p className="text-[10px] text-slate-400">{att.createdAt}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      </div>

      {/* Image Preview Modal */}
      {previewImage && (
        <div
          className="fixed inset-0 z-60 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setPreviewImage(null)}
        >
          <div className="relative max-w-3xl max-h-[90vh]">
            <img
              src={previewImage}
              alt="Preview"
              className="max-w-full max-h-[85vh] rounded-2xl object-contain"
            />
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute -top-10 right-0 text-white font-bold text-sm bg-black/40 px-3 py-1 rounded-full"
            >
              ✕ ปิด
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
