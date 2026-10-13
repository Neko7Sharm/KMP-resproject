import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { recordAuditLog } from '@/lib/auditLog';
import { getCurrentUser, ROLE_CONFIG } from '@/lib/auth';

export async function POST(request: Request) {
  try {
    const sessionUser = await getCurrentUser();
    const body = await request.json();
    const {
      materialId,
      lotNumber,
      receiveDate,
      mfgDate,
      expDate,
      quantity,
      costPerUnit,
      documentRef,
      remarks,
      createdBy,
    } = body;

    const userLabel = sessionUser
      ? `${sessionUser.name} (${ROLE_CONFIG[sessionUser.role]?.shortLabel || sessionUser.role})`
      : createdBy || 'เจ้าหน้าที่รับของ';

    if (!materialId || !lotNumber || !quantity || Number(quantity) <= 0) {
      return NextResponse.json(
        { error: 'กรุณาระบุวัตถุดิบ เลขล็อต และจำนวนที่รับเข้าให้ถูกต้อง' },
        { status: 400 }
      );
    }

    const qty = Number(quantity);

    const result = await prisma.$transaction(async (tx) => {
      // 1. Check if lot already exists for this material
      const existingLot = await tx.materialLot.findFirst({
        where: {
          materialId,
          lotNumber: String(lotNumber).trim(),
        },
        include: {
          material: true,
        },
      });

      let lot;
      if (existingLot) {
        lot = await tx.materialLot.update({
          where: { id: existingLot.id },
          data: {
            initialQuantity: existingLot.initialQuantity + qty,
            quantityRemaining: existingLot.quantityRemaining + qty,
            status: 'ACTIVE',
            ...(mfgDate ? { mfgDate: new Date(mfgDate) } : {}),
            ...(expDate ? { expDate: new Date(expDate) } : {}),
            ...(costPerUnit ? { costPerUnit: Number(costPerUnit) } : {}),
          },
          include: {
            material: true,
          },
        });
      } else {
        lot = await tx.materialLot.create({
          data: {
            materialId,
            lotNumber: String(lotNumber).trim(),
            receiveDate: receiveDate ? new Date(receiveDate) : new Date(),
            mfgDate: mfgDate ? new Date(mfgDate) : null,
            expDate: expDate ? new Date(expDate) : null,
            initialQuantity: qty,
            quantityRemaining: qty,
            costPerUnit: costPerUnit ? Number(costPerUnit) : 0,
            status: 'ACTIVE',
          },
          include: {
            material: true,
          },
        });
      }

      // 2. Create StockTransaction
      const transaction = await tx.stockTransaction.create({
        data: {
          materialId,
          lotId: lot.id,
          type: 'INBOUND',
          quantity: qty,
          lotBalanceAfter: lot.quantityRemaining,
          documentRef: documentRef || null,
          remarks: remarks || null,
          createdBy: userLabel,
          transactionDate: receiveDate ? new Date(receiveDate) : new Date(),
        },
      });

      return { lot, transaction, isExistingLot: !!existingLot };
    });

    // Write Audit Log (awaited)
    const matName = result.lot.material ? `[${result.lot.material.code}] ${result.lot.material.name}` : `(ID: ${materialId})`;
    await recordAuditLog({
      tableName: 'MaterialLot',
      recordId: result.lot.id,
      action: 'CREATE',
      summary: `รับวัตถุดิบเข้า: ${matName} ล็อต ${result.lot.lotNumber} จำนวน ${qty} ${result.lot.material?.baseUnit || 'หน่วย'}`,
      newData: { lot: result.lot, transaction: result.transaction },
      changedBy: userLabel,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
