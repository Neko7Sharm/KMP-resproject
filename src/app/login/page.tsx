'use client';

import React, { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Package,
  Lock,
  User,
  Eye,
  EyeOff,
  ArrowRight,
  Loader2,
  AlertCircle,
  ShieldCheck,
  CheckCircle2,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

export default function LoginPage() {
  return (
    <React.Suspense
      fallback={
        <div className="min-h-screen w-full flex items-center justify-center bg-slate-900 text-white">
          <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
        </div>
      }
    >
      <LoginForm />
    </React.Suspense>
  );
}

function LoginForm() {
  const searchParams = useSearchParams();
  const rawNext = searchParams.get('next');
  // ป้องกัน redirect loop กลับไป /login หรือ URL ภายนอก
  const nextUrl = (!rawNext || rawNext === '/login' || !rawNext.startsWith('/') || rawNext.startsWith('//'))
    ? '/'
    : rawNext;

  const { user } = useAuth();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          password,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
        setIsLoading(false);
        return;
      }

      // Hard navigation เพื่อโหลด Cookie ใหม่ให้ Next.js Server Components & Middleware ทำงานสมบูรณ์ 100%
      window.location.assign(nextUrl);
    } catch (err: any) {
      setError(err.message || 'เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
      setIsLoading(false);
    }
  };

  const fillQuickAccount = (u: string, p: string) => {
    setUsername(u);
    setPassword(p);
    setError(null);
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 text-slate-100">
      <div className="w-full max-w-md space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-500 mx-auto flex items-center justify-center shadow-lg shadow-purple-500/25">
            <Package className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white">
            KMP Resource Management
          </h1>
          <p className="text-xs text-slate-400">
            ระบบบริหารจัดการคลังสินค้าและวัตถุดิบฝ่ายผลิต
          </p>
        </div>

        {/* Login Card */}
        <div className="bg-white/10 backdrop-blur-xl border border-white/15 rounded-3xl p-6 sm:p-8 shadow-2xl">
          <div className="mb-6">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-purple-400" />
              เข้าสู่ระบบ
            </h2>
            <p className="text-xs text-slate-300 mt-0.5">
              กรุณาเข้าสู่ระบบด้วยชื่อผู้ใช้และรหัสผ่านของคุณ
            </p>
          </div>

          {/* Banner แสดงสถานะหากมีผู้ใช้อยู่แล้วแต่ต้องการสลับบัญชี */}
          {user && (
            <div className="mb-5 p-3.5 bg-purple-500/20 border border-purple-500/40 rounded-2xl flex items-center justify-between text-xs text-purple-200">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-purple-400 shrink-0" />
                <span>
                  ใช้งานอยู่ในชื่อ: <strong>{user.name}</strong>
                </span>
              </div>
              <button
                type="button"
                onClick={() => window.location.assign(nextUrl)}
                className="px-2.5 py-1 bg-white/15 hover:bg-white/25 rounded-lg text-white font-semibold transition cursor-pointer"
              >
                ไปหน้าหลัก →
              </button>
            </div>
          )}

          {error && (
            <div className="mb-5 p-3.5 bg-rose-500/20 border border-rose-500/40 rounded-xl flex items-start gap-2.5 text-xs text-rose-200">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Username */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                ชื่อผู้ใช้ (Username)
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <User className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="เช่น admin, store, prod"
                  className="w-full pl-10 pr-4 py-2.5 bg-white/10 border border-white/15 rounded-xl text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent transition"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                รหัสผ่าน (Password)
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-10 py-2.5 bg-white/10 border border-white/15 rounded-xl text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent transition"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-white transition"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full mt-2 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-60 text-white font-bold rounded-xl text-sm flex items-center justify-center gap-2 transition shadow-lg shadow-purple-600/30 active:scale-98"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  กำลังเข้าสู่ระบบ...
                </>
              ) : (
                <>
                  เข้าสู่ระบบ
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Quick Login Demonstration Pills */}
          <div className="mt-6 pt-5 border-t border-white/10">
            <span className="text-[11px] font-semibold text-slate-400 block mb-2 text-center">
              🔑 ทดสอบเข้าสู่ระบบด้วยบัญชีตั้งต้น (กดเพื่อใส่ข้อมูล):
            </span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => fillQuickAccount('admin', 'admin1234')}
                className="p-2 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/30 text-left transition"
              >
                <span className="text-xs font-bold text-purple-200 block">👑 แอดมิน (admin)</span>
                <span className="text-[10px] text-slate-400">รหัส: admin1234</span>
              </button>
              <button
                type="button"
                onClick={() => fillQuickAccount('store', '1234')}
                className="p-2 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/30 text-left transition"
              >
                <span className="text-xs font-bold text-blue-200 block">📦 คลัง (store)</span>
                <span className="text-[10px] text-slate-400">รหัส: 1234</span>
              </button>
              <button
                type="button"
                onClick={() => fillQuickAccount('prod', '1234')}
                className="p-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 text-left transition"
              >
                <span className="text-xs font-bold text-amber-200 block">🏭 ผลิต (prod)</span>
                <span className="text-[10px] text-slate-400">รหัส: 1234</span>
              </button>
              <button
                type="button"
                onClick={() => fillQuickAccount('viewer', '1234')}
                className="p-2 rounded-lg bg-slate-500/20 hover:bg-slate-500/30 border border-slate-500/30 text-left transition"
              >
                <span className="text-xs font-bold text-slate-200 block">👁️ ดูข้อมูล (viewer)</span>
                <span className="text-[10px] text-slate-400">รหัส: 1234</span>
              </button>
            </div>
          </div>
        </div>

        <p className="text-center text-[11px] text-slate-500">
          KMP Raw Material Management • Role-Based Access Control
        </p>
      </div>
    </div>
  );
}
