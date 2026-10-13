'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import Link from 'next/link';
import {
  ScanLine, Upload, Loader2, CheckCircle2, AlertCircle, Edit2,
  Save, RefreshCw, ZoomIn, ZoomOut, RotateCcw, Database,
  ChevronDown, Plus, Trash2, X, Image, Info, Eye, Check,
  ArrowRight, Package, History, Sparkles, Zap, Camera, Video,
  Grid, List, Maximize2, Minimize2, Smartphone, Focus, ClipboardPaste
} from 'lucide-react';
import { useScan, StockRow, ScanResult, AiAnomaly, ExistingLotInfo } from '@/context/ScanContext';
import { optimizeImageForOCR } from '@/lib/imageOptimizer';

interface Section { id: string; code: string; name: string; }
interface Material {
  id: string;
  code: string;
  name: string;
  baseUnit: string;
  sectionId: string | null;
  section?: Section | null;
  lots?: Array<{
    lotNumber: string;
    quantityRemaining: number;
    status: string;
  }>;
}

// ---------- Main Page ----------
export default function ScanPage() {
  const {
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
  } = useScan();

  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [commitDone, setCommitDone]   = useState(false);
  const [commitStats, setCommitStats] = useState<any>(null);
  const [zoom, setZoom] = useState(100);
  const [sections, setSections] = useState<Section[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [selectedSectionId, setSelectedSectionId] = useState('');
  const [selectedMaterialId, setSelectedMaterialId] = useState('');
  const [isDragging, setIsDragging]   = useState(false);
  const [hasApiKey, setHasApiKey]     = useState<boolean | null>(null);
  const [systemKeyAvailable, setSystemKeyAvailable] = useState(false);
  const [sharedKeyAvailable, setSharedKeyAvailable] = useState(false);
  const [sharedKeysCount, setSharedKeysCount] = useState<number>(0);
  const [maskedKeys, setMaskedKeys] = useState<string[]>([]);
  const [keyInput, setKeyInput] = useState('');
  const [keyError, setKeyError] = useState<string | null>(null);
  const [isSavingKey, setIsSavingKey] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Live Camera (Webcam) State
  const [isWebcamOpen, setIsWebcamOpen] = useState(false);
  const [webcamFacingMode, setWebcamFacingMode] = useState<'environment' | 'user'>('environment');
  const [webcamError, setWebcamError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const webcamStreamRef = useRef<MediaStream | null>(null);

  // Verification & Inspector State
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [inspectorZoom, setInspectorZoom] = useState(120);
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [highlightedRowId, setHighlightedRowId] = useState<string | null>(null);

  // Load sections & materials on mount; check API status
  useEffect(() => {
    fetch('/api/sections').then(r => r.json()).then(d => setSections(Array.isArray(d) ? d : [])).catch(() => {});
    fetch('/api/materials').then(r => r.json()).then(d => setMaterials(Array.isArray(d) ? d : [])).catch(() => {});
    refreshKeyStatus();
  }, []);

  // When user selects an existing material from dropdown
  const handleSelectMaterial = (matId: string, currentScan: ScanResult | null) => {
    setSelectedMaterialId(matId);
    if (!matId) return;

    const matched = materials.find(m => m.id === matId);
    if (matched) {
      if (matched.sectionId) {
        setSelectedSectionId(matched.sectionId);
      }
      if (currentScan) {
        const enrichedLots: ExistingLotInfo[] = (matched.lots || []).map(l => ({
          lotNumber: l.lotNumber,
          currentRemaining: l.quantityRemaining,
          status: l.status,
        }));
        setScanResult({
          ...currentScan,
          materialName: matched.name,
          unit: matched.baseUnit || currentScan.unit,
          existingLots: enrichedLots.length > 0 ? enrichedLots : currentScan.existingLots,
        });
      }
    }
  };

  // Auto match scanned material name to existing material
  const autoMatchMaterial = (scannedName: string, currentMaterials: Material[], resData: ScanResult) => {
    const cleanScanned = scannedName.toLowerCase().replace(/\s+/g, '');
    const matched = currentMaterials.find(m => {
      const cleanExisting = m.name.toLowerCase().replace(/\s+/g, '');
      return cleanExisting === cleanScanned ||
             cleanExisting.includes(cleanScanned) ||
             cleanScanned.includes(cleanExisting);
    });

    if (matched) {
      setSelectedMaterialId(matched.id);
      if (matched.sectionId) {
        setSelectedSectionId(matched.sectionId);
      }
      resData.materialName = matched.name;
      if (matched.baseUnit) resData.unit = matched.baseUnit;
      if (matched.lots && matched.lots.length > 0 && (!resData.existingLots || resData.existingLots.length === 0)) {
        resData.existingLots = matched.lots.map(l => ({
          lotNumber: l.lotNumber,
          currentRemaining: l.quantityRemaining,
          status: l.status,
        }));
      }
    }
  };

  // Read file → optimize on client (downscale to max 1280px + JPEG 80%) → store in ScanContext & auto scan
  const processFile = useCallback(async (file: File, autoStart: boolean = true) => {
    if (!file.type.startsWith('image/')) { setErrorMsg('รองรับเฉพาะไฟล์รูปภาพ (JPG, PNG, WEBP)'); return; }
    if (file.size > 25 * 1024 * 1024) { setErrorMsg('ไฟล์ใหญ่เกิน 25MB กรุณาลดขนาดก่อนอัปโหลด'); return; }
    setErrorMsg(null); setCommitDone(false); setCommitStats(null);
    setSelectedMaterialId(''); setSelectedSectionId('');
    setIsOptimizing(true);

    try {
      const opt = await optimizeImageForOCR(file);
      setImageData(opt.previewUrl, opt.base64, opt.mimeType, {
        originalKB: opt.originalSizeKB,
        optimizedKB: opt.optimizedSizeKB,
      });
      if (autoStart) {
        startScan(opt.base64, opt.mimeType);
      }
    } catch (err: any) {
      console.error('Image optimization error:', err);
      // Fallback: load raw
      const url = URL.createObjectURL(file);
      const reader = new FileReader();
      reader.onload = (e) => {
        const b64 = (e.target?.result as string).replace(/^data:image\/\w+;base64,/, '');
        setImageData(url, b64, file.type);
        if (autoStart) {
          startScan(b64, file.type);
        }
      };
      reader.readAsDataURL(file);
    } finally {
      setIsOptimizing(false);
    }
  }, [setErrorMsg, setImageData, startScan]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file, true);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file, true);
  };

  // ── Clipboard Paste Handling (Ctrl+V and Button) ──
  const handlePasteFromClipboard = useCallback(async () => {
    try {
      if (typeof navigator === 'undefined' || !navigator.clipboard?.read) {
        setErrorMsg('เบราว์เซอร์ไม่รองรับการอ่านคลิปบอร์ดโดยตรง กรุณากดปุ่มลัด Ctrl + V เพื่อวางภาพ');
        return;
      }
      const clipboardItems = await navigator.clipboard.read();
      for (const item of clipboardItems) {
        const imageType = item.types.find(t => t.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          const file = new File([blob], `clipboard_${Date.now()}.png`, { type: imageType });
          processFile(file, true);
          return;
        }
      }
      setErrorMsg('ไม่พบไฟล์รูปภาพในคลิปบอร์ด กรุณาคัดลอกภาพก่อน (เช่น Snipping Tool, Win + Shift + S หรือคัดลอกรูปภาพ)');
    } catch (err: any) {
      console.warn('Clipboard read error:', err);
      setErrorMsg('ไม่สามารถอ่านคลิปบอร์ดได้: กรุณาอนุญาตสิทธิ์เข้าถึงคลิปบอร์ด หรือกดปุ่ม Ctrl + V บนแป้นพิมพ์เพื่อวางภาพ');
    }
  }, [processFile, setErrorMsg]);

  // Global window paste listener for Ctrl+V / Cmd+V
  useEffect(() => {
    const handleGlobalPaste = (e: ClipboardEvent) => {
      const activeEl = document.activeElement;
      const isInput =
        activeEl instanceof HTMLInputElement ||
        activeEl instanceof HTMLTextAreaElement ||
        (activeEl as HTMLElement)?.isContentEditable;

      // ถ้ากำลังพิมพ์ในกล่อง input ให้ยกเว้น ยกเว้นว่าในคลิปบอร์ดเป็นไฟล์ภาพจริงๆ
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            processFile(file, true);
            break;
          }
        }
      }
    };

    window.addEventListener('paste', handleGlobalPaste);
    return () => window.removeEventListener('paste', handleGlobalPaste);
  }, [processFile]);

  // Stop webcam stream cleanly
  const stopWebcam = useCallback(() => {
    if (webcamStreamRef.current) {
      webcamStreamRef.current.getTracks().forEach(track => track.stop());
      webcamStreamRef.current = null;
    }
    setIsWebcamOpen(false);
    setWebcamError(null);
  }, []);

  // Clean up webcam on unmount
  useEffect(() => {
    return () => {
      if (webcamStreamRef.current) {
        webcamStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Start live webcam stream
  const startWebcam = useCallback(async (facing: 'environment' | 'user' = 'environment') => {
    setWebcamError(null);
    setIsWebcamOpen(true);
    try {
      if (webcamStreamRef.current) {
        webcamStreamRef.current.getTracks().forEach(t => t.stop());
      }
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: facing,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      webcamStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (err: any) {
      console.error('Camera error:', err);
      setWebcamError(
        err.name === 'NotAllowedError'
          ? 'กรุณากด "อนุญาต (Allow)" ให้เบราว์เซอร์เข้าถึงกล้องถ่ายภาพ'
          : 'ไม่สามารถเปิดกล้องได้: ' + (err.message || 'อุปกรณ์ไม่รองรับหรือกล้องถูกใช้งานอยู่')
      );
    }
  }, []);

  // Snap photo from live video canvas (1-step instant encode directly to 1280px & start scan)
  const captureWebcam = useCallback(() => {
    if (!videoRef.current) return;
    const video = videoRef.current;

    let width = video.videoWidth || 1280;
    let height = video.videoHeight || 720;
    const maxDim = 1280;
    if (width > maxDim || height > maxDim) {
      if (width > height) {
        height = Math.round((height * maxDim) / width);
        width = maxDim;
      } else {
        width = Math.round((width * maxDim) / height);
        height = maxDim;
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(video, 0, 0, width, height);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.80);
    const b64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
    const sizeKB = Math.round((b64.length * 3) / 4 / 1024);

    stopWebcam();
    setErrorMsg(null);
    setCommitDone(false);
    setCommitStats(null);
    setSelectedMaterialId('');
    setSelectedSectionId('');
    setImageData(dataUrl, b64, 'image/jpeg', {
      originalKB: sizeKB,
      optimizedKB: sizeKB,
    });

    // เริ่มสแกนทันทีโดยไม่ต้องรอกดอีกรอบ
    startScan(b64, 'image/jpeg');
  }, [stopWebcam, setErrorMsg, setImageData, startScan]);

  // Switch between rear & front camera
  const toggleFacingMode = useCallback(() => {
    const next = webcamFacingMode === 'environment' ? 'user' : 'environment';
    setWebcamFacingMode(next);
    startWebcam(next);
  }, [webcamFacingMode, startWebcam]);

  const refreshKeyStatus = () => {
    fetch('/api/settings/apikey')
      .then(r => r.json())
      .then(d => {
        setHasApiKey(d.hasApiKey === true);
        setSystemKeyAvailable(d.systemKeyAvailable === true);
        setSharedKeyAvailable(d.sharedKeyAvailable === true);
        setSharedKeysCount(d.sharedKeysCount || 0);
        setMaskedKeys(d.keys || []);
      })
      .catch(() => setHasApiKey(false));
  };

  const handleSaveKeyAndRetry = async () => {
    if (!keyInput.trim()) return;
    setIsSavingKey(true);
    setKeyError(null);
    try {
      const res = await fetch('/api/settings/apikey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: keyInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setKeyError(data.error || 'บันทึก API Key ไม่สำเร็จ'); return; }
      closeKeyModal();
      setKeyInput('');
      refreshKeyStatus();
      // สแกนต่อทันทีด้วยรูปเดิม (ไม่ต้องอัปโหลดใหม่)
      if (imageBase64) startScan();
    } catch (e: any) {
      setKeyError(e.message);
    } finally {
      setIsSavingKey(false);
    }
  };

  // Analyze image via AI (Delegates to global ScanContext so it keeps running in background)
  const handleAnalyze = async () => {
    const success = await startScan();
    // Auto-match material after successful scan if materialName detected
    // Note: scanResult will be set by context, matching is handled reactively
  };

  // Reactively auto match material when scanResult appears or changes
  useEffect(() => {
    if (scanResult?.materialName && materials.length > 0 && !selectedMaterialId) {
      autoMatchMaterial(scanResult.materialName, materials, scanResult);
    }
  }, [scanResult, materials, selectedMaterialId]);

  // Edit a cell in the staging table
  const updateRow = (rowId: string, field: keyof StockRow, value: string | number) => {
    if (!scanResult) return;
    setScanResult({
      ...scanResult,
      rows: scanResult.rows.map(r => r.id === rowId ? { ...r, [field]: value } : r),
    });
  };

  const deleteRow = (rowId: string) => {
    if (!scanResult) return;
    setScanResult({ ...scanResult, rows: scanResult.rows.filter(r => r.id !== rowId) });
  };

  // คำนวณและตรวจสอบความถูกต้องทางคณิตศาสตร์และเทียบสต็อกแบบ Real-time
  const liveAnomalies = (() => {
    if (!scanResult || !scanResult.rows || scanResult.rows.length === 0) return [];
    const anomalies: AiAnomaly[] = [];

    const lotRunningBal = new Map<string, number>();
    const existingMap = new Map<string, ExistingLotInfo>();
    (scanResult.existingLots || []).forEach(l => existingMap.set(l.lotNumber.toUpperCase().trim(), l));

    scanResult.rows.forEach((row, idx) => {
      const lotNum = String(row.lotNumber || '').trim();
      const inQty = Number(row.inboundQty) || 0;
      const outQty = Number(row.outboundQty) || 0;
      const balQty = Number(row.balanceQty) || 0;
      const rowNum = idx + 1;
      const dateStr = row.date || 'ไม่ระบุวันที่';

      if (inQty < 0 || outQty < 0 || balQty < 0) {
        anomalies.push({
          type: 'NEGATIVE_QTY',
          severity: 'error',
          rowId: row.id,
          lotNumber: lotNum,
          message: `แถวที่ ${rowNum} (${dateStr}): มีตัวเลขติดลบ (รับ: ${inQty}, จ่าย: ${outQty}, คงเหลือ: ${balQty})`,
        });
      }

      if (!lotNum) {
        anomalies.push({
          type: 'INFO',
          severity: 'warning',
          rowId: row.id,
          lotNumber: '',
          message: `แถวที่ ${rowNum} (${dateStr}): ไม่ได้ระบุเลขล็อตในเอกสาร`,
        });
        return;
      }

      const lotKey = lotNum.toUpperCase();
      const prevBal = lotRunningBal.get(lotKey);
      const existing = existingMap.get(lotKey);

      if (inQty > 0) {
        const nextBal = (prevBal !== undefined ? prevBal : 0) + inQty;
        if (balQty > 0 && Math.abs(balQty - nextBal) > 0.01) {
          anomalies.push({
            type: 'MATH_MISMATCH',
            severity: 'warning',
            rowId: row.id,
            lotNumber: lotNum,
            message: `แถวที่ ${rowNum} (${dateStr}, ล็อต ${lotNum}): รับเข้า +${inQty} ยอดคงเหลือควรเป็น ${nextBal} แต่ในตารางอ่านได้ ${balQty}`,
            expectedValue: nextBal,
          });
        }
        lotRunningBal.set(lotKey, balQty > 0 ? balQty : nextBal);
      } else if (outQty > 0) {
        if (prevBal !== undefined) {
          const expected = Math.max(0, prevBal - outQty);
          if (Math.abs(balQty - expected) > 0.01) {
            anomalies.push({
              type: 'MATH_MISMATCH',
              severity: 'warning',
              rowId: row.id,
              lotNumber: lotNum,
              message: `แถวที่ ${rowNum} (${dateStr}, ล็อต ${lotNum}): จ่ายออก -${outQty} จากคงเหลือเดิม ${prevBal} ยอดคงเหลือควรเป็น ${expected} แต่ในตารางอ่านได้ ${balQty}`,
              expectedValue: expected,
            });
          }
          lotRunningBal.set(lotKey, balQty > 0 ? balQty : expected);
        } else {
          if (existing) {
            const expected = Math.max(0, existing.currentRemaining - outQty);
            if (balQty > 0 && Math.abs(balQty - expected) > 0.01) {
              anomalies.push({
                type: 'WAREHOUSE_STOCK',
                severity: 'info',
                rowId: row.id,
                lotNumber: lotNum,
                message: `ล็อต ${lotNum} มีในคลังเดิม (ยอดในคลังปัจจุบัน ${existing.currentRemaining} ${scanResult.unit || 'kg'}) จ่ายออก -${outQty} คงเหลือตามคลังควรเป็น ${expected} แต่ในเอกสารระบุ ${balQty}`,
                expectedValue: expected,
              });
            }
            lotRunningBal.set(lotKey, balQty > 0 ? balQty : expected);
          } else {
            lotRunningBal.set(lotKey, balQty);
          }
        }
      } else if (balQty > 0) {
        lotRunningBal.set(lotKey, balQty);
      }
    });

    return anomalies;
  })();

  // ปรับแก้ตัวเลขตามหลักคณิตศาสตร์ให้อัตโนมัติในคลิกเดียว
  const handleAutoFixAnomalies = () => {
    if (!scanResult) return;
    const fixMap = new Map<string, number>();
    liveAnomalies.forEach(a => {
      if (a.rowId && a.expectedValue !== undefined) {
        fixMap.set(a.rowId, a.expectedValue);
      }
    });

    if (fixMap.size === 0) return;

    setScanResult({
      ...scanResult,
      rows: scanResult.rows.map(r => {
        if (fixMap.has(r.id)) {
          const val = fixMap.get(r.id)!;
          return {
            ...r,
            balanceQty: val,
            totalQty: val,
          };
        }
        return r;
      }),
    });
  };

  // ปรับแก้ตัวเลขเฉพาะแถวที่ต้องการ
  const handleFixSingleAnomaly = (rowId: string, expectedVal: number) => {
    if (!scanResult) return;
    setScanResult({
      ...scanResult,
      rows: scanResult.rows.map(r => {
        if (r.id === rowId) {
          return {
            ...r,
            balanceQty: expectedVal,
            totalQty: expectedVal,
          };
        }
        return r;
      }),
    });
  };

  // รวมรวมสถานะและยอดคงเหลือของแต่ละล็อต (ทั้งในคลังเดิมและในใบนี้)
  const lotSummaries = (() => {
    if (!scanResult) return [];
    const map = new Map<string, {
      lotNumber: string;
      warehouseRemaining?: number;
      warehouseStatus?: string;
      isExistingInDb: boolean;
      scannedInbound: number;
      scannedOutbound: number;
      scannedFinalBalance: number;
      hasDiscrepancy: boolean;
    }>();

    // 1. Existing lots from DB
    (scanResult.existingLots || []).forEach(l => {
      const k = l.lotNumber.toUpperCase().trim();
      if (k) {
        map.set(k, {
          lotNumber: l.lotNumber,
          warehouseRemaining: l.currentRemaining,
          warehouseStatus: l.status,
          isExistingInDb: true,
          scannedInbound: 0,
          scannedOutbound: 0,
          scannedFinalBalance: 0,
          hasDiscrepancy: false,
        });
      }
    });

    // 2. Scan rows
    (scanResult.rows || []).forEach(r => {
      const k = String(r.lotNumber || '').toUpperCase().trim();
      if (!k) return;
      const entry = map.get(k) || {
        lotNumber: r.lotNumber,
        isExistingInDb: false,
        scannedInbound: 0,
        scannedOutbound: 0,
        scannedFinalBalance: 0,
        hasDiscrepancy: false,
      };
      entry.scannedInbound += Number(r.inboundQty) || 0;
      entry.scannedOutbound += Number(r.outboundQty) || 0;
      if (Number(r.balanceQty) > 0) {
        entry.scannedFinalBalance = Number(r.balanceQty);
      }
      map.set(k, entry);
    });

    // 3. Mark discrepancies
    liveAnomalies.forEach(a => {
      if (a.lotNumber) {
        const k = a.lotNumber.toUpperCase().trim();
        if (map.has(k)) {
          map.get(k)!.hasDiscrepancy = true;
        }
      }
    });

    return Array.from(map.values()).filter(l => {
      const appearsInScan = scanResult.rows.some(r => String(r.lotNumber || '').toUpperCase().trim() === l.lotNumber.toUpperCase().trim());
      return appearsInScan || (l.warehouseRemaining !== undefined && l.warehouseRemaining > 0);
    });
  })();

  // Normalize date input to DD/MM/YYYY with 4-digit CE year
  const normalizeDateToCE = (val: string): string => {
    if (!val) return '';
    const trimmed = val.trim();
    // YYYY-MM-DD
    const isoMatch = trimmed.match(/^(\d{2,4})[-\/\.](\d{1,2})[-\/\.](\d{1,2})$/);
    if (isoMatch && parseInt(isoMatch[1]) > 31) {
      let y = parseInt(isoMatch[1]);
      if (y > 2400) y -= 543;
      else if (y < 100) y = y >= 40 ? (y + 2500) - 543 : 2000 + y;
      const m = String(parseInt(isoMatch[2])).padStart(2, '0');
      const d = String(parseInt(isoMatch[3])).padStart(2, '0');
      return `${d}/${m}/${y}`;
    }
    // DD/MM/YYYY
    const dmyMatch = trimmed.match(/^(\d{1,2})[-\/\.](\d{1,2})[-\/\.](\d{2,4})$/);
    if (dmyMatch) {
      const d = String(parseInt(dmyMatch[1])).padStart(2, '0');
      const m = String(parseInt(dmyMatch[2])).padStart(2, '0');
      let y = parseInt(dmyMatch[3]);
      if (y > 2400) y -= 543;
      else if (y < 100) y = y >= 40 ? (y + 2500) - 543 : 2000 + y;
      return `${d}/${m}/${y}`;
    }
    return trimmed;
  };

  // Normalize expDate input to DD-MM-YYYY with 4-digit CE year
  const normalizeExpDateToCE = (val: string): string => {
    if (!val) return '';
    const trimmed = val.trim();
    // YYYY-MM-DD or YYYY/MM/DD (year first, > 31)
    const isoMatch = trimmed.match(/^(\d{2,4})[-\/\.](\d{1,2})[-\/\.](\d{1,2})$/);
    if (isoMatch && parseInt(isoMatch[1]) > 31) {
      let y = parseInt(isoMatch[1]);
      if (y > 2400) y -= 543;
      else if (y < 100) y = y >= 40 ? (y + 2500) - 543 : 2000 + y;
      const m = String(parseInt(isoMatch[2])).padStart(2, '0');
      const d = String(parseInt(isoMatch[3])).padStart(2, '0');
      return `${d}-${m}-${y}`;
    }
    // DD/MM/YYYY or DD-MM-YYYY (day first, year last > 1000)
    const dmyMatch = trimmed.match(/^(\d{1,2})[-\/\.](\d{1,2})[-\/\.](\d{2,4})$/);
    if (dmyMatch) {
      const d = String(parseInt(dmyMatch[1])).padStart(2, '0');
      const m = String(parseInt(dmyMatch[2])).padStart(2, '0');
      let y = parseInt(dmyMatch[3]);
      if (y > 2400) y -= 543;
      else if (y < 100) y = y >= 40 ? (y + 2500) - 543 : 2000 + y;
      return `${d}-${m}-${y}`;
    }
    return trimmed;
  };

  // เปลี่ยนปีในสตริงวันที่ (รองรับทั้ง DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY)
  const replaceYearInDate = (dateStr: string, newYear: number): string => {
    if (!dateStr || !newYear) return dateStr;
    const trimmed = dateStr.trim();
    // แมตช์ วัน/เดือน/ปี เช่น 07/08/2026 หรือ 07-08-2025
    const m = trimmed.match(/^(\d{1,2})([-\/\.])(\d{1,2})([-\/\.])(\d{2,4})$/);
    if (m) {
      const d = m[1].padStart(2, '0');
      const sep1 = m[2];
      const mo = m[3].padStart(2, '0');
      const sep2 = m[4];
      return `${d}${sep1}${mo}${sep2}${newYear}`;
    }
    return dateStr;
  };

  // อัปเดตปีของใบ และปรับปีของวันผลิต (date) ในทุกแถวตามปีใหม่ทันที
  const updateFormYear = (newYear: number | null, cardNoOverride?: string) => {
    if (!scanResult) return;
    const targetCardNo = cardNoOverride !== undefined ? cardNoOverride : scanResult.cardNo;
    const sheet = scanResult.sheetNumber || '';
    const newYearInfo = newYear ? `ปี ค.ศ. ${newYear}${sheet ? ` (ใบที่ ${sheet})` : ''}` : '';

    // ถ้ามีการระบุปี ค.ศ. 4 หลักที่ถูกต้อง ให้แก้ปีของวันผลิต (date) ในทุกรายการด้วย
    const updatedRows = (newYear && newYear >= 1900 && newYear <= 2100)
      ? scanResult.rows.map(r => ({
          ...r,
          date: replaceYearInDate(r.date, newYear),
        }))
      : scanResult.rows;

    setScanResult({
      ...scanResult,
      cardNo: targetCardNo,
      formYear: newYear,
      formYearInfo: newYearInfo,
      rows: updatedRows,
    });
  };

  // Parse card number (e.g. 01/26 -> sheet 01, year 2026)
  const parseCardNoInfo = (val: string) => {
    if (!val) return { sheet: '', year: null, text: '' };
    const m = val.trim().match(/^([A-Za-z0-9\.\-]+)\s*[\/\-]\s*(\d{2,4})$/);
    if (m) {
      const sheet = m[1];
      let rawY = parseInt(m[2]);
      if (rawY > 2400) rawY -= 543;
      else if (rawY < 100) rawY = rawY >= 40 ? (rawY + 2500) - 543 : 2000 + rawY;
      return {
        sheet,
        year: rawY,
        text: `ใบที่ ${sheet} ของปี ค.ศ. ${rawY}`,
      };
    }
    return { sheet: '', year: null, text: '' };
  };

  const handleCardNoChange = (newVal: string) => {
    if (!scanResult) return;
    const parsed = parseCardNoInfo(newVal);
    if (parsed.year !== null) {
      // ถ้าพบปีจากเลขที่ใบ เช่น 01/26 -> อัปเดตปีและปรับวันผลิตทุกแถวอัตโนมัติ
      updateFormYear(parsed.year, newVal);
    } else {
      setScanResult({
        ...scanResult,
        cardNo: newVal,
      });
    }
  };

  const addRow = () => {
    if (!scanResult) return;
    const now = new Date();
    const d = String(now.getDate()).padStart(2, '0');
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const y = now.getFullYear();
    const newRow: StockRow = {
      id: `r-${Date.now()}`,
      date: `${d}/${m}/${y}`,
      lotNumber: '', inboundQty: 0, outboundQty: 0, balanceQty: 0, totalQty: 0, expDate: '', remarks: '',
    };
    setScanResult({ ...scanResult, rows: [...scanResult.rows, newRow] });
  };

  // Commit to DB
  const handleCommit = async () => {
    if (!scanResult) return;
    if (!window.confirm(`ยืนยันการนำเข้า ${scanResult.rows.length} รายการเข้าฐานข้อมูลใช่หรือไม่?`)) return;
    setIsCommitting(true); setErrorMsg(null);
    try {
      const res = await fetch('/api/ai/ocr-stock-card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'COMMIT',
          dataToCommit: {
            materialId: selectedMaterialId || null,
            materialName: scanResult.materialName,
            baseUnit: scanResult.unit,
            sectionId: selectedSectionId || null,
            documentRef: scanResult.cardNo ? `STOCK-CARD-${scanResult.cardNo}` : 'STOCK-CARD-IMPORT',
            creator: scanResult.creator,
            formYear: scanResult.formYear || null,
            rows: scanResult.rows,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) { setErrorMsg(data.error || 'บันทึกข้อมูลไม่สำเร็จ'); return; }
      setCommitDone(true); setCommitStats(data);
    } catch (e: any) {
      setErrorMsg('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ: ' + e.message);
    } finally {
      setIsCommitting(false);
    }
  };

  const resetAll = () => {
    resetScan();
    setCommitDone(false); setCommitStats(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ---------- Render ----------
  const currentStep = commitDone ? 4 : scanResult ? 3 : (isAnalyzing || imageURL) ? 2 : 1;

  return (
    <div className="space-y-5 pb-20 md:pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <ScanLine className="w-5 h-5 text-purple-600" />
            AI สแกน Stock Card
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            อัปโหลดภาพใบสต็อกการ์ด → AI ตรวจจับตาราง & ลายมือไทย → ตรวจสอบก่อนบันทึกจริง
          </p>
        </div>
        {scanResult && (
          <button onClick={resetAll} className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition">
            <RefreshCw className="w-3.5 h-3.5" />
            <span>สแกนใหม่</span>
          </button>
        )}
      </div>

      {/* Step Indicator */}
      <div className="bg-white border border-slate-200 rounded-2xl p-3 sm:p-4 shadow-2xs">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
          {[
            { step: 1, title: 'อัปโหลดภาพ', desc: 'JPG/PNG Stock Card' },
            { step: 2, title: 'วิเคราะห์ AI', desc: 'ถอดตาราง & ลายมือ' },
            { step: 3, title: 'ตรวจทาน & แก้ไข', desc: 'ตารางพร้อมแก้ inline' },
            { step: 4, title: 'บันทึกสต็อก', desc: 'อัปเดตลงฐานข้อมูล' },
          ].map((s) => {
            const isDone = currentStep > s.step;
            const isCurrent = currentStep === s.step;
            return (
              <div
                key={s.step}
                className={`flex items-center gap-2.5 p-2 sm:p-2.5 rounded-xl transition ${
                  isCurrent
                    ? 'bg-purple-50/80 border border-purple-200 shadow-2xs'
                    : isDone
                    ? 'bg-emerald-50/50 border border-emerald-100'
                    : 'bg-slate-50/60 border border-transparent opacity-60'
                }`}
              >
                <div
                  className={`w-6 h-6 sm:w-7 sm:h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition ${
                    isDone
                      ? 'bg-emerald-600 text-white'
                      : isCurrent
                      ? 'bg-purple-600 text-white shadow-xs shadow-purple-300'
                      : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  {isDone ? <Check className="w-3.5 h-3.5 stroke-[3]" /> : s.step}
                </div>
                <div className="min-w-0">
                  <div className={`text-xs font-bold truncate ${isCurrent ? 'text-purple-950' : isDone ? 'text-emerald-950' : 'text-slate-700'}`}>
                    {s.title}
                  </div>
                  <div className="text-[10px] text-slate-400 truncate">
                    {s.desc}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* AI Status */}
      {hasApiKey === false && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-900 flex-1">
            <strong>ยังไม่มี Gemini API Key ในระบบ</strong> — ใส่ key ครั้งเดียว ทุกคนที่ใช้งานจะใช้สแกนร่วมกันได้ทันที
          </div>
          <button
            onClick={() => openKeyModal('ยังไม่มี API Key ในระบบ กรุณาใส่ key เพื่อเปิดใช้งานการสแกน')}
            className="shrink-0 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold transition"
          >
            ใส่ API Key
          </button>
        </div>
      )}
      {hasApiKey === true && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between text-xs text-emerald-800">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            <strong className="font-semibold text-emerald-800">AI พร้อมใช้งาน</strong>
          </div>
          <button
            onClick={() => openKeyModal('เปลี่ยนหรือเพิ่ม API Key')}
            className="shrink-0 underline text-emerald-700 hover:text-emerald-900 font-medium"
          >
            เปลี่ยนหรือเพิ่ม API
          </button>
        </div>
      )}

      {/* Error */}
      {errorMsg && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
          <div className="text-sm text-rose-800 flex-1 space-y-2">
            <div>{errorMsg}</div>
            <div className="flex items-center gap-2 flex-wrap pt-1">
              {imageBase64 && (
                <button
                  type="button"
                  onClick={() => startScan()}
                  disabled={isAnalyzing}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white rounded-lg text-xs font-bold transition shadow-xs"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>ลองสแกนอีกครั้ง</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => openKeyModal('ใส่ API Key สำรองของตนเองเพื่อเลี่ยงปัญหาคิวหนาแน่น')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-rose-300 hover:bg-rose-100 text-rose-800 rounded-lg text-xs font-semibold transition"
              >
                <span>🔑 เปลี่ยน/ใส่ API Key สำรอง</span>
              </button>
            </div>
          </div>
          <button onClick={() => setErrorMsg(null)} className="text-rose-400 hover:text-rose-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Commit Success */}
      {commitDone && commitStats && (
        <div className="p-5 bg-gradient-to-br from-emerald-50 via-teal-50 to-emerald-100/70 border border-emerald-200 rounded-2xl shadow-sm">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="w-11 h-11 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-md shadow-emerald-200">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-200/80 text-emerald-800 mb-1">
                  นำเข้าข้อมูลสมบูรณ์
                </span>
                <h3 className="font-extrabold text-emerald-950 text-base">
                  บันทึกข้อมูล Stock Card สำเร็จเรียบร้อย!
                </h3>
                <p className="text-xs text-emerald-800 mt-0.5">
                  วัตถุดิบ: <strong className="text-emerald-950">{commitStats.materialName}</strong> •{' '}
                  สร้าง/ปรับปรุง <strong className="text-emerald-950">{commitStats.createdLots} ล็อต</strong> •{' '}
                  บันทึกความเคลื่อนไหว <strong className="text-emerald-950">{commitStats.importedTransactions} รายการ</strong>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
              <button
                onClick={resetAll}
                className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold transition shadow-xs"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                สแกนใบถัดไป
              </button>
              <Link
                href="/inventory"
                className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-xl text-xs font-bold transition shadow-xs"
              >
                <Package className="w-3.5 h-3.5 text-blue-600" />
                ดูสต็อกในคลัง
              </Link>
              <Link
                href="/transactions"
                className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-xl text-xs font-bold transition shadow-xs"
              >
                <History className="w-3.5 h-3.5 text-slate-600" />
                ดูประวัติสต็อก
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Two-column layout: Image viewer | Staging data */}
      <div className={`grid grid-cols-1 ${scanResult ? 'lg:grid-cols-2' : ''} gap-6 items-start`}>

        {/* ---- LEFT: Image upload + preview ---- */}
        <div className="space-y-4">
          {!imageURL ? (
            /* Upload & Camera Capture Hub */
            <div className="bg-white border border-slate-200 rounded-3xl p-5 sm:p-7 shadow-xs space-y-5">
              <div className="text-center space-y-1">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-purple-100 text-purple-700">
                  <Camera className="w-3.5 h-3.5" />
                  นำเข้าภาพ Stock Card
                </span>
                <h3 className="text-base sm:text-lg font-bold text-slate-800">
                  ถ่ายรูปด้วยกล้อง หรือเลือกไฟล์รูปภาพ
                </h3>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  ระบบรองรับทั้งการถ่ายรูปผ่านกล้องโทรศัพท์ ถ่ายสดผ่านเว็บ หรืออัปโหลดจากคลังภาพ
                </p>
              </div>

              {/* 4 Quick Action Buttons */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {/* 1. Native Mobile Camera */}
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  className="group p-3.5 sm:p-4 rounded-2xl bg-gradient-to-br from-purple-600 to-indigo-700 hover:from-purple-700 hover:to-indigo-800 text-white shadow-md shadow-purple-200 flex flex-col items-center justify-center text-center gap-2 transition active:scale-98"
                >
                  <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-white/20 flex items-center justify-center group-hover:scale-110 transition">
                    <Camera className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
                  </div>
                  <div>
                    <span className="text-xs sm:text-sm font-bold block leading-tight">ถ่ายด้วยกล้อง</span>
                    <span className="text-[10px] sm:text-[11px] text-purple-100 block mt-0.5">กล้องมือถือ HD</span>
                  </div>
                </button>

                {/* 2. Web Live Camera Viewfinder */}
                <button
                  type="button"
                  onClick={() => startWebcam('environment')}
                  className="group p-3.5 sm:p-4 rounded-2xl bg-white border-2 border-indigo-200 hover:border-indigo-400 hover:bg-indigo-50/50 text-slate-800 shadow-xs flex flex-col items-center justify-center text-center gap-2 transition active:scale-98"
                >
                  <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-indigo-100 flex items-center justify-center group-hover:scale-110 transition">
                    <Focus className="w-5 h-5 sm:w-6 sm:h-6 text-indigo-600" />
                  </div>
                  <div>
                    <span className="text-xs sm:text-sm font-bold block leading-tight text-indigo-900">เปิดกล้องสดในเว็บ</span>
                    <span className="text-[10px] sm:text-[11px] text-slate-500 block mt-0.5">เล็งด้วยกรอบเอกสาร</span>
                  </div>
                </button>

                {/* 3. Choose from Device Gallery */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="group p-3.5 sm:p-4 rounded-2xl bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-800 flex flex-col items-center justify-center text-center gap-2 transition active:scale-98"
                >
                  <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-slate-200 flex items-center justify-center group-hover:scale-110 transition">
                    <Image className="w-5 h-5 sm:w-6 sm:h-6 text-slate-700" />
                  </div>
                  <div>
                    <span className="text-xs sm:text-sm font-bold block leading-tight">เลือกรูปจากเครื่อง</span>
                    <span className="text-[10px] sm:text-[11px] text-slate-500 block mt-0.5">คลังภาพ / ไฟล์</span>
                  </div>
                </button>

                {/* 4. Paste from Clipboard */}
                <button
                  type="button"
                  onClick={handlePasteFromClipboard}
                  className="group p-3.5 sm:p-4 rounded-2xl bg-gradient-to-br from-amber-50 to-orange-50 hover:from-amber-100 hover:to-orange-100 border-2 border-amber-200 hover:border-amber-300 text-slate-800 shadow-xs flex flex-col items-center justify-center text-center gap-2 transition active:scale-98"
                >
                  <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-amber-200/80 flex items-center justify-center group-hover:scale-110 transition">
                    <ClipboardPaste className="w-5 h-5 sm:w-6 sm:h-6 text-amber-800" />
                  </div>
                  <div>
                    <span className="text-xs sm:text-sm font-bold block leading-tight text-amber-950">วางจากคลิปบอร์ด</span>
                    <span className="text-[10px] sm:text-[11px] text-amber-700 block mt-0.5">กดวาง หรือ Ctrl + V</span>
                  </div>
                </button>
              </div>

              {/* Desktop Drag and Drop Dropzone */}
              <div
                onDragEnter={() => setIsDragging(true)}
                onDragLeave={() => setIsDragging(false)}
                onDragOver={e => e.preventDefault()}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`hidden sm:flex border-2 border-dashed rounded-2xl p-6 flex-col items-center justify-center gap-2 cursor-pointer transition ${
                  isDragging ? 'border-purple-500 bg-purple-50' : 'border-slate-200 hover:border-purple-300 hover:bg-slate-50/70'
                }`}
              >
                <div className="flex items-center gap-2 text-slate-400">
                  <Upload className="w-5 h-5" />
                  <span className="text-slate-300">|</span>
                  <ClipboardPaste className="w-5 h-5 text-purple-600" />
                </div>
                <p className="text-xs font-semibold text-slate-700 text-center">
                  ลากไฟล์ภาพมาวางที่นี่ หรือกดคีย์ลัด <kbd className="px-1.5 py-0.5 bg-purple-100 border border-purple-200 text-purple-800 rounded font-mono font-bold text-[11px]">Ctrl + V</kbd> เพื่อวางภาพจากคลิปบอร์ดได้ทันที
                </p>
                <span className="text-[11px] text-slate-400">รองรับ JPG, PNG, WEBP หรือภาพแคปหน้าจอ (Snipping Tool, PrintScreen)</span>
              </div>

              {/* Hidden Inputs */}
              <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileSelect} />
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
            </div>
          ) : (
            /* Image viewer */
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
              {/* Toolbar */}
              <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-semibold text-slate-600 flex items-center gap-1.5 truncate">
                    <Image className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                    ภาพ Stock Card
                  </span>
                  {imageStats && (
                    <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800" title={`ขนาดเดิม ${imageStats.originalKB} KB ปรับเหลือ ${imageStats.optimizedKB} KB เพื่อเร่งความเร็ว AI`}>
                      <Zap className="w-3 h-3 text-emerald-600" />
                      ลดเหลือ {imageStats.optimizedKB} KB (เร็วขึ้น)
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={handlePasteFromClipboard}
                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-purple-50 text-purple-700 border border-purple-200 rounded-lg text-[11px] font-semibold transition"
                    title="วางภาพใหม่จากคลิปบอร์ด (หรือกด Ctrl+V)"
                  >
                    <ClipboardPaste className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">วางภาพใหม่ (Ctrl+V)</span>
                    <span className="sm:hidden">วาง (Ctrl+V)</span>
                  </button>
                  <div className="w-px h-4 bg-slate-200 mx-1 hidden sm:block" />
                  <button onClick={() => setZoom(z => Math.max(50, z - 20))} className="p-1.5 rounded hover:bg-slate-200 text-slate-600"><ZoomOut className="w-3.5 h-3.5" /></button>
                  <span className="text-xs font-mono text-slate-600 w-10 text-center">{zoom}%</span>
                  <button onClick={() => setZoom(z => Math.min(200, z + 20))} className="p-1.5 rounded hover:bg-slate-200 text-slate-600"><ZoomIn className="w-3.5 h-3.5" /></button>
                  <button onClick={() => setZoom(100)} className="p-1.5 rounded hover:bg-slate-200 text-slate-600" title="รีเซ็ตซูม"><RotateCcw className="w-3.5 h-3.5" /></button>
                  <div className="w-px h-4 bg-slate-200 mx-1" />
                  <button onClick={resetAll} className="p-1.5 rounded hover:bg-rose-100 text-rose-500" title="ลบรูป"><X className="w-3.5 h-3.5" /></button>
                </div>
              </div>
              {/* Image */}
              <div className="overflow-auto max-h-[70vh] bg-slate-100">
                <div className="p-3 inline-block min-w-full">
                  <img
                    src={imageURL}
                    alt="Stock Card"
                    style={{ width: `${zoom}%`, maxWidth: 'none' }}
                    className="rounded-lg shadow-sm cursor-zoom-in"
                    onClick={() => setZoom(z => z < 150 ? z + 20 : 100)}
                  />
                </div>
              </div>
              {/* Analyze Button */}
              {!scanResult && (
                <div className="p-4 border-t border-slate-100 bg-white">
                  <button
                    onClick={handleAnalyze}
                    disabled={isAnalyzing || isOptimizing}
                    className="w-full py-3 bg-purple-600 hover:bg-purple-700 disabled:opacity-60 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition shadow-sm shadow-purple-200"
                  >
                    {isOptimizing ? (
                      <><Loader2 className="w-4 h-4 animate-spin" />กำลังบีบอัดและเตรียมภาพ...</>
                    ) : isAnalyzing ? (
                      <><Loader2 className="w-4 h-4 animate-spin" />กำลังวิเคราะห์ภาพด้วย AI (รันในพื้นหลังได้)...</>
                    ) : (
                      <><ScanLine className="w-4 h-4" />วิเคราะห์ภาพด้วย AI</>
                    )}
                  </button>
                  {isAnalyzing && (
                    <div className="mt-4 p-4 bg-purple-50/70 border border-purple-100 rounded-xl space-y-2.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-purple-900 flex items-center gap-1.5">
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-600" />
                          กำลังประมวลผล {analyzeProgress}%
                        </span>
                        <span className="text-[11px] text-purple-600 font-mono font-semibold">
                          {analyzeProgress}%
                        </span>
                      </div>

                      {/* Progress Bar Container */}
                      <div className="w-full bg-purple-200/60 h-2.5 rounded-full overflow-hidden p-0.5">
                        <div
                          className="bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-500 h-full rounded-full transition-all duration-300 ease-out shadow-xs"
                          style={{ width: `${analyzeProgress}%` }}
                        ></div>
                      </div>

                      <p className="text-[11px] text-slate-500 text-center truncate">
                        {analyzeStepText}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ---- RIGHT: Staging data (only when scan result exists) ---- */}
        {scanResult && (
          <div className="space-y-4">
            {/* Engine badge */}
            {engineMsg && (
              <div className={`p-3 rounded-xl text-xs flex items-start gap-2 ${
                engine === 'gemini-vision'
                  ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                  : 'bg-amber-50 border border-amber-200 text-amber-800'
              }`}>
                {engine === 'gemini-vision'
                  ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  : <Info className="w-4 h-4 shrink-0 mt-0.5" />
                }
                {engineMsg}
              </div>
            )}

            {/* AI Audit & Verification Panel */}
            <div className={`p-4 rounded-2xl border transition-all ${
              liveAnomalies.length > 0
                ? 'bg-amber-50/70 border-amber-200/90 text-amber-950 shadow-sm'
                : 'bg-emerald-50/70 border-emerald-200/90 text-emerald-950'
            }`}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-black/5">
                <div className="flex items-center gap-2.5">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                    liveAnomalies.length > 0 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                  }`}>
                    {liveAnomalies.length > 0 ? <AlertCircle className="w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5 flex-wrap">
                      <span>การตรวจสอบความถูกต้องและข้อสังเกตจาก AI (AI Audit Report)</span>
                      {liveAnomalies.length > 0 ? (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-200 text-amber-900 font-semibold">
                          พบข้อสังเกต {liveAnomalies.length} จุด
                        </span>
                      ) : (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-200 text-emerald-900 font-semibold">
                          ✓ ผ่านการตรวจสอบ
                        </span>
                      )}
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      เทียบยอดคำนวณ (ยอดยกมา + รับ - จ่าย = คงเหลือ) และตรวจยอดคงเหลือของล็อตในคลัง
                    </p>
                  </div>
                </div>

                {liveAnomalies.some(a => a.expectedValue !== undefined) && (
                  <button
                    type="button"
                    onClick={handleAutoFixAnomalies}
                    className="self-start sm:self-auto px-3 py-1.5 bg-amber-600 hover:bg-amber-700 active:scale-95 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-sm transition"
                    title="ปรับปรุงยอดคงเหลือในแถวที่มีปัญหาให้ตรงตามหลักคำนวณทันที"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    <span>⚡ ปรับแก้ตัวเลขตามหลักคำนวณอัตโนมัติ</span>
                  </button>
                )}
              </div>

              {/* Warehouse Lot Remaining Badges / Summary */}
              {lotSummaries.length > 0 && (
                <div className="pt-3">
                  <span className="text-[11px] font-bold text-slate-700 block mb-1.5">
                    📦 สรุปยอดคงเหลือของล็อตในคลัง & ล็อตใหม่ในใบนี้:
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {lotSummaries.map((lot, idx) => (
                      <div
                        key={idx}
                        className={`text-xs px-2.5 py-1 rounded-lg border flex items-center gap-1.5 font-mono ${
                          lot.hasDiscrepancy
                            ? 'bg-rose-50 border-rose-300 text-rose-900 font-bold'
                            : lot.isExistingInDb
                            ? 'bg-blue-50 border-blue-200 text-blue-900'
                            : 'bg-emerald-50 border-emerald-200 text-emerald-900'
                        }`}
                        title={
                          lot.isExistingInDb
                            ? `มีในคลังเดิม: คงเหลือ ${lot.warehouseRemaining} ${scanResult.unit || 'kg'} (${lot.warehouseStatus})`
                            : `ล็อตใหม่: คงเหลือท้ายเอกสาร ${lot.scannedFinalBalance} ${scanResult.unit || 'kg'}`
                        }
                      >
                        <span className="font-bold text-slate-900">{lot.lotNumber}:</span>
                        {lot.isExistingInDb ? (
                          <span className="text-blue-700 font-semibold">
                            คลัง {lot.warehouseRemaining} {scanResult.unit || 'kg'}
                          </span>
                        ) : (
                          <span className="text-emerald-700 font-semibold">
                            ✨ ล็อตใหม่ ({lot.scannedFinalBalance} {scanResult.unit || 'kg'})
                          </span>
                        )}
                        {lot.scannedOutbound > 0 && (
                          <span className="text-slate-500 text-[10px]">
                            (จ่าย -{lot.scannedOutbound})
                          </span>
                        )}
                        {lot.hasDiscrepancy && (
                          <span className="text-rose-600 text-[10px] font-sans font-bold">⚠️ ยอดคำนวณไม่ตรง</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Anomaly list or all-clear notification */}
              {liveAnomalies.length > 0 ? (
                <div className="mt-3 pt-3 border-t border-black/5 space-y-1.5">
                  <span className="text-[11px] font-bold text-amber-900 block mb-1">
                    ⚠️ ข้อสังเกตความผิดปกติที่ AI ตรวจพบ:
                  </span>
                  {liveAnomalies.map((anom, idx) => (
                    <div
                      key={idx}
                      className={`p-2.5 rounded-xl text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 border ${
                        anom.severity === 'error'
                          ? 'bg-rose-50/90 border-rose-200 text-rose-900'
                          : anom.severity === 'warning'
                          ? 'bg-amber-50/90 border-amber-200 text-amber-900'
                          : 'bg-blue-50/90 border-blue-200 text-blue-900'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <span className="shrink-0 mt-0.5">
                          {anom.severity === 'error' ? '❌' : anom.severity === 'warning' ? '⚠️' : 'ℹ️'}
                        </span>
                        <p className="font-medium leading-relaxed">{anom.message}</p>
                      </div>
                      {anom.rowId && anom.expectedValue !== undefined && (
                        <button
                          type="button"
                          onClick={() => handleFixSingleAnomaly(anom.rowId!, anom.expectedValue!)}
                          className="shrink-0 self-end sm:self-auto px-2 py-1 bg-white hover:bg-amber-100 text-amber-900 border border-amber-300 rounded font-semibold text-[11px] transition shadow-2xs"
                          title={`ปรับแก้คงเหลือแถวนี้เป็น ${anom.expectedValue}`}
                        >
                          แก้เป็น {anom.expectedValue}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-3 pt-2 text-xs text-emerald-800 flex items-center gap-1.5 font-medium">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>AI ตรวจสอบความถูกต้องเรียบร้อย: ยอดยกมา / รับ / จ่าย / คงเหลือ และประวัติล็อตในคลังตรงกันสมบูรณ์</span>
                </div>
              )}
            </div>

            {/* Material info */}
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-800">ข้อมูลวัตถุดิบ (แก้ไขได้)</h3>
                <span className="text-xs text-slate-400">กรุณาตรวจสอบก่อนบันทึก</span>
              </div>
              <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2 p-3 bg-purple-50/60 border border-purple-200/80 rounded-xl flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex-1">
                    <label className="text-xs font-bold text-purple-900 block mb-1">
                      📦 เป็นวัตถุดิบเดิมที่มีในคลังอยู่แล้วหรือไม่?
                    </label>
                    <select
                      value={selectedMaterialId}
                      onChange={e => handleSelectMaterial(e.target.value, scanResult)}
                      className="w-full px-3 py-2 text-sm font-semibold border border-purple-200 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none bg-white text-slate-800"
                    >
                      <option value="">-- ไม่ใช่ / สร้างวัตถุดิบใหม่ --</option>
                      {materials.map(m => (
                        <option key={m.id} value={m.id}>
                          {m.code} — {m.name} ({m.baseUnit}) {m.section ? `[โซน: ${m.section.name}]` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  {selectedMaterialId && (
                    <div className="text-xs text-purple-700 bg-white/80 px-3 py-2 rounded-lg border border-purple-100 flex items-center gap-1.5 self-stretch sm:self-auto">
                      <CheckCircle2 className="w-4 h-4 text-purple-600 shrink-0" />
                      <span>ใช้ชื่อ, หน่วยนับ และโซนคลังเดิมอัตโนมัติ</span>
                    </div>
                  )}
                </div>

                <div className="sm:col-span-2">
                  <label className="text-xs font-semibold text-slate-600 block mb-1">
                    ชื่อวัตถุดิบ {selectedMaterialId && <span className="text-purple-600 font-normal">(อ้างอิงจากคลังเดิม)</span>}
                  </label>
                  <input
                    type="text"
                    value={scanResult.materialName}
                    disabled={!!selectedMaterialId}
                    onChange={e => setScanResult({ ...scanResult, materialName: e.target.value })}
                    className={`w-full px-3 py-2 text-sm font-bold border rounded-lg focus:ring-2 focus:ring-purple-500 outline-none ${
                      selectedMaterialId ? 'bg-slate-100 border-slate-200 text-slate-700 cursor-not-allowed' : 'bg-white border-slate-200'
                    }`}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-600 block mb-1">หน่วยนับ</label>
                  <input
                    type="text"
                    value={scanResult.unit}
                    disabled={!!selectedMaterialId}
                    onChange={e => setScanResult({ ...scanResult, unit: e.target.value })}
                    className={`w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-purple-500 outline-none ${
                      selectedMaterialId ? 'bg-slate-100 border-slate-200 text-slate-700 cursor-not-allowed' : 'bg-white border-slate-200'
                    }`}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-600 block mb-1">
                    โซนคลัง {selectedMaterialId && <span className="text-purple-600 font-normal">(โซนเดิม)</span>}
                  </label>
                  <select
                    value={selectedSectionId}
                    disabled={!!selectedMaterialId}
                    onChange={e => setSelectedSectionId(e.target.value)}
                    className={`w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-purple-500 outline-none ${
                      selectedMaterialId ? 'bg-slate-100 border-slate-200 text-slate-700 cursor-not-allowed' : 'bg-white border-slate-200'
                    }`}
                  >
                    <option value="">-- ไม่ระบุโซน --</option>
                    {sections.map(s => (
                      <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-slate-600">เลขที่ของฟอร์ม / ใบการ์ด</label>
                    {scanResult.formYearInfo && (
                      <span className="text-[10px] font-bold text-purple-700 bg-purple-100 px-2 py-0.5 rounded-full border border-purple-200">
                        {scanResult.formYearInfo}
                      </span>
                    )}
                  </div>
                  <input
                    type="text"
                    value={scanResult.cardNo}
                    placeholder="เช่น 01/26 หรือ 006/26"
                    onChange={e => handleCardNoChange(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono font-bold text-slate-800 border border-slate-200 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">
                    เช่น <span className="font-mono font-semibold text-purple-700">01/26</span> = ใบที่ 1 ของปี ค.ศ. 2026
                  </p>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-600 block mb-1">
                    ปีที่ผลิต / ปีของฟอร์ม (ค.ศ.)
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      value={scanResult.formYear ?? ''}
                      placeholder="เช่น 2026"
                      onChange={e => {
                        const val = e.target.value.trim();
                        const y = val ? parseInt(val) : null;
                        updateFormYear(y);
                      }}
                      className="w-full px-3 py-2 text-sm font-bold font-mono text-purple-900 border border-slate-200 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
                    />
                    <span className="absolute right-3 top-2.5 text-[11px] font-bold text-slate-400">
                      ค.ศ.
                    </span>
                  </div>
                  <p className="text-[10px] text-purple-600 font-medium mt-1">
                    ✨ เมื่อเปลี่ยนปี ระบบจะแก้วันผลิตของทุกรายการในตารางให้อัตโนมัติ
                  </p>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-600 block mb-1">ผู้จัดทำ</label>
                  <input
                    type="text"
                    value={scanResult.creator}
                    placeholder="เช่น แสงอรุณ ศรีสุข"
                    onChange={e => setScanResult({ ...scanResult, creator: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-600 block mb-1">ตำแหน่ง</label>
                  <input
                    type="text"
                    value={scanResult.position}
                    placeholder="เช่น หัวหน้าแผนกคลังสินค้า"
                    onChange={e => setScanResult({ ...scanResult, position: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Staging table & cards */}
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-4 sm:px-5 py-3 border-b border-slate-100 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-slate-800">
                    รายการเคลื่อนไหว ({scanResult.rows.length} แถว)
                  </h3>
                  {/* View Mode Toggle: Cards vs Table */}
                  <div className="flex items-center bg-slate-200/70 p-0.5 rounded-lg border border-slate-200">
                    <button
                      type="button"
                      onClick={() => setViewMode('cards')}
                      className={`px-2 py-1 rounded-md text-[11px] font-bold flex items-center gap-1 transition ${
                        viewMode === 'cards' ? 'bg-white text-purple-700 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                      }`}
                      title="มุมมองการ์ด (เหมาะกับมือถือ)"
                    >
                      <Grid className="w-3 h-3" />
                      <span className="hidden sm:inline">การ์ด</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode('table')}
                      className={`px-2 py-1 rounded-md text-[11px] font-bold flex items-center gap-1 transition ${
                        viewMode === 'table' ? 'bg-white text-purple-700 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                      }`}
                      title="มุมมองตารางเต็ม"
                    >
                      <List className="w-3 h-3" />
                      <span className="hidden sm:inline">ตาราง</span>
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  {imageURL && (
                    <button
                      type="button"
                      onClick={() => setIsInspectorOpen(true)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition"
                    >
                      <Focus className="w-3.5 h-3.5" />
                      <span>ส่องภาพเทียบ</span>
                    </button>
                  )}
                  <button onClick={addRow} className="inline-flex items-center gap-1 text-xs font-semibold text-purple-600 hover:text-purple-800 px-2 py-1 rounded-lg hover:bg-purple-50 transition">
                    <Plus className="w-3.5 h-3.5" />เพิ่มแถว
                  </button>
                </div>
              </div>

              {/* View 1: Mobile Cards View */}
              {viewMode === 'cards' ? (
                <div className="p-3 sm:p-4 space-y-3 max-h-[60vh] overflow-y-auto bg-slate-50/60">
                  {scanResult.rows.map((row, idx) => (
                    <div
                      key={row.id}
                      className={`bg-white border rounded-2xl p-3.5 shadow-2xs transition ${
                        highlightedRowId === row.id ? 'border-purple-400 ring-2 ring-purple-100' : 'border-slate-200'
                      }`}
                    >
                      {/* Card Header */}
                      <div className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-slate-100">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="w-6 h-6 rounded-full bg-purple-100 text-purple-700 font-bold font-mono text-xs flex items-center justify-center shrink-0">
                            {idx + 1}
                          </span>
                          <span className="text-xs font-bold text-slate-700">Lot:</span>
                          <input
                            type="text"
                            value={row.lotNumber}
                            placeholder="Lot No."
                            onChange={e => updateRow(row.id, 'lotNumber', e.target.value)}
                            className="px-2 py-1 bg-purple-50/50 border border-purple-200 rounded-lg text-xs font-mono font-bold text-purple-900 w-28 focus:ring-1 focus:ring-purple-500 outline-none"
                          />
                          {(() => {
                            const lotKey = String(row.lotNumber || '').toUpperCase().trim();
                            const existing = lotKey ? (scanResult.existingLots || []).find(l => l.lotNumber.toUpperCase().trim() === lotKey) : null;
                            if (!lotKey) return null;
                            return existing ? (
                              <span className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded font-mono font-semibold" title={`ยอดคงเหลือในคลัง: ${existing.currentRemaining} ${scanResult.unit || 'kg'} (${existing.status})`}>
                                📦 คลัง: {existing.currentRemaining}
                              </span>
                            ) : (
                              <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded font-mono font-medium">
                                ✨ ล็อตใหม่
                              </span>
                            );
                          })()}
                        </div>
                        <div className="flex items-center gap-1">
                          {imageURL && (
                            <button
                              type="button"
                              onClick={() => {
                                setHighlightedRowId(row.id);
                                setIsInspectorOpen(true);
                              }}
                              className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-lg text-xs transition"
                              title="ส่องภาพเทียบแถวนี้"
                            >
                              <Focus className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => deleteRow(row.id)}
                            className="p-1.5 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                            title="ลบแถวนี้"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Date & EXP Date */}
                      <div className="grid grid-cols-2 gap-2 mb-2.5">
                        <div>
                          <label className="text-[10px] font-semibold text-slate-500 block mb-0.5">วันที่ผลิต / นำเข้า</label>
                          <input
                            type="text"
                            value={row.date}
                            placeholder="วว/ดด/ค.ศ."
                            onChange={e => updateRow(row.id, 'date', e.target.value)}
                            onBlur={e => updateRow(row.id, 'date', normalizeDateToCE(e.target.value))}
                            className="w-full px-2.5 py-1.5 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:border-purple-500 outline-none"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-semibold text-amber-700 block mb-0.5">วันหมดอายุ (EXP)</label>
                          <input
                            type="text"
                            value={row.expDate}
                            placeholder="DD-MM-YYYY"
                            onChange={e => updateRow(row.id, 'expDate', e.target.value)}
                            onBlur={e => updateRow(row.id, 'expDate', normalizeExpDateToCE(e.target.value))}
                            className="w-full px-2.5 py-1.5 text-xs font-mono bg-amber-50/50 border border-amber-200 text-amber-900 rounded-lg focus:bg-white focus:border-amber-500 outline-none"
                          />
                        </div>
                      </div>

                      {/* Quantities: Inbound / Outbound / Balance */}
                      <div className="grid grid-cols-3 gap-2 p-2 bg-slate-50 rounded-xl mb-2.5">
                        <div>
                          <span className="text-[10px] font-bold text-emerald-700 block mb-0.5">รับเข้า (+)</span>
                          <input
                            type="number"
                            value={row.inboundQty === 0 ? '' : row.inboundQty}
                            placeholder="0"
                            onChange={e => updateRow(row.id, 'inboundQty', parseFloat(e.target.value) || 0)}
                            className="w-full px-2 py-1 bg-white border border-emerald-200 text-emerald-700 font-bold text-xs text-right rounded-lg focus:ring-1 focus:ring-emerald-500 outline-none"
                          />
                        </div>
                        <div>
                          <span className="text-[10px] font-bold text-rose-600 block mb-0.5">จ่ายออก (-)</span>
                          <input
                            type="number"
                            value={row.outboundQty === 0 ? '' : row.outboundQty}
                            placeholder="0"
                            onChange={e => updateRow(row.id, 'outboundQty', parseFloat(e.target.value) || 0)}
                            className="w-full px-2 py-1 bg-white border border-rose-200 text-rose-600 font-bold text-xs text-right rounded-lg focus:ring-1 focus:ring-rose-500 outline-none"
                          />
                        </div>
                        <div>
                          <span className="text-[10px] font-bold text-purple-800 block mb-0.5">คงเหลือ/Lot</span>
                          <input
                            type="number"
                            value={row.balanceQty === 0 ? '' : row.balanceQty}
                            placeholder="0"
                            onChange={e => updateRow(row.id, 'balanceQty', parseFloat(e.target.value) || 0)}
                            className="w-full px-2 py-1 bg-white border border-purple-200 text-slate-800 font-bold text-xs text-right rounded-lg focus:ring-1 focus:ring-purple-500 outline-none"
                          />
                        </div>
                      </div>

                      {/* Total & Remarks */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-slate-400 shrink-0">รวมสะสม:</span>
                          <input
                            type="number"
                            value={row.totalQty === 0 ? '' : row.totalQty}
                            placeholder="0"
                            onChange={e => updateRow(row.id, 'totalQty', parseFloat(e.target.value) || 0)}
                            className="w-full px-2 py-1 bg-slate-50 border border-slate-200 text-slate-600 text-xs text-right rounded-lg outline-none"
                          />
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-slate-400 shrink-0">หมายเหตุ:</span>
                          <input
                            type="text"
                            value={row.remarks}
                            placeholder="บันทึกเพิ่มเติม"
                            onChange={e => updateRow(row.id, 'remarks', e.target.value)}
                            className="w-full px-2 py-1 bg-slate-50 border border-slate-200 text-slate-700 text-xs rounded-lg outline-none"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                /* View 2: Horizontal Full Table */
                <div className="overflow-x-auto max-h-[55vh] overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 border-b border-slate-100 sticky top-0">
                      <tr>
                        {['#', 'วันที่', 'Lot No.', 'รับเข้า', 'จ่ายออก', 'คงเหลือ/Lot', 'รวมทั้งหมด', 'EXP Date', 'หมายเหตุ', ''].map(h => (
                          <th key={h} className="px-2 py-2 text-left font-semibold text-slate-600 whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {scanResult.rows.map((row, idx) => (
                        <tr key={row.id} className="hover:bg-purple-50/40 transition">
                          {/* Row Number */}
                          <td className="px-2 py-1.5 text-center text-slate-400 font-mono text-[11px] w-8">
                            {idx + 1}
                          </td>
                          {/* Date */}
                          <td className="px-1.5 py-1">
                            <input
                              type="text"
                              value={row.date}
                              placeholder="วว/ดด/ค.ศ."
                              onChange={e => updateRow(row.id, 'date', e.target.value)}
                              onBlur={e => updateRow(row.id, 'date', normalizeDateToCE(e.target.value))}
                              className="w-24 px-2 py-1 bg-slate-50 hover:bg-white focus:bg-white border border-transparent hover:border-slate-200 focus:border-purple-500 rounded text-xs font-mono outline-none transition"
                              title="วันที่ (ระบุเป็นปี ค.ศ. เช่น 07/08/2026)"
                            />
                          </td>
                          {/* Lot */}
                          <td className="px-1.5 py-1">
                            <div className="flex flex-col gap-0.5">
                              <input
                                type="text"
                                value={row.lotNumber}
                                placeholder="เช่น 100726"
                                onChange={e => updateRow(row.id, 'lotNumber', e.target.value)}
                                className="w-24 px-2 py-1 bg-slate-50 hover:bg-white focus:bg-white border border-transparent hover:border-slate-200 focus:border-purple-500 rounded text-xs font-bold font-mono text-purple-900 outline-none transition"
                              />
                              {(() => {
                                const lotKey = String(row.lotNumber || '').toUpperCase().trim();
                                const existing = lotKey ? (scanResult.existingLots || []).find(l => l.lotNumber.toUpperCase().trim() === lotKey) : null;
                                if (!lotKey) return null;
                                return existing ? (
                                  <span
                                    className="text-[9px] bg-blue-50 text-blue-700 border border-blue-200 px-1 py-0.2 rounded font-mono text-center font-semibold truncate max-w-[96px]"
                                    title={`ยอดคงเหลือในคลัง: ${existing.currentRemaining} ${scanResult.unit || 'kg'} (${existing.status})`}
                                  >
                                    คลัง: {existing.currentRemaining}
                                  </span>
                                ) : (
                                  <span className="text-[9px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-1 py-0.2 rounded font-mono text-center font-medium max-w-[96px]">
                                    ล็อตใหม่
                                  </span>
                                );
                              })()}
                            </div>
                          </td>
                          {/* Inbound */}
                          <td className="px-1.5 py-1">
                            <input
                              type="number"
                              value={row.inboundQty === 0 ? '' : row.inboundQty}
                              placeholder="0"
                              onChange={e => updateRow(row.id, 'inboundQty', parseFloat(e.target.value) || 0)}
                              className="w-20 px-2 py-1 bg-slate-50 hover:bg-white focus:bg-white border border-transparent hover:border-slate-200 focus:border-emerald-500 rounded text-xs font-semibold text-emerald-700 text-right outline-none transition"
                            />
                          </td>
                          {/* Outbound */}
                          <td className="px-1.5 py-1">
                            <input
                              type="number"
                              value={row.outboundQty === 0 ? '' : row.outboundQty}
                              placeholder="0"
                              onChange={e => updateRow(row.id, 'outboundQty', parseFloat(e.target.value) || 0)}
                              className="w-20 px-2 py-1 bg-slate-50 hover:bg-white focus:bg-white border border-transparent hover:border-slate-200 focus:border-rose-500 rounded text-xs font-semibold text-rose-600 text-right outline-none transition"
                            />
                          </td>
                          {/* Balance */}
                          <td className="px-1.5 py-1">
                            <input
                              type="number"
                              value={row.balanceQty === 0 ? '' : row.balanceQty}
                              placeholder="0"
                              onChange={e => updateRow(row.id, 'balanceQty', parseFloat(e.target.value) || 0)}
                              className="w-20 px-2 py-1 bg-slate-50 hover:bg-white focus:bg-white border border-transparent hover:border-slate-200 focus:border-purple-500 rounded text-xs text-slate-800 text-right outline-none transition"
                            />
                          </td>
                          {/* Total */}
                          <td className="px-1.5 py-1">
                            <input
                              type="number"
                              value={row.totalQty === 0 ? '' : row.totalQty}
                              placeholder="0"
                              onChange={e => updateRow(row.id, 'totalQty', parseFloat(e.target.value) || 0)}
                              className="w-20 px-2 py-1 bg-slate-50 hover:bg-white focus:bg-white border border-transparent hover:border-slate-200 focus:border-purple-500 rounded text-xs text-slate-500 text-right outline-none transition"
                            />
                          </td>
                          {/* EXP Date */}
                          <td className="px-1.5 py-1">
                            <input
                              type="text"
                              value={row.expDate}
                              placeholder="DD-MM-YYYY"
                              onChange={e => updateRow(row.id, 'expDate', e.target.value)}
                              onBlur={e => updateRow(row.id, 'expDate', normalizeExpDateToCE(e.target.value))}
                              className="w-28 px-2 py-1 bg-amber-50/60 hover:bg-white focus:bg-white border border-transparent hover:border-amber-300 focus:border-amber-500 rounded text-xs font-mono text-amber-900 outline-none transition"
                              title="วันหมดอายุ (ปี ค.ศ. เช่น 19-08-2027)"
                            />
                          </td>
                          {/* Remarks */}
                          <td className="px-1.5 py-1">
                            <input
                              type="text"
                              value={row.remarks}
                              placeholder="หมายเหตุ"
                              onChange={e => updateRow(row.id, 'remarks', e.target.value)}
                              className="w-32 px-2 py-1 bg-slate-50 hover:bg-white focus:bg-white border border-transparent hover:border-slate-200 focus:border-purple-500 rounded text-xs text-slate-600 outline-none transition"
                            />
                          </td>
                          {/* Actions */}
                          <td className="px-2 py-1.5 text-center">
                            <button
                              type="button"
                              onClick={() => deleteRow(row.id)}
                              className="p-1 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded transition"
                              title="ลบแถวนี้"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Commit button */}
            {!commitDone && (
              <button
                onClick={handleCommit}
                disabled={isCommitting || scanResult.rows.length === 0}
                className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition shadow-sm shadow-emerald-200"
              >
                {isCommitting
                  ? <><Loader2 className="w-4 h-4 animate-spin" />กำลังบันทึกลงฐานข้อมูล...</>
                  : <><Database className="w-4 h-4" />บันทึก {scanResult.rows.length} รายการลงฐานข้อมูล</>
                }
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Floating Image Inspector Button (เปิดเมื่อมีรูปและกำลังดูผล) ── */}
      {imageURL && scanResult && (
        <aside aria-label="เครื่องมือตรวจทานภาพ" className="fixed bottom-20 md:bottom-6 right-4 sm:right-6 z-40">
          <button
            type="button"
            onClick={() => setIsInspectorOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white rounded-full shadow-lg shadow-purple-500/30 transition transform hover:scale-105 active:scale-95 border border-white/20"
          >
            <Focus className="w-4 h-4 text-white animate-pulse" />
            <span className="text-xs font-bold">ส่องภาพเทียบ</span>
            <span className="text-[10px] px-1.5 py-0.5 bg-white/20 rounded-full font-mono font-bold">
              {scanResult.rows.length} แถว
            </span>
          </button>
        </aside>
      )}

      {/* ── Modal: ตรวจทานภาพต้นฉบับเทียบกับข้อมูล (Inspector with Zoom/Pan) ── */}
      {isInspectorOpen && imageURL && (
        <div className="fixed inset-0 bg-slate-900/75 z-50 flex items-center justify-center p-3 sm:p-6 backdrop-blur-xs">
          <div className="bg-white rounded-3xl max-w-4xl w-full h-[85vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
            {/* Inspector Header */}
            <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center">
                  <Focus className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs sm:text-sm font-bold text-slate-800">
                    ตรวจทานภาพต้นฉบับ (Image Inspector)
                  </h4>
                  <p className="text-[10px] text-slate-400">
                    ซูมส่องตัวเลขและลายมือเพื่อเทียบกับข้อมูลในตาราง
                  </p>
                </div>
              </div>

              {/* Zoom Controls */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setInspectorZoom(z => Math.max(60, z - 25))}
                  className="p-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-700"
                  title="ซูมออก"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <span className="text-xs font-mono font-bold text-slate-700 min-w-10 text-center">
                  {inspectorZoom}%
                </span>
                <button
                  type="button"
                  onClick={() => setInspectorZoom(z => Math.min(300, z + 25))}
                  className="p-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-700"
                  title="ซูมเข้า"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setInspectorZoom(100)}
                  className="p-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-700"
                  title="รีเซ็ต 100%"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
                <div className="w-px h-5 bg-slate-200 mx-1" />
                <button
                  type="button"
                  onClick={() => setIsInspectorOpen(false)}
                  className="p-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 transition"
                  title="ปิดหน้าต่าง"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Inspector Body: Scrollable & Zoomable Image View */}
            <div className="flex-1 overflow-auto bg-slate-900/95 p-4 flex items-center justify-center cursor-grab active:cursor-grabbing select-none">
              <img
                src={imageURL}
                alt="Original Stock Card"
                style={{ width: `${inspectorZoom}%`, maxWidth: 'none' }}
                className="rounded-lg shadow-2xl transition-[width] duration-150"
                draggable={false}
              />
            </div>

            {/* Inspector Footer: Quick tips */}
            <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50 flex items-center justify-between text-[11px] text-slate-500 shrink-0">
              <span>💡 เลื่อนนิ้วหรือเลื่อนเมาส์เพื่อตรวจเช็คตัวเลขแต่ละแถว</span>
              <button
                type="button"
                onClick={() => setIsInspectorOpen(false)}
                className="px-3.5 py-1 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg font-bold"
              >
                ปิดหน้าต่าง
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: ถ่ายภาพผ่านกล้องสดในเว็บพร้อมกรอบช่วยเล็ง ── */}
      {isWebcamOpen && (
        <div className="fixed inset-0 bg-black/90 z-50 flex flex-col items-center justify-between p-4 sm:p-6 backdrop-blur-sm">
          {/* Top Bar */}
          <div className="w-full max-w-2xl flex items-center justify-between text-white z-10">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
              <span className="text-sm font-bold">กล้องถ่าย Stock Card</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleFacingMode}
                className="p-2.5 rounded-full bg-white/20 hover:bg-white/30 text-white backdrop-blur-md transition active:scale-95"
                title="สลับกล้องหน้า/หลัง"
              >
                <RotateCcw className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={stopWebcam}
                className="p-2.5 rounded-full bg-white/20 hover:bg-white/30 text-white backdrop-blur-md transition active:scale-95"
                title="ปิดกล้อง"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Video Container with Target Guide Frame */}
          <div className="relative w-full max-w-2xl flex-1 my-3 flex items-center justify-center overflow-hidden rounded-3xl bg-black border border-white/10 shadow-2xl">
            {webcamError ? (
              <div className="p-6 text-center text-rose-300 max-w-md">
                <AlertCircle className="w-10 h-10 mx-auto mb-2 text-rose-400" />
                <p className="font-bold text-sm mb-1">ไม่สามารถเปิดกล้องได้</p>
                <p className="text-xs text-rose-200/80 mb-4">{webcamError}</p>
                <button
                  type="button"
                  onClick={() => startWebcam(webcamFacingMode)}
                  className="px-4 py-2 bg-white/20 hover:bg-white/30 rounded-xl text-xs font-bold text-white transition"
                >
                  ลองใหม่อีกครั้ง
                </button>
              </div>
            ) : (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover rounded-3xl"
                />

                {/* Guide Frame Overlay */}
                <div className="absolute inset-4 sm:inset-8 border-2 border-dashed border-emerald-400/80 rounded-2xl pointer-events-none flex flex-col justify-between p-3 shadow-inner">
                  <div className="flex justify-between items-start">
                    <span className="text-[10px] font-bold text-emerald-300 bg-black/60 px-2 py-0.5 rounded-md backdrop-blur-xs">
                      กรอบใบสต็อกการ์ด
                    </span>
                    <span className="text-[10px] font-mono text-emerald-300/80 bg-black/60 px-1.5 py-0.5 rounded-md">
                      HD
                    </span>
                  </div>
                  <div className="text-center">
                    <span className="inline-block text-xs font-medium text-white/90 bg-black/60 px-3 py-1 rounded-full backdrop-blur-xs">
                      วางใบการ์ดให้ขนานและเต็มกรอบ แสงสว่างชัดเจน
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Bottom Bar: Shutter Button */}
          <div className="w-full max-w-2xl flex items-center justify-center py-2 z-10">
            <button
              type="button"
              onClick={captureWebcam}
              className="w-18 h-18 sm:w-20 sm:h-20 rounded-full border-4 border-white bg-white/30 hover:bg-white/50 active:scale-95 flex items-center justify-center p-1.5 transition shadow-lg"
              title="กดเพื่อถ่ายภาพ"
            >
              <div className="w-full h-full rounded-full bg-white flex items-center justify-center text-purple-600 shadow-sm">
                <Camera className="w-7 h-7" />
              </div>
            </button>
          </div>
        </div>
      )}

      {/* ── Modal: เพิ่ม Gemini API Key สำรองลงใน DB (ไม่ทับอันเดิม) ── */}
      {showKeyModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <span>🔑 เพิ่ม Gemini API Key สำรอง</span>
                </h3>
                <p className="text-xs text-amber-700 mt-1">{keyModalReason}</p>
              </div>
              <button onClick={closeKeyModal} className="text-slate-400 hover:text-slate-600 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 bg-purple-50 border border-purple-100 rounded-xl text-xs text-purple-900 mb-3 space-y-2">
              <div>
                ระบบจะบันทึกคีย์นี้เป็น <strong>คีย์สำรองเพิ่มเข้าไปในฐานข้อมูล (ไม่ลบ/ไม่ทับคีย์เดิม)</strong> หากคีย์ก่อนหน้าหมดโควตาหรือติดขัด ระบบจะสลับมาใช้คีย์นี้อัตโนมัติ
              </div>
              {sharedKeysCount > 0 && (
                <div className="text-[11px] text-purple-700 font-medium pt-1 border-t border-purple-200/60 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-purple-600 shrink-0" />
                  <span>มีคีย์สำรองในระบบแล้ว <strong>{sharedKeysCount} คีย์</strong> {maskedKeys.length > 0 && `(${maskedKeys.join(', ')})`}</span>
                </div>
              )}
            </div>

            <div className="text-xs text-slate-500 mb-2">
              สร้าง API Key ฟรีได้ที่{' '}
              <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="underline font-semibold text-purple-600 hover:text-purple-700">
                Google AI Studio ↗
              </a>
            </div>

            <input
              type="password"
              autoComplete="off"
              placeholder="วาง Gemini API Key สำรองที่นี่ (AIzaSy...)"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              className="w-full px-3 py-2.5 text-sm font-mono border border-slate-200 rounded-xl focus:ring-2 focus:ring-purple-500 outline-none"
            />
            {keyError && <p className="text-xs text-rose-600 mt-2">{keyError}</p>}

            <div className="flex gap-2.5 mt-4">
              <button
                onClick={closeKeyModal}
                className="flex-1 px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                onClick={handleSaveKeyAndRetry}
                disabled={isSavingKey || !keyInput.trim()}
                className="flex-1 px-4 py-2 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50 rounded-xl transition shadow-xs cursor-pointer"
              >
                {isSavingKey ? 'กำลังตรวจสอบ...' : 'เพิ่มเป็นคีย์สำรองและสแกนต่อ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
