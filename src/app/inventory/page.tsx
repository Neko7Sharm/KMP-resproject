'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import {
  Package,
  Search,
  Plus,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Clock,
  ScanLine,
  ArrowDownToLine,
  CheckCircle2,
  Trash2,
  Edit2,
  X,
  MoreVertical,
  ToggleLeft,
  ToggleRight,
  Loader2,
} from 'lucide-react';
import { formatDate } from '@/lib/dateUtils';
import { useAuth } from '@/context/AuthContext';

// ─── Types ───────────────────────────────────────────────────────────────────

interface MaterialLot {
  id: string;
  lotNumber: string;
  receiveDate: string;
  mfgDate: string | null;
  expDate: string | null;
  initialQuantity: number;
  quantityRemaining: number;
  costPerUnit: number;
  status: string;
}

interface Material {
  id: string;
  code: string;
  name: string;
  baseUnit: string;
  minSafetyStock: number;
  totalStock: number;
  isLowStock: boolean;
  expiringSoonCount: number;
  section: { id: string; code: string; name: string } | null;
  lots: MaterialLot[];
}

interface Section {
  id: string;
  code: string;
  name: string;
  activeLotsCount?: number;
  materialCount?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────


function getExpirationBadge(expDateStr: string | null) {
  if (!expDateStr) return <span className="text-slate-400 text-xs">-</span>;
  const exp = new Date(expDateStr);
  const now = new Date();
  const diffDays = Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 0)
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-100 text-rose-800">
        หมดอายุแล้ว ({formatDate(expDateStr)})
      </span>
    );
  if (diffDays <= 90)
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-100 text-amber-800">
        เหลือ {diffDays} วัน ({formatDate(expDateStr)})
      </span>
    );
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] bg-emerald-50 text-emerald-700">
      {formatDate(expDateStr)}
    </span>
  );
}

function getLotRowClass(lot: MaterialLot) {
  if (lot.quantityRemaining <= 0) return 'bg-slate-50/70 opacity-70';
  if (lot.expDate && new Date(lot.expDate) < new Date()) return 'bg-rose-50/30';
  return '';
}

// ─── Dropdown Action Menu ─────────────────────────────────────────────────────

function ActionMenu({
  onEdit,
  onInbound,
  onDelete,
  isOpen,
  onToggle,
}: {
  onEdit: () => void;
  onInbound: () => void;
  onDelete: () => void;
  isOpen?: boolean;
  onToggle?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isOpen !== undefined ? isOpen : internalOpen;
  const setOpen = (v: boolean | ((prev: boolean) => boolean)) => {
    const nextVal = typeof v === 'function' ? v(open) : v;
    if (onToggle) onToggle(nextVal);
    else setInternalOpen(nextVal);
  };
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        if (onToggle) onToggle(false);
        else setInternalOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onToggle]);

  return (
    <div ref={ref} className={`relative ${open ? 'z-50' : ''}`} onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`p-1.5 rounded-lg transition ${
          open ? 'text-slate-800 bg-slate-100 ring-2 ring-slate-200' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'
        }`}
        title="จัดการ"
      >
        <MoreVertical className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-48 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 z-50 animate-in fade-in zoom-in-95 duration-100">
          <button
            onClick={() => { setOpen(false); onEdit(); }}
            className="flex items-center gap-2.5 w-full px-4 py-2.5 text-xs sm:text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
          >
            <Edit2 className="w-4 h-4 text-slate-400" />
            แก้ไขข้อมูล
          </button>
          <button
            onClick={() => { setOpen(false); onInbound(); }}
            className="flex items-center gap-2.5 w-full px-4 py-2.5 text-xs sm:text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
          >
            <ArrowDownToLine className="w-4 h-4 text-blue-500" />
            รับเข้าล็อตใหม่
          </button>
          <div className="my-1 border-t border-slate-100" />
          <button
            onClick={() => { setOpen(false); onDelete(); }}
            className="flex items-center gap-2.5 w-full px-4 py-2.5 text-xs sm:text-sm font-medium text-rose-600 hover:bg-rose-50 transition"
          >
            <Trash2 className="w-4 h-4 text-rose-500" />
            ลบวัตถุดิบนี้
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Delete Confirmation Modal ────────────────────────────────────────────────

function DeleteConfirmModal({
  material,
  onConfirm,
  onCancel,
  isDeleting,
}: {
  material: Material;
  onConfirm: () => void;
  onCancel: () => void;
  isDeleting: boolean;
}) {
  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-xl border border-slate-200">
        <div className="flex flex-col items-center text-center">
          <div className="w-14 h-14 rounded-full bg-rose-100 flex items-center justify-center mb-4">
            <AlertTriangle className="w-7 h-7 text-rose-600" />
          </div>
          <h3 className="text-base font-bold text-slate-900">ยืนยันการลบ</h3>
          <p className="text-sm text-slate-600 mt-1">
            <strong>"{material.name}"</strong> ({material.code})
          </p>
        </div>
        <div className="mt-4 p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 leading-relaxed">
          ⚠️ การลบจะลบ <strong>{material.lots.length} ล็อต</strong> และประวัติการเคลื่อนไหวทั้งหมดที่เกี่ยวข้องออกถาวร ไม่สามารถกู้คืนได้
        </div>
        <div className="flex gap-3 mt-5">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2 text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition"
          >
            ยกเลิก
          </button>
          <button
            onClick={onConfirm}
            disabled={isDeleting}
            className="flex-1 px-4 py-2 text-sm font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-xl transition disabled:opacity-60 flex items-center justify-center gap-1.5"
          >
            {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            {isDeleting ? 'กำลังลบ...' : 'ยืนยันการลบ'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function InventoryPage() {
  const { canEdit, user } = useAuth();
  const [materials, setMaterials] = useState<Material[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [selectedSection, setSelectedSection] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showInStockOnly, setShowInStockOnly] = useState(false);
  const [expandedMaterials, setExpandedMaterials] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(true);

  // Add Material Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newUnit, setNewUnit] = useState('kg');
  const [newSectionId, setNewSectionId] = useState('');
  const [newMinStock, setNewMinStock] = useState('0');
  const [hasInitialLot, setHasInitialLot] = useState(false);
  const [initialLotNumber, setInitialLotNumber] = useState('');
  const [initialQuantity, setInitialQuantity] = useState('');
  const [initialExpDate, setInitialExpDate] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Active ActionMenu dropdown tracking
  const [openMenuMaterialId, setOpenMenuMaterialId] = useState<string | null>(null);

  // Edit Material Modal
  const [editingMaterial, setEditingMaterial] = useState<Material | null>(null);
  const [editCode, setEditCode] = useState('');
  const [editName, setEditName] = useState('');
  const [editUnit, setEditUnit] = useState('kg');
  const [editSectionId, setEditSectionId] = useState('');
  const [editMinStock, setEditMinStock] = useState('0');
  const [isUpdating, setIsUpdating] = useState(false);

  // Delete Material Modal
  const [deletingMaterial, setDeletingMaterial] = useState<Material | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Edit Lot Modal
  const [editingLot, setEditingLot] = useState<{
    materialId: string; materialName: string; baseUnit: string; lot: MaterialLot;
  } | null>(null);
  const [editLotNumber, setEditLotNumber] = useState('');
  const [editLotQuantity, setEditLotQuantity] = useState('');
  const [editLotExpDate, setEditLotExpDate] = useState('');
  const [isUpdatingLot, setIsUpdatingLot] = useState(false);

  // router for inbound navigation
  const navigateToInbound = (materialId: string) => {
    window.location.href = `/inbound?materialId=${materialId}`;
  };

  useEffect(() => { fetchData(); }, [selectedSection, searchQuery]);

  async function fetchData() {
    setIsLoading(true);
    try {
      const [matRes, secRes] = await Promise.all([
        fetch(`/api/materials?sectionId=${selectedSection}&search=${encodeURIComponent(searchQuery)}`),
        fetch('/api/sections'),
      ]);
      const matData = await matRes.json();
      const secData = await secRes.json();
      setMaterials(Array.isArray(matData) ? matData : []);
      setSections(Array.isArray(secData) ? secData : []);
      if (matData.length > 0 && Object.keys(expandedMaterials).length === 0) {
        setExpandedMaterials({ [matData[0].id]: true });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  }

  function toggleExpand(id: string) {
    setExpandedMaterials((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  // ── Add Material ──
  async function handleAddMaterial(e: React.FormEvent) {
    e.preventDefault();
    if (!canEdit) { alert('คุณไม่มีสิทธิ์เพิ่มวัตถุดิบ (โหมดอ่านอย่างเดียว)'); return; }
    if (!newCode || !newName) return;
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/materials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: newCode, name: newName, baseUnit: newUnit, sectionId: newSectionId || null, minSafetyStock: parseFloat(newMinStock) || 0 }),
      });
      if (!res.ok) { const err = await res.json(); alert(err.error || 'เพิ่มไม่สำเร็จ'); return; }
      const createdMat = await res.json();
      if (hasInitialLot && initialLotNumber && initialQuantity && Number(initialQuantity) > 0) {
        await fetch('/api/inbound', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ materialId: createdMat.id, lotNumber: initialLotNumber, quantity: parseFloat(initialQuantity), expDate: initialExpDate || null, receiveDate: new Date().toISOString(), remarks: 'รับเข้าเริ่มต้น' }),
        });
      }
      setShowAddModal(false);
      setNewCode(''); setNewName(''); setHasInitialLot(false); setInitialLotNumber(''); setInitialQuantity(''); setInitialExpDate('');
      fetchData();
    } catch (e) { console.error(e); }
    finally { setIsSubmitting(false); }
  }

  // ── Edit Material ──
  function openEditMaterial(m: Material) {
    if (!canEdit) return;
    setEditingMaterial(m);
    setEditCode(m.code); setEditName(m.name); setEditUnit(m.baseUnit);
    setEditSectionId(m.section?.id || ''); setEditMinStock(String(m.minSafetyStock));
  }

  async function handleUpdateMaterial(e: React.FormEvent) {
    e.preventDefault();
    if (!canEdit) { alert('คุณไม่มีสิทธิ์แก้ไขวัตถุดิบ (โหมดอ่านอย่างเดียว)'); return; }
    if (!editingMaterial) return;
    setIsUpdating(true);
    try {
      const res = await fetch(`/api/materials/${editingMaterial.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: editCode, name: editName, baseUnit: editUnit, sectionId: editSectionId || null, minSafetyStock: parseFloat(editMinStock) || 0 }),
      });
      if (res.ok) { setEditingMaterial(null); fetchData(); }
      else { const err = await res.json(); alert(err.error || 'แก้ไขไม่สำเร็จ'); }
    } catch (e) { console.error(e); }
    finally { setIsUpdating(false); }
  }

  // ── Delete Material ──
  async function handleDeleteMaterial() {
    if (!canEdit) { alert('คุณไม่มีสิทธิ์ลบวัตถุดิบ (โหมดอ่านอย่างเดียว)'); return; }
    if (!deletingMaterial) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/materials/${deletingMaterial.id}`, { method: 'DELETE' });
      if (res.ok) { setDeletingMaterial(null); fetchData(); }
      else { const err = await res.json(); alert(err.error || 'ลบไม่สำเร็จ'); }
    } catch (e) { console.error(e); }
    finally { setIsDeleting(false); }
  }

  // ── Edit Lot ──
  function openEditLot(m: Material, lot: MaterialLot, e: React.MouseEvent) {
    e.stopPropagation();
    if (!canEdit) return;
    setEditingLot({ materialId: m.id, materialName: m.name, baseUnit: m.baseUnit, lot });
    setEditLotNumber(lot.lotNumber);
    setEditLotQuantity(String(lot.quantityRemaining));
    setEditLotExpDate(lot.expDate ? lot.expDate.split('T')[0] : '');
  }

  async function handleUpdateLot(e: React.FormEvent) {
    e.preventDefault();
    if (!canEdit) { alert('คุณไม่มีสิทธิ์แก้ไขล็อต (โหมดอ่านอย่างเดียว)'); return; }
    if (!editingLot) return;
    setIsUpdatingLot(true);
    try {
      const res = await fetch(`/api/lots/${editingLot.lot.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lotNumber: editLotNumber, quantityRemaining: parseFloat(editLotQuantity) || 0, expDate: editLotExpDate || null }),
      });
      if (res.ok) { setEditingLot(null); fetchData(); }
      else { const err = await res.json(); alert(err.error || 'แก้ไขล็อตไม่สำเร็จ'); }
    } catch (e) { console.error(e); }
    finally { setIsUpdatingLot(false); }
  }

  // ── Delete Lot ──
  async function handleDeleteLot(lot: MaterialLot, e: React.MouseEvent) {
    e.stopPropagation();
    if (!canEdit) { alert('คุณไม่มีสิทธิ์ลบล็อต (โหมดอ่านอย่างเดียว)'); return; }
    if (!confirm(`ลบล็อต "${lot.lotNumber}" ออกจากระบบ?`)) return;
    try {
      const res = await fetch(`/api/lots/${lot.id}`, { method: 'DELETE' });
      if (res.ok) fetchData();
      else { const err = await res.json(); alert(err.error || 'ลบล็อตไม่สำเร็จ'); }
    } catch (e) { console.error(e); }
  }

  // ── Filtered list ──
  const displayedMaterials = showInStockOnly
    ? materials.filter((m) => m.totalStock > 0)
    : materials;

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5 pb-20 md:pb-0">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Package className="w-5 h-5 text-blue-600" /> คลังวัตถุดิบ
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">แยกตามล็อต วันหมดอายุ และโซนจัดเก็บ</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {canEdit ? (
            <>
              <Link href="/scan" className="inline-flex items-center gap-1.5 px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-semibold shadow-sm transition">
                <ScanLine className="w-3.5 h-3.5" /> AI สแกน
              </Link>
              <Link href="/inbound" className="inline-flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-sm transition">
                <ArrowDownToLine className="w-3.5 h-3.5" /> รับเข้า
              </Link>
              <button
                onClick={() => { setNewCode(`RM-${Date.now().toString().slice(-4)}`); setNewName(''); if (sections.length > 0) setNewSectionId(sections[0].id); setShowAddModal(true); }}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-sm transition"
              >
                <Plus className="w-3.5 h-3.5" /> เพิ่มของในคลัง
              </button>
            </>
          ) : (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-slate-100 border border-slate-200 rounded-xl text-xs text-slate-600">
              <span className="w-2 h-2 rounded-full bg-slate-400" />
              <span>โหมดดูข้อมูล (อ่านอย่างเดียว)</span>
              {!user && (
                <Link href="/login?next=/inventory" className="text-purple-600 hover:text-purple-700 font-bold underline ml-1">
                  เข้าสู่ระบบเพื่อแก้ไข
                </Link>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm space-y-3">
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
          {/* Search */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="ค้นหาชื่อ หรือรหัสของในคลัง..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {/* In-stock toggle */}
          <button
            onClick={() => setShowInStockOnly((v) => !v)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold border transition ${
              showInStockOnly
                ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {showInStockOnly ? <ToggleRight className="w-4 h-4 text-emerald-600" /> : <ToggleLeft className="w-4 h-4 text-slate-400" />}
            {showInStockOnly ? 'มีของเท่านั้น' : 'แสดงทั้งหมด'}
          </button>
        </div>

        {/* Zone buttons */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          <span className="text-[11px] font-bold text-slate-500 shrink-0">โซน:</span>
          <button
            onClick={() => setSelectedSection('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
              selectedSection === 'all' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            ทั้งหมด
          </button>
          {sections.map((sec) => (
            <button
              key={sec.id}
              onClick={() => setSelectedSection(sec.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition flex items-center gap-1 ${
                selectedSection === sec.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 border border-slate-200'
              }`}
            >
              {sec.name}
              {sec.activeLotsCount !== undefined && sec.activeLotsCount > 0 && (
                <span className={`text-[10px] px-1 rounded-full ${
                  selectedSection === sec.id ? 'bg-white/30 text-white' : 'bg-slate-200 text-slate-600'
                }`}>
                  {sec.activeLotsCount}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="text-[11px] text-slate-400">
          แสดง <strong className="text-slate-700">{displayedMaterials.length}</strong> จาก {materials.length} รายการ
        </div>
      </div>

      {/* Materials List */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-xl border border-slate-200 p-5 animate-pulse">
              <div className="flex items-center gap-3">
                <div className="h-4 w-4 bg-slate-200 rounded" />
                <div className="flex-1">
                  <div className="h-4 bg-slate-200 rounded w-48 mb-2" />
                  <div className="h-3 bg-slate-100 rounded w-72" />
                </div>
                <div className="h-7 bg-slate-200 rounded w-24" />
              </div>
            </div>
          ))}
        </div>
      ) : displayedMaterials.length === 0 ? (
        <div className="bg-white p-10 rounded-xl border border-slate-200 text-center">
          <Package className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-slate-800">ไม่พบรายการของในคลัง</h3>
          <p className="text-xs text-slate-400 mt-1">ลองเปลี่ยนตัวกรอง หรือกด "+ เพิ่มของในคลัง"</p>
        </div>
      ) : (
        <div className="space-y-3">
          {displayedMaterials.map((m) => {
            const isExpanded = !!expandedMaterials[m.id];
            const activeLots = m.lots.filter((l) => l.quantityRemaining > 0);
            const totalInitial = m.lots.reduce((s, l) => s + l.initialQuantity, 0);
            const stockPct = totalInitial > 0 ? Math.min(100, Math.round((m.totalStock / totalInitial) * 100)) : 0;

            return (
              <div
                key={m.id}
                className={`bg-white rounded-xl border border-slate-200 shadow-sm transition-all ${
                  openMenuMaterialId === m.id ? 'z-30 relative' : 'relative'
                }`}
              >
                {/* Card Header */}
                <div
                  onClick={() => toggleExpand(m.id)}
                  className={`px-4 py-3.5 flex items-center gap-3 cursor-pointer hover:bg-slate-50/80 transition ${
                    isExpanded ? 'rounded-t-xl' : 'rounded-xl'
                  }`}
                >
                  {/* Expand chevron */}
                  <button className="p-0.5 rounded text-slate-400 hover:text-slate-600 shrink-0">
                    {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>

                  {/* Name & Meta */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-slate-900 text-sm">{m.name}</span>
                      <span className="font-mono text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded">{m.code}</span>
                      {m.section && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded-full border border-blue-100">{m.section.name}</span>
                      )}
                      {m.expiringSoonCount > 0 && (
                        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded-full font-semibold">
                          <Clock className="w-3 h-3" /> ใกล้หมดอายุ {m.expiringSoonCount}
                        </span>
                      )}
                    </div>
                    {/* Mini stock bar */}
                    <div className="mt-2 flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            m.totalStock <= 0 ? 'bg-slate-300' :
                            m.isLowStock ? 'bg-rose-500' : 'bg-emerald-500'
                          }`}
                          style={{ width: `${stockPct}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-slate-400 shrink-0">{activeLots.length}/{m.lots.length} ล็อต</span>
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      หน่วย: <strong className="text-slate-600">{m.baseUnit}</strong>
                      {m.minSafetyStock > 0 && (
                        <> · จุดสั่งซื้อ: <strong className="text-slate-600">{m.minSafetyStock.toLocaleString()} {m.baseUnit}</strong></>
                      )}
                    </div>
                  </div>

                  {/* Right: stock count + status + action */}
                  <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <div className="text-right">
                      <div className="text-[11px] text-slate-400">คงเหลือ</div>
                      <div className="text-base font-extrabold text-slate-900 leading-tight">
                        {m.totalStock.toLocaleString()}
                        <span className="text-[11px] font-normal text-slate-400 ml-1">{m.baseUnit}</span>
                      </div>
                    </div>
                    {m.totalStock <= 0 ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-500">หมด</span>
                    ) : m.isLowStock ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700">⚠ ต่ำ</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700">ปกติ</span>
                    )}
                    {canEdit && (
                      <ActionMenu
                        isOpen={openMenuMaterialId === m.id}
                        onToggle={(open) => setOpenMenuMaterialId(open ? m.id : null)}
                        onEdit={() => openEditMaterial(m)}
                        onInbound={() => navigateToInbound(m.id)}
                        onDelete={() => setDeletingMaterial(m)}
                      />
                    )}
                  </div>
                </div>

                {/* Expanded Lots Table */}
                {isExpanded && (
                  <div className="border-t border-slate-100 bg-slate-50/40 p-4 rounded-b-xl">
                    <div className="flex items-center justify-between mb-2.5">
                      <div>
                        <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                          ล็อตของ {m.name}
                        </h4>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          มีของพร้อมจ่ายขึ้นก่อน → FEFO/FIFO • ล็อตหมดแล้วอยู่ด้านล่าง
                        </p>
                      </div>
                      {canEdit && (
                        <Link
                          href={`/inbound?materialId=${m.id}`}
                          className="text-xs font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1 shrink-0"
                        >
                          <Plus className="w-3.5 h-3.5" /> รับเข้าล็อตใหม่
                        </Link>
                      )}
                    </div>

                    {(() => {
                      const displayedLots = showInStockOnly
                        ? m.lots.filter((l) => l.quantityRemaining > 0)
                        : m.lots;

                      if (displayedLots.length === 0) {
                        return (
                          <div className="p-4 text-center text-xs text-slate-400 bg-white rounded-lg border border-slate-200">
                            {showInStockOnly
                              ? 'ไม่มีล็อตคงเหลือในสต็อกขณะนี้ (ล็อตทั้งหมดถูกจ่ายหมดแล้ว)'
                              : 'ยังไม่มีล็อตสำหรับวัตถุดิบนี้'}
                          </div>
                        );
                      }

                      return (
                        <div className="overflow-x-auto bg-white rounded-lg border border-slate-200 shadow-sm">
                          <table className="w-full text-left text-xs">
                            <thead className="bg-slate-50 text-slate-500 uppercase border-b border-slate-200">
                              <tr>
                                <th className="py-2.5 px-3">เลขล็อต</th>
                                <th className="py-2.5 px-3">วันที่รับ (DD-MM-YYYY)</th>
                                <th className="py-2.5 px-3">วันหมดอายุ (DD-MM-YYYY)</th>
                                <th className="py-2.5 px-3 text-right">ยอดรับ</th>
                                <th className="py-2.5 px-3 text-right">คงเหลือ</th>
                                <th className="py-2.5 px-3 text-right">สัดส่วน</th>
                                <th className="py-2.5 px-3 text-center">สถานะ</th>
                                {canEdit && <th className="py-2.5 px-2 text-center w-16">จัดการ</th>}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {displayedLots.map((lot) => {
                                const pct = lot.initialQuantity > 0
                                  ? Math.round((lot.quantityRemaining / lot.initialQuantity) * 100)
                                  : 0;
                              const rowClass = getLotRowClass(lot);
                              return (
                                <tr key={lot.id} className={`hover:bg-blue-50/20 transition ${rowClass}`}>
                                  <td className="py-2.5 px-3 font-mono font-bold text-blue-700">{lot.lotNumber}</td>
                                  <td className="py-2.5 px-3 text-slate-600">{formatDate(lot.receiveDate)}</td>
                                  <td className="py-2.5 px-3">{getExpirationBadge(lot.expDate)}</td>
                                  <td className="py-2.5 px-3 text-right text-slate-500">{lot.initialQuantity.toLocaleString()} {m.baseUnit}</td>
                                  <td className="py-2.5 px-3 text-right font-bold text-slate-900">{lot.quantityRemaining.toLocaleString()} {m.baseUnit}</td>
                                  <td className="py-2.5 px-3 text-right">
                                    <div className="flex items-center justify-end gap-2">
                                      <div className="w-14 bg-slate-100 h-1.5 rounded-full overflow-hidden">
                                        <div
                                          className={`h-full rounded-full ${pct > 30 ? 'bg-blue-500' : 'bg-rose-500'}`}
                                          style={{ width: `${pct}%` }}
                                        />
                                      </div>
                                      <span className="text-[10px] text-slate-500 w-7 text-right">{pct}%</span>
                                    </div>
                                  </td>
                                  <td className="py-2.5 px-3 text-center">
                                    {lot.quantityRemaining <= 0 ? (
                                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-500">หมดแล้ว</span>
                                    ) : lot.expDate && new Date(lot.expDate) < new Date() ? (
                                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-100 text-rose-700">หมดอายุ</span>
                                    ) : (
                                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800">พร้อมจ่าย</span>
                                    )}
                                  </td>
                                  {canEdit && (
                                    <td className="py-2.5 px-2 text-center">
                                      <div className="flex items-center justify-center gap-0.5">
                                        <button onClick={(e) => openEditLot(m, lot, e)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition" title="แก้ไขล็อต">
                                          <Edit2 className="w-3.5 h-3.5" />
                                        </button>
                                        <button onClick={(e) => handleDeleteLot(lot, e)} className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition" title="ลบล็อต">
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                    </td>
                                  )}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    );
                  })()}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ─── DELETE MATERIAL MODAL ─────────────────────────────────── */}
      {deletingMaterial && (
        <DeleteConfirmModal
          material={deletingMaterial}
          onConfirm={handleDeleteMaterial}
          onCancel={() => setDeletingMaterial(null)}
          isDeleting={isDeleting}
        />
      )}

      {/* ─── ADD MATERIAL MODAL ─────────────────────────────────────── */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900">เพิ่มวัตถุดิบใหม่ในคลัง</h3>
                <p className="text-xs text-slate-500">กรอกข้อมูลพื้นฐาน อาจเพิ่มล็อตแรกได้ทันที</p>
              </div>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleAddMaterial} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">รหัส *</label>
                  <input type="text" required value={newCode} onChange={(e) => setNewCode(e.target.value)} className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">หน่วยนับ *</label>
                  <input type="text" required value={newUnit} onChange={(e) => setNewUnit(e.target.value)} placeholder="kg, ลิตร, ถัง..." className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-bold text-slate-700 mb-1">ชื่อวัตถุดิบ *</label>
                  <input type="text" required value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="เช่น แกลบอบ, หัวเชื้อ BY" className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">โซนคลัง</label>
                  <select value={newSectionId} onChange={(e) => setNewSectionId(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="">-- ไม่ระบุ --</option>
                    {sections.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Safety Stock (จุดสั่งซื้อ)</label>
                  <input type="number" step="any" value={newMinStock} onChange={(e) => setNewMinStock(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
              </div>

              <div className="border-t border-slate-100 pt-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={hasInitialLot} onChange={(e) => setHasInitialLot(e.target.checked)} className="rounded border-slate-300" />
                  <span className="text-xs font-semibold text-slate-700">เพิ่มยอดล็อตเริ่มต้นทันที</span>
                </label>
                {hasInitialLot && (
                  <div className="grid grid-cols-3 gap-3 mt-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">เลขล็อต *</label>
                      <input type="text" value={initialLotNumber} onChange={(e) => setInitialLotNumber(e.target.value)} placeholder="เช่น 100726" className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">จำนวน *</label>
                      <input type="number" step="any" value={initialQuantity} onChange={(e) => setInitialQuantity(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">วันหมดอายุ</label>
                      <input type="date" value={initialExpDate} onChange={(e) => setInitialExpDate(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
                <button type="button" onClick={() => setShowAddModal(false)} className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-xl">ยกเลิก</button>
                <button type="submit" disabled={isSubmitting} className="px-5 py-2 text-sm font-semibold bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 disabled:opacity-60 flex items-center gap-1.5">
                  {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  {isSubmitting ? 'กำลังบันทึก...' : 'เพิ่มวัตถุดิบ'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── EDIT MATERIAL MODAL ────────────────────────────────────── */}
      {editingMaterial && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900">แก้ไขวัตถุดิบ: {editingMaterial.name}</h3>
                <p className="text-xs text-slate-400 font-mono">{editingMaterial.code}</p>
              </div>
              <button onClick={() => setEditingMaterial(null)} className="text-slate-400 hover:text-slate-600 p-1"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleUpdateMaterial} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">รหัส *</label>
                  <input type="text" required value={editCode} onChange={(e) => setEditCode(e.target.value)} className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">หน่วยนับ *</label>
                  <input type="text" required value={editUnit} onChange={(e) => setEditUnit(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-bold text-slate-700 mb-1">ชื่อวัตถุดิบ *</label>
                  <input type="text" required value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">โซนคลัง</label>
                  <select value={editSectionId} onChange={(e) => setEditSectionId(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="">-- ไม่ระบุ --</option>
                    {sections.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Safety Stock (จุดสั่งซื้อ Min)</label>
                  <input type="number" step="any" value={editMinStock} onChange={(e) => setEditMinStock(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
                <button type="button" onClick={() => setEditingMaterial(null)} className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-xl">ยกเลิก</button>
                <button type="submit" disabled={isUpdating} className="px-5 py-2 text-sm font-semibold bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-60 flex items-center gap-1.5">
                  {isUpdating ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {isUpdating ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── EDIT LOT MODAL ─────────────────────────────────────────── */}
      {editingLot && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900">แก้ไขล็อต</h3>
                <p className="text-xs text-slate-500">{editingLot.materialName}</p>
              </div>
              <button onClick={() => setEditingLot(null)} className="text-slate-400 hover:text-slate-600 p-1"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleUpdateLot} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">เลขล็อต *</label>
                <input type="text" required value={editLotNumber} onChange={(e) => setEditLotNumber(e.target.value)} className="w-full px-3 py-2 text-sm font-mono font-bold text-blue-700 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">ยอดคงเหลือ ({editingLot.baseUnit}) *</label>
                <input type="number" step="any" required value={editLotQuantity} onChange={(e) => setEditLotQuantity(e.target.value)} className="w-full px-3 py-2 text-sm font-bold border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">วันหมดอายุ (EXP)</label>
                <input type="date" value={editLotExpDate} onChange={(e) => setEditLotExpDate(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
                <button type="button" onClick={() => setEditingLot(null)} className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-xl">ยกเลิก</button>
                <button type="submit" disabled={isUpdatingLot} className="px-5 py-2 text-sm font-semibold bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-60 flex items-center gap-1.5">
                  {isUpdatingLot ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {isUpdatingLot ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
