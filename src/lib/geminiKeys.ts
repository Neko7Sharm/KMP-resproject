import prisma from './prisma';

export const SHARED_KEY_SETTING = 'GEMINI_SHARED_API_KEY';
export const SHARED_KEYS_LIST_SETTING = 'GEMINI_SHARED_API_KEYS';

export interface GeminiKeyEntry {
  key: string;
  source: 'system' | 'shared';
}

/** key ของระบบจาก Environment Variables (GEMINI_API_KEY, GEMINI_API_KEY_2 .. _10) */
export function getSystemKeys(): string[] {
  const keys: string[] = [];
  const primary = process.env.GEMINI_API_KEY;
  if (primary && primary.trim() !== '') keys.push(primary.trim());
  for (let i = 2; i <= 10; i++) {
    const extra = process.env[`GEMINI_API_KEY_${i}`];
    if (extra && extra.trim() !== '') keys.push(extra.trim());
  }
  return keys;
}

/** ดึงรายชื่อ key กลาง/สำรองทั้งหมดที่เก็บไว้ใน DB (คืนค่าเป็น array ของ keys ทั้งหมด) */
export async function getSharedKeys(): Promise<string[]> {
  try {
    const rows = await prisma.appSetting.findMany({
      where: {
        OR: [
          { key: SHARED_KEY_SETTING },
          { key: SHARED_KEYS_LIST_SETTING },
          { key: { startsWith: 'GEMINI_SHARED_KEY_' } },
        ],
      },
    });

    const keysSet = new Set<string>();

    for (const row of rows) {
      if (row.key === SHARED_KEYS_LIST_SETTING) {
        try {
          const parsed = JSON.parse(row.value);
          if (Array.isArray(parsed)) {
            parsed.forEach((k) => {
              if (typeof k === 'string' && k.trim()) keysSet.add(k.trim());
            });
          }
        } catch {
          // ignore parse error
        }
      } else {
        const v = row.value?.trim();
        if (v) keysSet.add(v);
      }
    }

    return Array.from(keysSet);
  } catch (err) {
    console.error('getSharedKeys error:', err);
    return [];
  }
}

/** key กลางตัวล่าสุดที่เก็บไว้ใน DB (เพื่อความเข้ากันได้กับโค้ดเดิม) */
export async function getSharedKey(): Promise<string | null> {
  const keys = await getSharedKeys();
  return keys.length > 0 ? keys[keys.length - 1] : null;
}

/** บันทึก/เพิ่ม key ใหม่เข้าไปใน DB แบบต่อท้ายเป็นคีย์สำรอง (ไม่ทับอันเดิม) */
export async function addSharedKey(newKey: string): Promise<{ added: boolean; totalKeys: number }> {
  const clean = newKey.trim();
  if (!clean) return { added: false, totalKeys: 0 };

  const currentKeys = await getSharedKeys();
  if (!currentKeys.includes(clean)) {
    currentKeys.push(clean);
  }

  // บันทึกรายการคีย์ทั้งหมดลงใน GEMINI_SHARED_KEYS_LIST_SETTING (JSON array)
  await prisma.appSetting.upsert({
    where: { key: SHARED_KEYS_LIST_SETTING },
    update: { value: JSON.stringify(currentKeys) },
    create: { key: SHARED_KEYS_LIST_SETTING, value: JSON.stringify(currentKeys) },
  });

  // บันทึกคีย์ล่าสุดไว้ใน SHARED_KEY_SETTING เพื่อ backward compatibility
  await prisma.appSetting.upsert({
    where: { key: SHARED_KEY_SETTING },
    update: { value: clean },
    create: { key: SHARED_KEY_SETTING, value: clean },
  });

  return { added: true, totalKeys: currentKeys.length };
}

/** ลบ key กลางออกจาก DB (ถ้าไม่ระบุ specificKey จะลบทั้งหมด) */
export async function removeSharedKey(specificKey?: string): Promise<{ remainingKeys: number }> {
  if (!specificKey) {
    await prisma.appSetting.deleteMany({
      where: {
        OR: [
          { key: SHARED_KEY_SETTING },
          { key: SHARED_KEYS_LIST_SETTING },
          { key: { startsWith: 'GEMINI_SHARED_KEY_' } },
        ],
      },
    });
    return { remainingKeys: 0 };
  }

  const currentKeys = await getSharedKeys();
  const filtered = currentKeys.filter((k) => k !== specificKey.trim());

  await prisma.appSetting.upsert({
    where: { key: SHARED_KEYS_LIST_SETTING },
    update: { value: JSON.stringify(filtered) },
    create: { key: SHARED_KEYS_LIST_SETTING, value: JSON.stringify(filtered) },
  });

  if (filtered.length > 0) {
    await prisma.appSetting.upsert({
      where: { key: SHARED_KEY_SETTING },
      update: { value: filtered[filtered.length - 1] },
      create: { key: SHARED_KEY_SETTING, value: filtered[filtered.length - 1] },
    });
  } else {
    await prisma.appSetting.deleteMany({
      where: {
        OR: [
          { key: SHARED_KEY_SETTING },
          { key: SHARED_KEYS_LIST_SETTING },
          { key: { startsWith: 'GEMINI_SHARED_KEY_' } },
        ],
      },
    });
  }

  return { remainingKeys: filtered.length };
}

/** ลำดับการใช้งาน: คีย์สำรองใน DB ทั้งหมด (คีย์ที่เพิ่มล่าสุดอยู่ก่อน) ตามด้วย key ระบบ (env) */
export async function getAllKeys(): Promise<GeminiKeyEntry[]> {
  const entries: GeminiKeyEntry[] = [];
  const sharedKeys = await getSharedKeys();

  // ใส่คีย์สำรองใน DB เรียงจากล่าสุดไปอันแรก
  for (let i = sharedKeys.length - 1; i >= 0; i--) {
    const k = sharedKeys[i];
    if (k && !entries.some((e) => e.key === k)) {
      entries.push({ key: k, source: 'shared' });
    }
  }

  // ตามด้วย key ระบบจาก Environment Variables
  const systemKeys = getSystemKeys();
  for (const sysKey of systemKeys) {
    if (sysKey && !entries.some((e) => e.key === sysKey)) {
      entries.push({ key: sysKey, source: 'system' });
    }
  }

  return entries;
}

export function maskKey(key: string): string {
  return key.length > 10 ? `${key.slice(0, 6)}...${key.slice(-4)}` : '****';
}

/** ตรวจว่า key ใช้งานได้จริงไหม (เรียก list models แบบเบา ๆ) */
export async function validateGeminiKey(key: string): Promise<{ valid: boolean; reason?: string }> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${encodeURIComponent(key)}`
    );
    if (res.ok) return { valid: true };
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      return { valid: false, reason: 'API Key ไม่ถูกต้องหรือไม่มีสิทธิ์ใช้งาน' };
    }
    // 429/5xx = key น่าจะถูก แต่ Google ขัดข้อง/โควตาชั่วคราว → ให้บันทึกได้
    return { valid: true };
  } catch {
    // เชื่อมต่อ Google ไม่ได้ชั่วคราว → ไม่บล็อกการบันทึก
    return { valid: true };
  }
}
