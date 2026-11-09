import { prisma, type Db } from '@/lib/prisma';
import { wibMonthYear } from '@/utils/wib-day';

export const generateUniqueCode = async (
  prefix: string,
  table: string,
  tx: Db = prisma
): Promise<string> => {
  const [code] = await generateBulkUniqueCodes(prefix, table, 1, tx);
  return code;
};

export const generateBulkUniqueCodes = async (
  prefix: string,
  table: string,
  count: number,
  tx: Db = prisma
): Promise<string[]> => {
  if (count < 1) return [];

  // The code is printed on documents and asset labels, so the month and year
  // follow the WIB calendar (UTC+7), not the host clock — the API container
  // sets no TZ, so `getMonth()`/`getFullYear()` read UTC and a code minted at
  // 00:00–06:59 WIB would carry the previous month, and in January the
  // previous year.
  const { year, month } = wibMonthYear(new Date());
  const codePrefix = `${prefix}-${year}${String(month + 1).padStart(2, '0')}-`;

  let lastRecord: { code: string } | null = null;

  // We use the provided transaction client 'tx' to ensure consistency
  if (table === 'purchase_requests') {
    lastRecord = await tx.purchaseRequest.findFirst({
      where: { code: { startsWith: codePrefix } },
      orderBy: { code: 'desc' },
      select: { code: true },
    });
  } else if (table === 'assets') {
    lastRecord = await tx.asset.findFirst({
      where: { code: { startsWith: codePrefix } },
      orderBy: { code: 'desc' },
      select: { code: true },
    });
  }

  let startSequence = 1;
  if (lastRecord && lastRecord.code) {
    const lastCode = lastRecord.code;
    const lastSequence = parseInt(lastCode.split('-').pop() || '0');
    startSequence = lastSequence + 1;
  }

  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    codes.push(`${codePrefix}${String(startSequence + i).padStart(4, '0')}`);
  }

  return codes;
};
