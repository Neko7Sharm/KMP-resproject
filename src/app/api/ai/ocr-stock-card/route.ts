import { NextResponse } from 'next/server';
import { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } from '@google/generative-ai';
import prisma from '@/lib/prisma';
import { getAllKeys, GeminiKeyEntry } from '@/lib/geminiKeys';
import { recordAuditLog } from '@/lib/auditLog';
import { getCurrentUser } from '@/lib/auth';

// วิเคราะห์ภาพใช้เวลานาน — กัน Vercel ตัดตอนกลางคัน (ให้เวลารวมสูงสุด 120 วินาที)
export const maxDuration = 120;
export const dynamic = 'force-dynamic';

// Helper: ทำความสะอาดและแปลง JSON ให้ทนทานต่อ Markdown Fences หรือ Trailing Commas
function cleanAndParseJSON(text: string): any {
  let clean = text.trim();
  clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  const firstBrace = clean.indexOf('{');
  const lastBrace = clean.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    clean = clean.slice(firstBrace, lastBrace + 1);
  }

  try {
    return JSON.parse(clean);
  } catch {
    // แก้ไขกรณีมี trailing comma เช่น {"a": 1,} หรือ [1, 2,]
    const fixed = clean.replace(/,\s*([\]}])/g, '$1');
    return JSON.parse(fixed);
  }
}

// Error แบบมีชนิด เพื่อให้หน้าเว็บรู้ว่าต้องขอ API Key หรือไม่
class AIError extends Error {
  code: string;
  needsKey: boolean;
  keySource?: 'system' | 'shared';
  constructor(code: string, message: string, needsKey: boolean, keySource?: 'system' | 'shared') {
    super(message);
    this.code = code;
    this.needsKey = needsKey;
    this.keySource = keySource;
  }
}

// ---- AI Analysis Helper: key ระบบก่อน → key กลางใน DB, พร้อม Multi-Model Fallback ----
async function analyzeImageWithGemini(
  imageBase64: string,
  mimeType: string,
  apiKeys: GeminiKeyEntry[]
): Promise<any> {
  if (apiKeys.length === 0) {
    throw new AIError('NO_KEY', 'ยังไม่มี Gemini API Key ในระบบ', true);
  }

  // จัดเรียงโมเดลที่เสถียรที่สุดและโควตาสูงสุดก่อน:
  // 1. gemini-3.5-flash-lite: ความเร็วสูงมาก (~1.5s), โควตาสูงสุด (15 RPM / 500 RPD)
  // 2. gemini-flash-lite-latest: ตัวสำรอง Lite ความเร็วสูง
  // 3. gemini-3.8-flash: โมเดลรุ่นใหม่ อ่านลายมือและตารางละเอียดสูง
  // 4. gemini-3.7-flash: โมเดลสำรองความสามารถสูง
  const candidateModels = [
    'gemini-3.5-flash-lite',
    'gemini-flash-lite-latest',
    'gemini-3.8-flash',
    'gemini-3.7-flash',
  ];

  const prompt = `คุณเป็นผู้เชี่ยวชาญอ่านเอกสารใบสต็อกการ์ดคลังสินค้า (Stock Card / FR 1-6) ลายมือภาษาไทยและตัวเลข
วิเคราะห์รูปภาพนี้และสกัดข้อมูลทุกแถวออกมาเป็น JSON เท่านั้น ห้ามมีข้อความอื่น

กฎสำคัญ:
- ช่องที่เขียน "-" ให้ใส่ 0
- ช่องที่เขียนเครื่องหมายฟันหนู (") หรือ "   " หรือ " (" หรือ ditto ให้คัดลอกค่า lotNumber ของบรรทัดก่อนหน้ามาใช้แทน
- ***สำคัญมากเรื่องปีและวันที่***:
  * ปีในทุกช่องทั้ง date และ expDate ต้องเป็นปี คริสต์ศักราช (ค.ศ. / CE / A.D.) 4 หลักเสมอ เช่น 2024, 2025, 2026, 2027
  * หากในเอกสารเป็นปี พ.ศ. (เช่น 2568, 2569) ให้คำนวณแปลงเป็น ค.ศ. เสมอ (ลบ 543 เช่น 2569 -> 2026, 2568 -> 2025)
  * หากในเอกสารเขียนปี พ.ศ. แบบ 2 หลัก (เช่น 68, 69) ให้แปลงเป็น ค.ศ. (เช่น 68 -> 2025, 69 -> 2026)
  * หากในเอกสารเขียนปี ค.ศ. แบบ 2 หลัก (เช่น 26, 27) ให้แปลงเป็น ค.ศ. 4 หลัก (เช่น 2026, 2027)
- ช่อง date: ต้องเป็น format "วว/ดด/ปปปป" โดยที่ "ปปปป" ต้องเป็นปี ค.ศ. 4 หลักเท่านั้น (เช่น 07/08/2026) ห้ามเป็น พ.ศ.
- ช่อง expDate: สกัดวันหมดอายุ EXP จากช่องหมายเหตุหรือช่องระบุวันหมดอายุ ถ้ามี ให้ใส่ใน expDate เป็น format "DD-MM-YYYY" โดยที่ปีต้องเป็น ค.ศ. 4 หลักเท่านั้น (เช่น 19-08-2027) ถ้าไม่มีให้เป็น ""
- ***สำคัญมากเรื่องยอดคงเหลือ (balanceQty และ totalQty) ในเอกสาร Stock Card (FR 1-6)***:
  * ในเอกสารมี 2 คอลัมน์ที่ต้องแยกจากกันอย่างชัดเจน:
    1) คอลัมน์ "คงเหลือ" (balanceQty) = ยอดคงเหลือของ Lot นั้นโดยเฉพาะ
       - เมื่อรับเข้า ยอดคงเหลือของ lot นั้นจะเพิ่มขึ้นตามจำนวนรับ
       - เมื่อจ่ายออก ยอดคงเหลือของ lot นั้นจะลดลง (เช่น lot เดิม 293 จ่ายออก 20 -> คงเหลือใน lot คือ 273)
       - เมื่อจ่าย lot นั้นจนหมด ช่องคงเหลือจะเขียนเลข 0 (ให้สกัด balanceQty: 0)
    2) คอลัมน์ "ยอดรวม" (totalQty) = ยอดรวมทั้งหมดของทุก Lot ในวัตถุดิบนั้นในคลัง
       - คือยอดคงเหลือสะสมของวัตถุดิบทั้งหมดรวมทุกล็อต ณ ขณะนั้น (Total Material Stock across all lots)
       - ยอดนี้เกิดจาก ยอดรวมแถวก่อนหน้า + รับเข้า - จ่ายออก
       - เช่น แม้ว่า lot นั้นจะจ่ายจนคงเหลือ 0 แต่ในคลังยังมี lot อื่นอยู่ ช่อง "ยอดรวม" ก็จะแสดงยอดคงเหลือรวมทุกล็อตที่เหลืออยู่ในคลัง
  * ให้สกัดตัวเลขจากช่อง "คงเหลือ" ใส่ใน balanceQty และตัวเลขจากช่อง "ยอดรวม" ใส่ใน totalQty แยกกันตามจริง ห้ามสลับกันเด็ดขาด
- ตัวเลขทุกค่าให้เป็น number ไม่ใส่ comma
- ***การสกัดเลขที่ของฟอร์ม (เลขที่ใบการ์ด / Card No.)***:
  * ในเอกสารมักเขียนในรูปแบบ [ลำดับใบ]/[ปี] เช่น "01/26", "006/26" หรือ "01/69"
  * เลขด้านหลังเครื่องหมาย / หรือ - คือปีที่ผลิตหรือปีของฟอร์ม (เช่น 26 คือปี ค.ศ. 2026, 69 คือ พ.ศ. 2569 -> ค.ศ. 2026)
  * ให้สกัด "cardNo" เป็นข้อความเดิม เช่น "01/26" หรือ "006/26"
  * ให้สกัด "formYear" เป็นตัวเลขปี ค.ศ. 4 หลัก เช่น 2026 (ถ้าเป็น พ.ศ. ให้แปลงเป็น ค.ศ. เสมอ)
  * ให้สกัด "sheetNumber" เป็นเลขลำดับใบ เช่น "01" หรือ "006"

รูปแบบ JSON ที่ต้องการ:
{
  "materialName": "ชื่อวัตถุดิบจากช่องรายการ",
  "unit": "หน่วยนับ เช่น kg ลิตร กรัม",
  "cardNo": "เลขที่ใบการ์ด เช่น 01/26 หรือ 006/26",
  "formYear": 2026,
  "sheetNumber": "01",
  "creator": "ชื่อผู้จัดทำ",
  "position": "ตำแหน่ง",
  "rows": [
    {
      "id": "row-1",
      "date": "วว/ดด/ปปปป (ปี ค.ศ. 4 หลัก เช่น 07/08/2026)",
      "lotNumber": "รหัสล็อต",
      "inboundQty": 0,
      "outboundQty": 0,
      "balanceQty": 0,
      "totalQty": 0,
      "expDate": "DD-MM-YYYY (ปี ค.ศ. 4 หลัก เช่น 19-08-2027) หรือ empty string ถ้าไม่มี",
      "remarks": "หมายเหตุ"
    }
  ]
}

ตอบเฉพาะ JSON ล้วน ไม่ต้องมี markdown code block`;

  const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
  const imagePart = { inlineData: { data: cleanBase64, mimeType: mimeType || 'image/jpeg' } };

  let lastError: any = null;
  const invalidKeyFailures: { source: 'system' | 'shared' }[] = [];
  let sawRateLimit = false;
  let sawOverload = false;
  let sawBadOutput = false;
  let sawTimeout = false;

  const startTime = Date.now();
  // ขยายเพดานเวลารวมและต่อโมเดล เพื่อให้ AI มีเวลาแกะลายมือและตารางยาวจนเสร็จสมบูรณ์โดยไม่ถูกตัดตอน
  const MAX_TOTAL_BUDGET_MS = 90000; // เพดานเวลารวม 90 วินาที
  const PER_MODEL_TIMEOUT_MS = 45000; // ให้เวลาแต่ละโมเดลสูงสุด 45 วินาที

  // Outer loop: คีย์สำรองใน DB (คีย์ล่าสุดก่อน) แล้วตามด้วยคีย์ระบบ (env)
  for (const entry of apiKeys) {
    if (Date.now() - startTime > MAX_TOTAL_BUDGET_MS) {
      sawTimeout = true;
      break;
    }

    const genAI = new GoogleGenerativeAI(entry.key);
    let keyFailed = false;

    // Inner loop: ลองทีละโมเดลด้วย key นี้
    for (const modelName of candidateModels) {
      const elapsed = Date.now() - startTime;
      if (elapsed > MAX_TOTAL_BUDGET_MS) {
        sawTimeout = true;
        break;
      }

      const remainingBudget = Math.max(10000, MAX_TOTAL_BUDGET_MS - elapsed);
      const callTimeoutMs = Math.min(PER_MODEL_TIMEOUT_MS, remainingBudget);

      try {
        const model = genAI.getGenerativeModel({
          model: modelName,
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
            maxOutputTokens: 8192, // เพิ่มเป็น 8192 เพื่อไม่ให้ JSON โดนตัดตอนกลางคันเมื่อตารางยาว
          },
          safetySettings: [
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
          ],
        });

        let timeoutHandle: any;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(
            () => reject(new Error('MODEL_TIMEOUT: เซิร์ฟเวอร์โมเดลใช้เวลานานเกินกำหนด')),
            callTimeoutMs
          );
        });

        try {
          const result = await Promise.race([
            model.generateContent([prompt, imagePart]),
            timeoutPromise,
          ]);

          const text = result.response.text();
          const parsedData = cleanAndParseJSON(text);

          return {
            success: true,
            data: parsedData,
            usedModel: modelName,
            usedKeySource: entry.source,
          };
        } finally {
          clearTimeout(timeoutHandle);
        }
      } catch (err: any) {
        lastError = err;
        const msg: string = String(err?.message || '');

        const isTimeout = /MODEL_TIMEOUT|timeout|aborted|ETIMEDOUT/i.test(msg);
        const isInvalidKey = /API key not valid|API_KEY_INVALID|API key expired|PERMISSION_DENIED|\[40[013]/i.test(msg);
        const isQuota = /\[429|429 |quota|RESOURCE_EXHAUSTED|rate limit/i.test(msg);
        const isModelGone = /\[404|404 |no longer available|is not found/i.test(msg);
        const isOverload = /\[503|503 |high demand|overloaded|UNAVAILABLE/i.test(msg);

        if (isTimeout) {
          sawTimeout = true;
          console.warn(`Model ${modelName} timed out (> ${callTimeoutMs}ms), switching to next model...`);
          continue;
        }
        if (isInvalidKey) {
          invalidKeyFailures.push({ source: entry.source });
          keyFailed = true;
          break;
        }
        if (isQuota) {
          sawRateLimit = true;
          console.warn(`Gemini key (${entry.source}) hit rate limit (429), switching to next key...`);
          keyFailed = true;
          break;
        }
        if (isModelGone) {
          console.warn(`Model ${modelName} unavailable (404), trying next model...`);
          continue;
        }
        if (isOverload) {
          sawOverload = true;
          console.warn(`Model ${modelName} overloaded (503), switching to next model cluster...`);
          continue;
        }
        if (err instanceof SyntaxError) sawBadOutput = true;
        continue;
      }
    }
    if (keyFailed) continue;
  }

  // ถ้าเจอปัญหา Rate Limit (429) บนคีย์ทั้งหมด และยังมีเวลาเหลือ ให้รอสั้นๆ 2.5 วินาทีแล้วลองคีย์แรกอีก 1 ครั้ง (ช่วยเคลียร์หน้าต่าง 15 RPM)
  const remainingAfterLoop = MAX_TOTAL_BUDGET_MS - (Date.now() - startTime);
  if (sawRateLimit && !sawTimeout && remainingAfterLoop > 15000 && apiKeys.length > 0) {
    const retryEntry = apiKeys[0];
    const genAI = new GoogleGenerativeAI(retryEntry.key);
    console.warn('Gemini 429 rate limit detected across keys. Waiting 2.5s for backoff retry...');
    await new Promise((resolve) => setTimeout(resolve, 2500));

    for (const modelName of ['gemini-3.5-flash-lite', 'gemini-flash-lite-latest']) {
      try {
        const model = genAI.getGenerativeModel({
          model: modelName,
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
            maxOutputTokens: 8192,
          },
        });
        const result = await model.generateContent([prompt, imagePart]);
        const text = result.response.text();
        const parsedData = cleanAndParseJSON(text);

        return {
          success: true,
          data: parsedData,
          usedModel: modelName,
          usedKeySource: retryEntry.source,
        };
      } catch (retryErr: any) {
        lastError = retryErr;
        const retryMsg = String(retryErr?.message || '');
        if (/\[429|429 |quota|RESOURCE_EXHAUSTED|rate limit/i.test(retryMsg)) {
          sawRateLimit = true;
        }
      }
    }
  }

  // ลำดับการรายงาน Error อย่างแม่นยำ:
  // 1. ถ้าทุก key ในระบบล้วนเป็น key ปลอม/หมดอายุจริง (400, 401, 403) เท่านั้นที่เปิด modal ขอ key (needsKey = true)
  if (invalidKeyFailures.length > 0 && invalidKeyFailures.length >= apiKeys.length) {
    throw new AIError(
      'KEY_INVALID',
      'API Key ทั้งหมดในระบบไม่ถูกต้องหรือหมดอายุ กรุณาตรวจสอบหรือเพิ่ม API Key ใหม่',
      true,
      invalidKeyFailures[0].source
    );
  }

  // 2. ถ้าเวลาหมด
  if (sawTimeout) {
    throw new AIError(
      'AI_TIMEOUT',
      'AI ประมวลผลนานเกินกำหนดชั่วคราว กรุณากด "ลองสแกนอีกครั้ง" หรือใส่ Gemini API Key สำรอง',
      false
    );
  }

  // 3. ถ้าเจอ Rate Limit (429: 15 ครั้ง/นาที ของ Google Free Tier) ไม่ต้องบังคับเปิด modal เปลี่ยน key
  if (sawRateLimit) {
    throw new AIError(
      'RATE_LIMIT',
      'อัตราการเรียกใช้งานของ Google AI เต็มชั่วคราว (Rate Limit: 15 ครั้ง/นาที) กรุณารอสักครู่ (10-20 วินาที) แล้วกด "ลองสแกนอีกครั้ง" หรือเพิ่ม API Key สำรอง',
      false
    );
  }

  // 4. ถ้าเซิร์ฟเวอร์ Google มีผู้ใช้หนาแน่น (503)
  if (sawOverload) {
    throw new AIError(
      'AI_BUSY',
      'เซิร์ฟเวอร์ AI ของ Google กำลังมีผู้ใช้งานหนาแน่นชั่วคราว (Traffic Spike) กรุณากด "ลองสแกนอีกครั้ง" หรือใส่ Gemini API Key สำรองของตนเอง',
      false
    );
  }

  // 5. ถ้าอ่านภาพไม่ได้
  if (sawBadOutput) {
    throw new AIError('BAD_IMAGE', 'AI อ่านข้อมูลจากภาพไม่ได้ กรุณาถ่ายภาพใหม่ให้ชัดเจนขึ้น', false);
  }

  throw new AIError('AI_ERROR', lastError?.message || 'AI วิเคราะห์ไม่สำเร็จ กรุณากดลองใหม่อีกครั้ง', false);
}

// ---- Helper: Convert any year (พ.ศ. or 2-digit) to 4-digit CE (ค.ศ.) ----
function convertYearToCE(rawYear: number): number {
  if (isNaN(rawYear)) return new Date().getFullYear();
  if (rawYear > 2400) {
    // Buddhist Era 4 digits: e.g. 2568, 2569 -> 2025, 2026
    return rawYear - 543;
  }
  if (rawYear < 100) {
    // 2-digit year: in Thai stock cards, >= 40 indicates Buddhist Era (e.g. 68 -> 2568 -> 2025, 69 -> 2569 -> 2026)
    if (rawYear >= 40) {
      return (rawYear + 2500) - 543;
    }
    // <= 39 indicates CE 2-digit (e.g. 26 -> 2026, 27 -> 2027)
    return 2000 + rawYear;
  }
  return rawYear;
}

// ---- Normalize Date to DD/MM/YYYY with 4-digit CE year ----
function normalizeDateStr(rawDate: string): string {
  if (!rawDate || typeof rawDate !== 'string') return '';
  const trimmed = rawDate.trim();
  if (!trimmed) return '';

  // Match YYYY-MM-DD
  const isoMatch = trimmed.match(/^(\d{2,4})[-\/\.](\d{1,2})[-\/\.](\d{1,2})$/);
  if (isoMatch && parseInt(isoMatch[1]) > 31) {
    const y = convertYearToCE(parseInt(isoMatch[1]));
    const m = String(parseInt(isoMatch[2])).padStart(2, '0');
    const d = String(parseInt(isoMatch[3])).padStart(2, '0');
    return `${d}/${m}/${y}`;
  }

  // Match DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  const dmyMatch = trimmed.match(/^(\d{1,2})[-\/\.](\d{1,2})[-\/\.](\d{2,4})$/);
  if (dmyMatch) {
    const d = String(parseInt(dmyMatch[1])).padStart(2, '0');
    const m = String(parseInt(dmyMatch[2])).padStart(2, '0');
    const y = convertYearToCE(parseInt(dmyMatch[3]));
    return `${d}/${m}/${y}`;
  }

  return trimmed;
}

// ---- Normalize EXP Date to DD-MM-YYYY with 4-digit CE year ----
function normalizeExpDateStr(rawExp: string, remarks?: string): string {
  let target = (rawExp || '').trim();

  // If expDate is empty, try to extract from remarks (e.g. "EXP. 7/8/27" or "EXP 19/08/69")
  if (!target && remarks) {
    const m = remarks.match(/(?:EXP|หมดอายุ|BBF)[\.\:\s]*(\d{1,2})[-\/\.](\d{1,2})[-\/\.](\d{2,4})/i)
           || remarks.match(/(\d{1,2})[-\/\.](\d{1,2})[-\/\.](\d{2,4})/);
    if (m) {
      const d = String(parseInt(m[1])).padStart(2, '0');
      const mo = String(parseInt(m[2])).padStart(2, '0');
      const y = convertYearToCE(parseInt(m[3]));
      return `${d}-${mo}-${y}`;
    }
    return '';
  }

  if (!target) return '';

  // Check if YYYY-MM-DD (year first, > 31)
  const ymdMatch = target.match(/^(\d{2,4})[-\/\.](\d{1,2})[-\/\.](\d{1,2})$/);
  if (ymdMatch && parseInt(ymdMatch[1]) > 31) {
    const y = convertYearToCE(parseInt(ymdMatch[1]));
    const m = String(parseInt(ymdMatch[2])).padStart(2, '0');
    const d = String(parseInt(ymdMatch[3])).padStart(2, '0');
    return `${d}-${m}-${y}`;
  }

  // Check if DD/MM/YYYY (day first, year last)
  const dmyMatch = target.match(/^(\d{1,2})[-\/\.](\d{1,2})[-\/\.](\d{2,4})$/);
  if (dmyMatch) {
    const d = String(parseInt(dmyMatch[1])).padStart(2, '0');
    const m = String(parseInt(dmyMatch[2])).padStart(2, '0');
    const y = convertYearToCE(parseInt(dmyMatch[3]));
    return `${d}-${m}-${y}`;
  }

  return target;
}

// ---- Parse Form / Card Number: extract sheet number and manufacturing/form year ----
function parseFormNumber(cardNoStr: string): { sheetNumber: string; formYear: number | null; formYearInfo: string } {
  if (!cardNoStr || typeof cardNoStr !== 'string') {
    return { sheetNumber: '', formYear: null, formYearInfo: '' };
  }
  const trimmed = cardNoStr.trim();
  // Matches patterns like "01/26", "006/26", "1/2026", "01-26", "006/69"
  const m = trimmed.match(/^([A-Za-z0-9\.\-]+)\s*[\/\-]\s*(\d{2,4})$/);
  if (m) {
    const sheet = m[1];
    const rawY = parseInt(m[2]);
    const yearCE = convertYearToCE(rawY);
    return {
      sheetNumber: sheet,
      formYear: yearCE,
      formYearInfo: `ใบที่ ${sheet} ของปี ค.ศ. ${yearCE}`,
    };
  }
  return { sheetNumber: '', formYear: null, formYearInfo: '' };
}

// ---- Normalize all dates in scanned rows to CE year ----
function normalizeAllDatesToCE(rows: any[]): any[] {
  return rows.map((row) => ({
    ...row,
    date: normalizeDateStr(row.date),
    expDate: normalizeExpDateStr(row.expDate, row.remarks),
  }));
}

// ---- Smart Lot Number resolution ----
function resolveLotNumbers(rows: any[]): any[] {
  let lastLot = '';
  return rows.map((row) => {
    const lotRaw = String(row.lotNumber || '').trim();
    if (
      lotRaw === '' ||
      lotRaw === '"' ||
      lotRaw === '″' ||
      lotRaw === 'n' ||
      lotRaw === '"' ||
      lotRaw.toLowerCase() === 'ditto' ||
      lotRaw === '\u201d' ||
      lotRaw === '\u2033'
    ) {
      row.lotNumber = lastLot;
    } else {
      lastLot = lotRaw;
    }
    return row;
  });
}

// ---- Reconcile and calculate lot running balance ----
function reconcileBalances(rows: any[]): any[] {
  const lotRunningBal = new Map<string, number>();

  return rows.map((row) => {
    const lotNum = String(row.lotNumber || '').trim();
    let inQty = Number(row.inboundQty) || 0;
    let outQty = Number(row.outboundQty) || 0;
    let balQty = Number(row.balanceQty) || 0;
    let totQty = Number(row.totalQty) || 0;

    // ตรวจสอบกับ Running Balance ของล็อตนั้นโดยเฉพาะ (balanceQty)
    if (lotNum) {
      const prev = lotRunningBal.get(lotNum);
      if (inQty > 0) {
        const next = (prev || 0) + inQty;
        if (balQty === 0) balQty = next;
        lotRunningBal.set(lotNum, balQty > 0 ? balQty : next);
      } else if (outQty > 0) {
        if (prev !== undefined) {
          const expected = Math.max(0, prev - outQty);
          // ถ้าไม่ได้ระบุ balQty มา (empty) แต่ตามการคำนวณยังมีเหลือ ให้ใช้ expected
          if (balQty === 0 && expected > 0 && String(row.balanceQty ?? '').trim() === '') {
            balQty = expected;
          }
          lotRunningBal.set(lotNum, balQty);
        } else if (balQty > 0) {
          lotRunningBal.set(lotNum, balQty);
        }
      } else if (balQty > 0) {
        lotRunningBal.set(lotNum, balQty);
      }
    }

    return {
      ...row,
      balanceQty: balQty,
      totalQty: totQty,
    };
  });
}

// ---- Audit Scanned Rows: ตรวจสอบความถูกต้องทางคณิตศาสตร์และเทียบกับสต็อกในคลัง ----
export interface AiAnomaly {
  type: 'MATH_MISMATCH' | 'WAREHOUSE_STOCK' | 'NEGATIVE_QTY' | 'INFO';
  severity: 'warning' | 'info' | 'error';
  rowId?: string;
  lotNumber?: string;
  message: string;
  expectedValue?: number;
}

export interface ExistingLotInfo {
  lotNumber: string;
  currentRemaining: number;
  status: string;
}

function auditScannedRows(rows: any[], existingLots: ExistingLotInfo[]): AiAnomaly[] {
  const anomalies: AiAnomaly[] = [];
  const lotRunningBal = new Map<string, number>();
  const existingMap = new Map<string, ExistingLotInfo>();
  existingLots.forEach((l) => existingMap.set(l.lotNumber.toUpperCase().trim(), l));

  rows.forEach((row, idx) => {
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
        message: `แถวที่ ${rowNum} (${dateStr}): ไม่พบเลขล็อตในเอกสาร`,
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
          message: `แถวที่ ${rowNum} (${dateStr}, ล็อต ${lotNum}): รับเข้า ${inQty} ยอดคงเหลือคำนวณควรเป็น ${nextBal} แต่ในตารางอ่านได้ ${balQty}`,
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
            message: `แถวที่ ${rowNum} (${dateStr}, ล็อต ${lotNum}): จ่ายออก ${outQty} จากคงเหลือเดิม ${prevBal} ยอดคงเหลือคำนวณควรเป็น ${expected} แต่ในตารางอ่านได้ ${balQty}`,
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
              message: `ล็อต ${lotNum} มีในคลังเดิม (คงเหลือปัจจุบันในคลัง ${existing.currentRemaining}) จ่ายออก ${outQty} คงเหลือตามคลังคือ ${expected} แต่ในเอกสารระบุ ${balQty}`,
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
}

// ---- POST Handler ----
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, imageBase64, mimeType, dataToCommit } = body;

    // === ACTION: CHECK API KEY ===
    if (action === 'CHECK_KEY') {
      const keys = await getAllKeys();
      return NextResponse.json({
        hasApiKey: keys.length > 0,
        systemKeyAvailable: keys.some((k) => k.source === 'system'),
        sharedKeyAvailable: keys.some((k) => k.source === 'shared'),
      });
    }

    // === ACTION: ANALYZE IMAGE ===
    if (action === 'ANALYZE') {
      if (!imageBase64) {
        return NextResponse.json(
          { success: false, code: 'BAD_IMAGE', error: 'ไม่พบข้อมูลรูปภาพ กรุณาอัปโหลดรูปใหม่' },
          { status: 400 }
        );
      }

      // ลำดับ: key ระบบ (env) ก่อน → key กลางที่เก็บใน DB
      const apiKeys = await getAllKeys();

      try {
        const aiResult = await analyzeImageWithGemini(imageBase64, mimeType || 'image/jpeg', apiKeys);
        const data = aiResult.data;
        data.rows = resolveLotNumbers(data.rows || []);
        data.rows = normalizeAllDatesToCE(data.rows);
        data.rows = reconcileBalances(data.rows);

        // Extract or enrich formYear and sheetNumber from cardNo (e.g. 01/26 -> sheet 01, year 2026)
        const parsedForm = parseFormNumber(data.cardNo || '');
        if (!data.formYear && parsedForm.formYear) {
          data.formYear = parsedForm.formYear;
        } else if (data.formYear) {
          data.formYear = convertYearToCE(Number(data.formYear));
        }
        if (!data.sheetNumber && parsedForm.sheetNumber) {
          data.sheetNumber = parsedForm.sheetNumber;
        }
        data.formYearInfo = parsedForm.formYearInfo || (data.formYear ? `ปี ค.ศ. ${data.formYear}` : '');

        // ค้นหาข้อมูลล็อตเดิมในคลังของวัตถุดิบนี้ (หากมีในระบบ) เพื่อนำมาตรวจสอบและแสดงยอดคงเหลือ
        let existingLots: ExistingLotInfo[] = [];
        if (data.materialName) {
          const cleanName = data.materialName.trim();
          const existingMat = await prisma.material.findFirst({
            where: {
              name: { equals: cleanName },
            },
            include: {
              lots: {
                select: { lotNumber: true, quantityRemaining: true, status: true },
              },
            },
          });
          if (existingMat && existingMat.lots) {
            existingLots = existingMat.lots.map((l) => ({
              lotNumber: l.lotNumber,
              currentRemaining: l.quantityRemaining,
              status: l.status,
            }));
          }
        }

        data.existingLots = existingLots;
        data.anomalies = auditScannedRows(data.rows, existingLots);

        return NextResponse.json({
          success: true,
          data,
          engine: 'gemini-vision',
          keySource: aiResult.usedKeySource,
          message: `วิเคราะห์ภาพสำเร็จ (โมเดล ${aiResult.usedModel || 'Gemini'}) ตรวจสอบปี ค.ศ. เรียบร้อย`,
        });
      } catch (aiErr: any) {
        console.error('Gemini Vision error:', aiErr?.code, aiErr?.message);
        const isTyped = aiErr instanceof AIError;
        const needsKey = isTyped ? aiErr.needsKey : false;
        return NextResponse.json(
          {
            success: false,
            code: isTyped ? aiErr.code : 'AI_ERROR',
            needsKey,
            keySource: isTyped ? aiErr.keySource : undefined,
            error: isTyped ? aiErr.message : `AI ไม่สามารถอ่านภาพได้: ${aiErr?.message || ''}`,
          },
          { status: needsKey ? 401 : 422 }
        );
      }
    }

    // === ACTION: COMMIT TO DATABASE ===
    if (action === 'COMMIT') {
      const sessionUser = await getCurrentUser();
      const { materialId, materialName, baseUnit, sectionId, documentRef, creator, formYear, rows } = dataToCommit;
      const finalCreator = creator?.trim() || sessionUser?.name || 'ระบบนำเข้า OCR';

      if (!rows || !Array.isArray(rows) || rows.length === 0) {
        return NextResponse.json({ error: 'ไม่มีรายการที่จะบันทึก' }, { status: 400 });
      }

      const result = await prisma.$transaction(async (tx) => {
        // Find or create Material
        let mat: any = null;
        if (materialId) {
          mat = await tx.material.findUnique({ where: { id: materialId } });
        }
        // If not selected by ID, check if a material with the same name already exists
        if (!mat && materialName) {
          mat = await tx.material.findFirst({
            where: {
              name: {
                equals: materialName.trim(),
              },
            },
          });
        }
        if (!mat) {
          const code = `RM-SCAN-${Date.now().toString().slice(-5)}`;
          mat = await tx.material.create({
            data: {
              code,
              name: materialName || 'วัตถุดิบจาก Stock Card',
              baseUnit: baseUnit || 'kg',
              sectionId: sectionId || null,
            },
          });
        }

        let importedTx = 0;
        let createdLots = 0;
        const lotMap = new Map<string, string>(); // lotNumber -> lotId

        for (const row of rows) {
          const lotNum = String(row.lotNumber || 'DEFAULT').trim();
          const inQty  = Number(row.inboundQty)  || 0;
          const outQty = Number(row.outboundQty) || 0;
          let balQty   = Number(row.balanceQty)  || 0;
          const totQty = Number(row.totalQty)    || 0;

          // Fallback: ใช้ totQty แทน balQty ได้เฉพาะแถวรับเข้า (inQty > 0) ที่ไม่ได้ระบุ balQty มาเท่านั้น
          // (เพราะ totQty คือยอดรวมของทุก lot ในวัตถุดิบนั้น ไม่ใช่ยอดของ lot นี้)
          if (balQty === 0 && totQty > 0 && inQty > 0 && outQty === 0) {
            balQty = totQty;
          }

          // Parse date (support Christian AD and Buddhist BE years like 2568, 68)
          let txDate = new Date();
          if (row.date) {
            const parts = row.date.split(/[\/\-\.]/);
            if (parts.length === 3) {
              let y = parseInt(parts[2]);
              const m = parseInt(parts[1]) - 1;
              const d = parseInt(parts[0]);
              if (y > 2400) y -= 543; // Buddhist Era: e.g. 2568 -> 2025, 2569 -> 2026
              else if (y < 100) {
                // If 2 digits like '68' or '69', assume Buddhist Era if > 40
                if (y >= 40) y = (y + 2500) - 543;
                else y += 2000;
              }
              txDate = new Date(y, m, d);
            }
          }

          // Parse expiry (support Christian AD and Buddhist BE)
          let expDate: Date | null = null;
          if (row.expDate && row.expDate.trim() !== '') {
            const expParts = row.expDate.trim().split(/[\/\-\.]/);
            if (expParts.length === 3) {
              let y = parseInt(expParts[0]);
              let m = parseInt(expParts[1]) - 1;
              let d = parseInt(expParts[2]);
              // If format is DD/MM/YYYY
              if (parseInt(expParts[2]) > 1000 || parseInt(expParts[2]) < 100) {
                d = parseInt(expParts[0]);
                m = parseInt(expParts[1]) - 1;
                y = parseInt(expParts[2]);
              }
              if (y > 2400) y -= 543;
              else if (y < 100) {
                if (y >= 40) y = (y + 2500) - 543;
                else y += 2000;
              }
              expDate = new Date(y, m, d);
            } else {
              expDate = new Date(row.expDate);
              if (isNaN(expDate.getTime())) expDate = null;
            }
          }
          if (!expDate && row.remarks) {
            const m = row.remarks.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
            if (m) {
              let y = parseInt(m[3]);
              if (y > 2400) y -= 543;
              else if (y < 100) {
                if (y >= 40) y = (y + 2500) - 543;
                else y += 2000;
              }
              expDate = new Date(y, parseInt(m[2]) - 1, parseInt(m[1]));
            }
          }

          // Find or create lot (by lotNumber, scoped to this material)
          let lotId = lotMap.get(lotNum);
          let targetLot: any = null;

          if (lotId) {
            targetLot = await tx.materialLot.findUnique({ where: { id: lotId } });
          } else {
            targetLot = await tx.materialLot.findFirst({
              where: { materialId: mat.id, lotNumber: lotNum },
            });
          }

          // Fallback 2: ถ้า balQty ยังเป็น 0 ในรายการจ่ายออก แต่ล็อตเดิมมียอดเหลือมากกว่า outQty ให้คำนวณตามจริง ไม่ปัดเป็น 0
          if (balQty === 0 && targetLot && targetLot.quantityRemaining > outQty && outQty > 0) {
            balQty = targetLot.quantityRemaining - outQty;
          }

          if (!targetLot && (inQty > 0 || balQty > 0)) {
            const mfgDate = formYear ? new Date(formYear, 0, 1) : null;
            targetLot = await tx.materialLot.create({
              data: {
                materialId: mat.id,
                lotNumber: lotNum,
                receiveDate: txDate,
                mfgDate,
                expDate,
                initialQuantity: inQty > 0 ? inQty : balQty,
                quantityRemaining: balQty,
                status: balQty <= 0 ? 'EXHAUSTED' : 'ACTIVE',
              },
            });
            createdLots++;
          } else if (targetLot) {
            // Update remaining quantity and status based on this transaction row
            let newBal = balQty;
            if (newBal === 0 && targetLot.quantityRemaining > outQty && outQty > 0) {
              newBal = targetLot.quantityRemaining - outQty;
            }
            const newStatus = newBal <= 0 ? 'EXHAUSTED' : 'ACTIVE';
            targetLot = await tx.materialLot.update({
              where: { id: targetLot.id },
              data: {
                quantityRemaining: newBal,
                expDate: expDate || targetLot.expDate,
                status: newStatus,
              },
            });
          }

          if (targetLot) {
            lotId = targetLot.id;
            lotMap.set(lotNum, targetLot.id);
          }

          const finalLotBal = balQty > 0 ? balQty : (targetLot ? targetLot.quantityRemaining : 0);

          // Write transaction record
          if (inQty > 0) {
            await tx.stockTransaction.create({
              data: {
                materialId: mat.id,
                lotId: lotId || null,
                type: 'INBOUND',
                quantity: inQty,
                lotBalanceAfter: finalLotBal,
                totalStockAfter: totQty > 0 ? totQty : finalLotBal,
                transactionDate: txDate,
                documentRef: documentRef || 'STOCK-CARD-IMPORT',
                remarks: row.remarks || `รับเข้าล็อต ${lotNum}`,
                createdBy: finalCreator,
              },
            });
            importedTx++;
          } else if (outQty > 0) {
            await tx.stockTransaction.create({
              data: {
                materialId: mat.id,
                lotId: lotId || null,
                type: 'OUTBOUND',
                quantity: outQty,
                lotBalanceAfter: finalLotBal,
                totalStockAfter: totQty > 0 ? totQty : finalLotBal,
                transactionDate: txDate,
                documentRef: documentRef || 'STOCK-CARD-IMPORT',
                remarks: row.remarks || `จ่ายออกล็อต ${lotNum}`,
                createdBy: finalCreator,
              },
            });
            importedTx++;
          }
        }

        return {
          materialId: mat.id,
          materialName: mat.name,
          importedTransactions: importedTx,
          createdLots,
        };
      });

      // Write consolidated Audit Log for this entire stock card batch (awaited)
      await recordAuditLog({
        tableName: 'StockCardImport',
        recordId: result.materialId,
        action: 'IMPORT',
        summary: `นำเข้า Stock Card [${documentRef || 'STOCK-CARD-IMPORT'}]: วัตถุดิบ "${result.materialName}", นำเข้าความเคลื่อนไหว ${result.importedTransactions} รายการ, เพิ่มล็อตใหม่ ${result.createdLots} ล็อต`,
        newData: {
          materialId: result.materialId,
          materialName: result.materialName,
          documentRef: documentRef || null,
          creator: creator || null,
          formYear: formYear || null,
          importedTransactions: result.importedTransactions,
          createdLots: result.createdLots,
          totalRows: rows.length,
        },
        changedBy: creator || 'ระบบนำเข้า OCR',
      });

      return NextResponse.json({ success: true, ...result });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error: any) {
    console.error('OCR Stock Card Error:', error);
    return NextResponse.json(
      { error: error.message || 'เกิดข้อผิดพลาดในระบบ' },
      { status: 500 }
    );
  }
}
