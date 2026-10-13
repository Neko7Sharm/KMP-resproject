'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import {
  Settings, KeyRound, CheckCircle2, AlertCircle, ExternalLink,
  Eye, EyeOff, Save, RefreshCw, Loader2, Info, Database, ChevronRight,
  Users, UserCheck, Trash2
} from 'lucide-react';

export default function SettingsPage() {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [keyPreview, setKeyPreview] = useState<string | null>(null);
  const [keysList, setKeysList] = useState<string[]>([]);
  const [hasKey, setHasKey] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{type: 'success'|'error'|'info', text: string} | null>(null);

  useEffect(() => { fetchStatus(); }, []);

  async function fetchStatus() {
    setIsLoading(true);
    try {
      const res = await fetch('/api/settings/apikey');
      const data = await res.json();
      setHasKey(data.hasApiKey);
      setKeyPreview(data.preview || null);
      setKeysList(data.keys || []);
    } catch (e) {}
    finally { setIsLoading(false); }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!apiKey.trim()) {
      setMessage({ type: 'error', text: 'กรุณาระบุ API Key ก่อนบันทึก' });
      return;
    }
    setIsSaving(true); setMessage(null);
    try {
      const res = await fetch('/api/settings/apikey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setMessage({ type: 'error', text: data.error }); return; }
      setMessage({ type: 'success', text: data.message });
      setKeyPreview(data.preview);
      setHasKey(true);
      setApiKey('');
      fetchStatus();
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteKey(specificKey?: string) {
    if (!window.confirm(specificKey ? `ต้องการลบ API Key ${specificKey} ใช่หรือไม่?` : 'ต้องการลบ API Key สำรองทั้งหมดในระบบใช่หรือไม่?')) return;
    try {
      const res = await fetch('/api/settings/apikey', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: specificKey }),
      });
      if (res.ok) {
        fetchStatus();
        setMessage({ type: 'info', text: specificKey ? `ลบ ${specificKey} เรียบร้อยแล้ว` : 'ลบคีย์สำรองทั้งหมดเรียบร้อยแล้ว' });
      }
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message });
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Settings className="w-6 h-6 text-slate-600" />
          ตั้งค่าระบบ
        </h1>
        <p className="text-sm text-slate-500 mt-1">กำหนดค่าการเชื่อมต่อ AI, จัดการบัญชีผู้ใช้ และส่วนต่างๆ ของระบบ</p>
      </div>

      {/* User Accounts Management Card */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-purple-100 flex items-center justify-center">
              <Users className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <h2 className="font-bold text-slate-900 text-sm">จัดการผู้ใช้งานและสิทธิ์ (Accounts & RBAC)</h2>
              <p className="text-xs text-slate-500">สร้างบัญชีพนักงาน กำหนดตำแหน่ง และรีเซ็ตรหัสผ่าน</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-purple-100 text-purple-700 rounded-full text-xs font-semibold">
            <UserCheck className="w-3.5 h-3.5" />สิทธิ์แอดมิน
          </span>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-xs text-slate-600 leading-relaxed">
            ระบบจำกัดสิทธิ์ตาม 4 ตำแหน่งหลัก: <strong>แอดมิน</strong>, <strong>คลัง</strong>, <strong>ผลิต</strong>, และ <strong>ดูข้อมูล</strong> 
            เพื่อความปลอดภัยของข้อมูล และบันทึกประวัติการเปลี่ยนแปลง (Audit Logs) ตามบุคคลจริง
          </p>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
            <Link
              href="/settings/users"
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white rounded-xl text-xs font-bold shadow-md shadow-purple-200 transition"
            >
              <Users className="w-4 h-4" />
              <span>เปิดหน้าระบบจัดการผู้ใช้งาน</span>
              <ChevronRight className="w-3.5 h-3.5 text-purple-200" />
            </Link>

            <span className="text-[11px] font-mono text-slate-500 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
              URL: /settings/users
            </span>
          </div>
        </div>
      </div>

      {/* Gemini API Key Card */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-purple-100 flex items-center justify-center">
            <KeyRound className="w-5 h-5 text-purple-600" />
          </div>
          <div>
            <h2 className="font-bold text-slate-900 text-sm">Gemini AI API Key</h2>
            <p className="text-xs text-slate-500">สำหรับระบบสแกนและวิเคราะห์ภาพ Stock Card ด้วย AI</p>
          </div>
          <div className="ml-auto">
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
            ) : hasKey ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-semibold">
                <CheckCircle2 className="w-3.5 h-3.5" />ตั้งค่าแล้ว
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-100 text-amber-700 rounded-full text-xs font-semibold">
                <AlertCircle className="w-3.5 h-3.5" />ยังไม่ได้ตั้งค่า
              </span>
            )}
          </div>
        </div>

        <div className="p-6 space-y-5">
          {/* รายการ API Key สำรองในระบบ */}
          {keysList.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                <span>🔑 คลัง API Key สำรองในระบบ ({keysList.length} คีย์):</span>
                <button
                  type="button"
                  onClick={() => handleDeleteKey()}
                  className="text-rose-600 hover:text-rose-700 text-[11px] underline font-medium cursor-pointer"
                >
                  ลบทั้งหมด
                </button>
              </div>
              <div className="space-y-1.5">
                {keysList.map((k, idx) => (
                  <div
                    key={idx}
                    className="p-2.5 bg-purple-50/70 border border-purple-100 rounded-xl flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-purple-200 text-purple-800 text-[10px] font-bold flex items-center justify-center">
                        {idx + 1}
                      </span>
                      <code className="font-mono font-bold text-purple-950">{k}</code>
                      {idx === keysList.length - 1 && (
                        <span className="text-[10px] bg-purple-200/80 text-purple-800 px-1.5 py-0.5 rounded font-medium">
                          ล่าสุด (เรียกก่อน)
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteKey(k)}
                      title="ลบคีย์นี้"
                      className="text-slate-400 hover:text-rose-600 p-1 transition cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* How to get key */}
          <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl">
            <p className="text-xs font-semibold text-blue-800 mb-2 flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5" />
              วิธีสร้าง API Key (ฟรี):
            </p>
            <ol className="text-xs text-blue-700 space-y-1 list-decimal list-inside">
              <li>ไปที่ <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="underline font-semibold inline-flex items-center gap-0.5">Google AI Studio <ExternalLink className="w-3 h-3" /></a></li>
              <li>กด <strong>"Create API key"</strong> แล้วเลือก Project</li>
              <li>คัดลอก Key มาวางในช่องด้านล่างแล้วกด <strong>เพิ่ม API Key สำรอง</strong> (ระบบจะเพิ่มต่อท้าย ไม่ลบคีย์เดิม)</li>
              <li>ใช้งานได้ทันที ไม่ต้องเริ่มเซิร์ฟเวอร์ใหม่</li>
            </ol>
          </div>

          {/* Input form */}
          <form onSubmit={handleSave} className="space-y-3">
            <label className="block text-xs font-semibold text-slate-700">
              เพิ่ม Gemini API Key สำรอง (เพิ่มต่อท้าย ไม่ทับอันเดิม)
            </label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                placeholder="AIzaSy..."
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                className="w-full px-3 py-2.5 pr-10 text-sm font-mono border border-slate-200 rounded-xl focus:ring-2 focus:ring-purple-500 outline-none"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {message && (
              <div className={`p-3 rounded-xl text-xs flex items-start gap-2 ${
                message.type === 'success' ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                : message.type === 'error' ? 'bg-rose-50 border border-rose-200 text-rose-800'
                : 'bg-blue-50 border border-blue-200 text-blue-800'
              }`}>
                {message.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />}
                {message.text}
              </div>
            )}

            <button
              type="submit"
              disabled={isSaving || !apiKey.trim()}
              className="w-full py-2.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition cursor-pointer shadow-xs"
            >
              {isSaving ? <><Loader2 className="w-4 h-4 animate-spin" />กำลังตรวจสอบและบันทึก...</> : <><Save className="w-4 h-4" />เพิ่มเป็น API Key สำรอง</>}
            </button>
          </form>

          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-500 flex items-start gap-2">
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-400" />
            <span>
              ระบบจะใช้ <strong>API ของระบบ (Environment Variables)</strong> ก่อนเสมอ หากไม่มีหรือหมดโควตา จึงใช้ key กลางนี้แทน
              key ที่ใส่ที่นี่ถูกเก็บในฐานข้อมูลและ <strong>ใช้ร่วมกันทุกคน</strong> ที่ใช้งานเว็บนี้ (ไม่ถูกส่งเข้า Git)
            </span>
          </div>
        </div>
      </div>

      {/* DB Studio Management Card */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-100 flex items-center justify-center">
              <Database className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="font-bold text-slate-900 text-sm">DB Studio (จัดการและแก้ไขฐานข้อมูล)</h2>
              <p className="text-xs text-slate-500">สำหรับผู้ดูแลระบบ: ตรวจสอบ แก้ไขข้อมูล และสำรองข้อมูลทุกตาราง</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-semibold">
            <CheckCircle2 className="w-3.5 h-3.5" />พร้อมใช้งาน
          </span>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-xs text-slate-600 leading-relaxed">
            ระบบ <strong>DB Studio</strong> ช่วยให้คุณสามารถเข้าถึงข้อมูลทุกตาราง (วัตถุดิบ, ล็อต, ประวัติสต็อก, สูตรผลิต, คำสั่งผลิต) 
            เพื่อตรวจสอบและกดแก้ไขค่าต่าง ๆ ได้อย่างสะดวก ปลอดภัย และเข้าใจง่ายผ่านหน้าเว็บ
          </p>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
            <Link
              href="/db-studio"
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold shadow-md transition"
            >
              <Database className="w-4 h-4 text-emerald-400" />
              <span>เปิดใช้งาน DB Studio ทันที</span>
              <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
            </Link>

            <span className="text-[11px] font-mono text-slate-500 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
              URL: /db-studio
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
