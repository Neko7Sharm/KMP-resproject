'use client';

import React, { createContext, useContext, useState, useRef, useCallback } from 'react';

export interface StockRow {
  id: string;
  date: string;
  lotNumber: string;
  inboundQty: number;
  outboundQty: number;
  balanceQty: number;
  totalQty: number;
  expDate: string;
  remarks: string;
}

export interface ScanResult {
  materialName: string;
  unit: string;
  cardNo: string;
  formYear?: number | null;
  sheetNumber?: string | null;
  formYearInfo?: string;
  creator: string;
  position: string;
  rows: StockRow[];
}

interface ScanContextType {
  // Status
  isAnalyzing: boolean;
  analyzeProgress: number;
  analyzeStepText: string;
  scanResult: ScanResult | null;
  engine: string;
  engineMsg: string;
  errorMsg: string | null;
  
  // Image data
  imageURL: string | null;
  imageBase64: string;
  imageMime: string;
  imageStats: { originalKB: number; optimizedKB: number } | null;

  // Key modal triggers
  showKeyModal: boolean;
  keyModalReason: string;
  openKeyModal: (reason: string) => void;
  closeKeyModal: () => void;

  // Actions
  setImageData: (url: string, base64: string, mime: string, stats?: { originalKB: number; optimizedKB: number }) => void;
  startScan: (base64Override?: string, mimeOverride?: string) => Promise<boolean>;
  setScanResult: React.Dispatch<React.SetStateAction<ScanResult | null>>;
  setErrorMsg: (msg: string | null) => void;
  resetScan: () => void;
}

const ScanContext = createContext<ScanContextType | null>(null);

export function ScanProvider({ children }: { children: React.ReactNode }) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState(0);
  const [analyzeStepText, setAnalyzeStepText] = useState('');
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [engine, setEngine] = useState('');
  const [engineMsg, setEngineMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [imageURL, setImageURL] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string>('');
  const [imageMime, setImageMime] = useState<string>('image/jpeg');
  const [imageStats, setImageStats] = useState<{ originalKB: number; optimizedKB: number } | null>(null);

  const [showKeyModal, setShowKeyModal] = useState(false);
  const [keyModalReason, setKeyModalReason] = useState('');

  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const openKeyModal = useCallback((reason: string) => {
    setKeyModalReason(reason);
    setShowKeyModal(true);
  }, []);

  const closeKeyModal = useCallback(() => {
    setShowKeyModal(false);
  }, []);

  const setImageData = useCallback(
    (url: string, base64: string, mime: string, stats?: { originalKB: number; optimizedKB: number }) => {
      setImageURL(url);
      setImageBase64(base64);
      setImageMime(mime);
      if (stats) setImageStats(stats);
      setScanResult(null);
      setErrorMsg(null);
    },
    []
  );

  const resetScan = useCallback(() => {
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    setIsAnalyzing(false);
    setAnalyzeProgress(0);
    setAnalyzeStepText('');
    setScanResult(null);
    setImageURL(null);
    setImageBase64('');
    setImageStats(null);
    setErrorMsg(null);
  }, []);

  const startScan = useCallback(
    async (base64Override?: string, mimeOverride?: string): Promise<boolean> => {
      const targetBase64 = base64Override || imageBase64;
      const targetMime = mimeOverride || imageMime;

      if (!targetBase64) {
        setErrorMsg('กรุณาอัปโหลดรูปภาพก่อน');
        return false;
      }

      setIsAnalyzing(true);
      setErrorMsg(null);
      setScanResult(null);
      setAnalyzeProgress(10);
      setAnalyzeStepText('กำลังส่งภาพไปยังเซิร์ฟเวอร์...');

      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);

      let elapsedSeconds = 0;
      let currentPct = 12;
      progressIntervalRef.current = setInterval(() => {
        elapsedSeconds += 0.5;

        // ค่อยๆ ไต่ระดับเปอร์เซ็นต์อย่างนุ่มนวล ไม่กระชากไปตันที่ 94% เร็วเกินไป
        if (currentPct < 45) {
          currentPct += Math.random() * 2.5 + 1.5;
        } else if (currentPct < 75) {
          currentPct += Math.random() * 1.5 + 0.8;
        } else if (currentPct < 92) {
          currentPct += 0.4;
        }
        if (currentPct > 94) currentPct = 94;
        setAnalyzeProgress(Math.round(currentPct));

        if (elapsedSeconds > 35) {
          setAnalyzeStepText('กำลังประมวลผลขั้นตอนสุดท้ายเพื่อความแม่นยำสูงสุด...');
        } else if (elapsedSeconds > 20) {
          setAnalyzeStepText('กำลังตรวจสอบยอดรับ-จ่าย วันหมดอายุ และจัดรูปแบบข้อมูล...');
        } else if (elapsedSeconds > 10) {
          setAnalyzeStepText('กำลังวิเคราะห์ตารางและสกัดลายมือภาษาไทยอย่างละเอียด...');
        } else if (elapsedSeconds > 4) {
          setAnalyzeStepText('Gemini AI กำลังตรวจจับตารางและลายมือภาษาไทย...');
        } else {
          setAnalyzeStepText('กำลังส่งภาพและเชื่อมต่อระบบ AI...');
        }
      }, 500);

      try {
        const res = await fetch('/api/ai/ocr-stock-card', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'ANALYZE', imageBase64: targetBase64, mimeType: targetMime }),
        });

        if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);

        // Safe parsing: ป้องกัน Error: Unexpected token 'A' เมื่อ Vercel ตัด timeout หรือส่ง plain-text
        const text = await res.text();
        let data: any = null;
        try {
          data = JSON.parse(text);
        } catch (jsonErr) {
          setIsAnalyzing(false);
          setAnalyzeProgress(0);
          console.error('Server returned non-JSON response:', text);
          if (res.status === 504 || text.includes('timeout') || text.includes('FUNCTION_INVOCATION_TIMEOUT')) {
            setErrorMsg('เซิร์ฟเวอร์ใช้เวลาประมวลผลนานเกินกำหนด (Timeout) กรุณาลองใหม่อีกครั้ง');
          } else {
            setErrorMsg(`เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง (HTTP ${res.status}): ${text.slice(0, 150)}`);
          }
          return false;
        }

        if (!res.ok || !data.success) {
          setIsAnalyzing(false);
          setAnalyzeProgress(0);
          if (data.needsKey) {
            openKeyModal(
              data.keySource === 'shared'
                ? `${data.error} — กรุณาตรวจสอบหรือเพิ่ม API Key สำรองในระบบ`
                : data.code === 'NO_KEY'
                  ? 'ยังไม่มี API Key ในระบบ กรุณาใส่ key เพื่อเปิดใช้งานระบบสแกน'
                  : `${data.error} — กรุณาใส่ key ของคุณเพื่อสแกนต่อ`
            );
            return false;
          }
          setErrorMsg(data.error || data.hint || 'AI วิเคราะห์ไม่สำเร็จ');
          return false;
        }

        setAnalyzeProgress(100);
        setAnalyzeStepText('ประมวลผลสำเร็จเรียบร้อย!');

        setTimeout(() => {
          setScanResult(data.data);
          setEngine(data.engine || '');
          setEngineMsg(data.message || '');
          setIsAnalyzing(false);
        }, 400);

        return true;
      } catch (err: any) {
        if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
        setIsAnalyzing(false);
        setAnalyzeProgress(0);
        setErrorMsg('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ: ' + (err.message || 'Network Error'));
        return false;
      }
    },
    [imageBase64, imageMime, openKeyModal]
  );

  return (
    <ScanContext.Provider
      value={{
        isAnalyzing,
        analyzeProgress,
        analyzeStepText,
        scanResult,
        engine,
        engineMsg,
        errorMsg,
        imageURL,
        imageBase64,
        imageMime,
        imageStats,
        showKeyModal,
        keyModalReason,
        openKeyModal,
        closeKeyModal,
        setImageData,
        startScan,
        setScanResult,
        setErrorMsg,
        resetScan,
      }}
    >
      {children}
    </ScanContext.Provider>
  );
}

export function useScan() {
  const context = useContext(ScanContext);
  if (!context) {
    throw new Error('useScan must be used within a ScanProvider');
  }
  return context;
}
