import { NextResponse } from 'next/server';
import {
  getSystemKeys,
  getSharedKeys,
  addSharedKey,
  removeSharedKey,
  maskKey,
  validateGeminiKey,
} from '@/lib/geminiKeys';
import { recordAuditLog } from '@/lib/auditLog';

export const dynamic = 'force-dynamic';

// GET: สถานะ key (คืนค่าจำนวนคีย์สำรอง และ masked keys)
export async function GET() {
  const systemKeys = getSystemKeys();
  const sharedKeys = await getSharedKeys();
  return NextResponse.json({
    hasApiKey: systemKeys.length > 0 || sharedKeys.length > 0,
    systemKeyAvailable: systemKeys.length > 0,
    systemKeysCount: systemKeys.length,
    sharedKeyAvailable: sharedKeys.length > 0,
    sharedKeysCount: sharedKeys.length,
    totalKeysCount: systemKeys.length + sharedKeys.length,
    keys: sharedKeys.map((k) => maskKey(k)),
    preview: sharedKeys.length > 0 ? maskKey(sharedKeys[sharedKeys.length - 1]) : null,
  });
}

// POST: ตรวจสอบแล้วเพิ่ม key สำรองลง DB (เพิ่มต่อท้าย ไม่ทับอันเดิม)
export async function POST(request: Request) {
  try {
    const { apiKey } = await request.json();
    if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
      return NextResponse.json({ error: 'กรุณาระบุ API Key' }, { status: 400 });
    }
    const key = apiKey.trim();

    const check = await validateGeminiKey(key);
    if (!check.valid) {
      return NextResponse.json({ error: check.reason || 'API Key ไม่ถูกต้อง' }, { status: 400 });
    }

    // เพิ่มเป็นคีย์สำรองใน DB (ไม่ลบ/ไม่ทับคีย์เดิม)
    const res = await addSharedKey(key);

    // Write Audit Log (awaited)
    await recordAuditLog({
      tableName: 'AppSetting',
      recordId: 'GEMINI_SHARED_API_KEYS',
      action: 'UPDATE',
      summary: `เพิ่ม Gemini API Key สำรองลงในระบบ (${maskKey(key)}) รวมเป็น ${res.totalKeys} คีย์`,
      newData: { maskedKey: maskKey(key), totalKeys: res.totalKeys },
      changedBy: 'ผู้ใช้งานระบบ',
    });

    return NextResponse.json({
      success: true,
      message: `เพิ่ม API Key สำรองเรียบร้อยแล้ว (ปัจจุบันมีคีย์สำรองในระบบรวม ${res.totalKeys} คีย์)`,
      preview: maskKey(key),
      totalKeys: res.totalKeys,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE: ลบ key กลางออกจาก DB (สามารถระบุ apiKey เพื่อลบเฉพาะตัว หรือลบทั้งหมด)
export async function DELETE(request: Request) {
  try {
    let specificKey: string | undefined = undefined;
    try {
      const body = await request.json();
      if (body?.apiKey) specificKey = body.apiKey;
    } catch {
      // ไม่มี body ส่งมา แปลว่าต้องการลบทั้งหมด
    }

    const res = await removeSharedKey(specificKey);

    // Write Audit Log (awaited)
    await recordAuditLog({
      tableName: 'AppSetting',
      recordId: 'GEMINI_SHARED_API_KEYS',
      action: 'DELETE',
      summary: specificKey
        ? `ลบ Gemini API Key สำรอง (${maskKey(specificKey)}) เหลือ ${res.remainingKeys} คีย์`
        : `ลบ Gemini API Key สำรองทั้งหมดออกจากระบบ`,
      oldData: { deletedKey: specificKey ? maskKey(specificKey) : 'ALL' },
      newData: { remainingKeys: res.remainingKeys },
      changedBy: 'ผู้ใช้งานระบบ',
    });

    return NextResponse.json({ success: true, remainingKeys: res.remainingKeys });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
