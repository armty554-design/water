import React, { useState } from 'react';
import { Member, Attachment } from '../types/delivery';
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
  const [isSaving, setIsSaving] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

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
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl overflow-hidden border border-slate-200">
        
        {/* Header */}
        <div className="bg-slate-900 text-white px-5 py-3.5 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <span className="bg-slate-700 text-slate-200 text-xs font-semibold px-2 py-0.5 rounded">
              รหัส {member.id}
            </span>
            <h3 className="font-semibold text-sm truncate max-w-sm">
              {member.name}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-xs px-2 py-1 rounded"
          >
            ปิด
          </button>
        </div>

        {/* Content */}
        <div className="p-5 max-h-[80vh] overflow-y-auto space-y-5 text-xs">

          {/* Form */}
          <form onSubmit={handleSaveInfo} className="space-y-3.5">
            <div className="font-semibold text-slate-900 border-b border-slate-100 pb-1.5">
              ข้อมูลสมาชิกและการจัดส่ง
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-600 mb-1">
                  ชื่อ-นามสกุล / บริษัท
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  className="w-full text-xs px-3 py-1.5 border border-slate-300 rounded-lg focus:ring-1 focus:ring-slate-900 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-600 mb-1">
                  เบอร์รถประจำ
                </label>
                <input
                  type="text"
                  value={formData.truckNo}
                  onChange={e => setFormData({ ...formData, truckNo: e.target.value })}
                  className="w-full text-xs px-3 py-1.5 border border-slate-300 rounded-lg focus:ring-1 focus:ring-slate-900 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-600 mb-1">
                  ประเภทการรับน้ำ
                </label>
                <input
                  type="text"
                  value={formData.receiveType}
                  onChange={e => setFormData({ ...formData, receiveType: e.target.value })}
                  placeholder="เช่น ตั้งถังหน้าบ้าน"
                  className="w-full text-xs px-3 py-1.5 border border-slate-300 rounded-lg focus:ring-1 focus:ring-slate-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-600 mb-1">
                  เงื่อนไขการจัดส่ง
                </label>
                <input
                  type="text"
                  value={formData.deliveryCondition}
                  onChange={e => setFormData({ ...formData, deliveryCondition: e.target.value })}
                  className="w-full text-xs px-3 py-1.5 border border-slate-300 rounded-lg focus:ring-1 focus:ring-slate-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-600 mb-1">
                  พิกัดละติจูด (Latitude)
                </label>
                <input
                  type="text"
                  value={formData.lat}
                  onChange={e => setFormData({ ...formData, lat: e.target.value })}
                  placeholder="เช่น 13.773275"
                  className="w-full text-xs px-3 py-1.5 border border-slate-300 rounded-lg focus:ring-1 focus:ring-slate-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-600 mb-1">
                  พิกัดลองจิจูด (Longitude)
                </label>
                <input
                  type="text"
                  value={formData.lng}
                  onChange={e => setFormData({ ...formData, lng: e.target.value })}
                  placeholder="เช่น 100.799165"
                  className="w-full text-xs px-3 py-1.5 border border-slate-300 rounded-lg focus:ring-1 focus:ring-slate-900 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-slate-600 mb-1">
                หมายเหตุข้อพึงระวัง
              </label>
              <textarea
                value={formData.warningNotes}
                onChange={e => setFormData({ ...formData, warningNotes: e.target.value })}
                rows={2}
                placeholder="รายละเอียดเพิ่มเติมสำหรับการส่งน้ำ..."
                className="w-full text-xs px-3 py-1.5 border border-slate-300 rounded-lg focus:ring-1 focus:ring-slate-900 focus:outline-none"
              />
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="submit"
                disabled={isSaving}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium shadow-sm transition"
              >
                {isSaving ? 'กำลังบันทึก...' : 'บันทึกข้อมูลสมาชิก'}
              </button>
            </div>
          </form>

          <hr className="border-slate-100" />

          {/* Attachments Section */}
          <div className="space-y-3">
            <div className="font-semibold text-slate-900">
              ไฟล์แนบและรูปถ่ายประกอบ ({attachments.length})
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
              <div className="flex flex-col sm:flex-row items-center gap-2">
                <input
                  type="text"
                  value={newNote}
                  onChange={e => setNewNote(e.target.value)}
                  placeholder="คำอธิบายไฟล์แนบ..."
                  className="flex-1 w-full text-xs px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white focus:outline-none"
                />

                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <label className="flex-1 sm:flex-initial px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-medium cursor-pointer text-center">
                    <span>แนบไฟล์/รูป</span>
                    <input
                      type="file"
                      onChange={handleFileUpload}
                      className="hidden"
                      accept="image/*,application/pdf"
                    />
                  </label>

                  <label className="flex-1 sm:flex-initial px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-medium cursor-pointer text-center">
                    <span>ถ่ายภาพ</span>
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

            {attachments.length === 0 ? (
              <div className="text-center py-4 text-slate-400 text-xs">
                ไม่มีไฟล์แนบ
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {attachments.map((att) => (
                  <div
                    key={att.id}
                    className="border border-slate-200 rounded-lg overflow-hidden p-2 bg-slate-50 text-left"
                  >
                    {att.type === 'image' ? (
                      <div
                        onClick={() => setPreviewImage(att.dataUrl)}
                        className="w-full h-24 rounded bg-slate-200 cursor-pointer overflow-hidden"
                      >
                        <img
                          src={att.dataUrl}
                          alt={att.name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ) : (
                      <div className="w-full h-24 rounded bg-slate-100 flex items-center justify-center text-slate-400 text-[11px]">
                        เอกสารแนบ
                      </div>
                    )}
                    <div className="mt-1.5">
                      <div className="font-semibold text-slate-800 truncate text-[11px]">
                        {att.notes || att.name}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">{att.createdAt}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      </div>

      {previewImage && (
        <div
          className="fixed inset-0 z-60 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setPreviewImage(null)}
        >
          <div className="relative max-w-2xl max-h-[85vh]">
            <img
              src={previewImage}
              alt="Preview"
              className="max-w-full max-h-[80vh] rounded-lg object-contain"
            />
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute -top-9 right-0 text-white text-xs bg-slate-800 px-3 py-1 rounded"
            >
              ปิด
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
