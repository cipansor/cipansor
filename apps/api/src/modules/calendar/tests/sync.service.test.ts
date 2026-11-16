import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAcademicEvents } from '../sync.service';
import { prisma } from '@/lib/prisma';

// Mock Prisma
vi.mock('@/lib/prisma', () => ({
  prisma: {
    calendarEvent: {
      findMany: vi.fn(),
    },
  },
}));

// Local mock for EventType to avoid importing from @prisma/client
const EventType = {
  ACADEMIC: 'ACADEMIC',
  HOLIDAY: 'HOLIDAY',
  RELIGIOUS: 'RELIGIOUS',
};

describe('CalendarSyncService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getAcademicEvents', () => {
    it('should return academic events filtered by unit', async () => {
      const mockEvents = [
        {
          id: '1',
          title: 'Event 1',
          startDate: new Date('2023-01-01'),
          endDate: new Date('2023-01-02'),
          isAllDay: true,
          eventType: EventType.ACADEMIC,
        },
        {
          id: '2',
          title: 'Event 2',
          startDate: new Date('2023-01-03'),
          endDate: null,
          isAllDay: false,
          eventType: EventType.HOLIDAY,
        },
      ];

      (prisma.calendarEvent.findMany as any).mockResolvedValue(mockEvents);

      const result = await getAcademicEvents('unit-1');

      expect(prisma.calendarEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [{ unitId: 'unit-1' }, { unitId: null, isPublic: true }],
          }),
        })
      );

      expect(result).toHaveLength(2);
      expect(result[0].category).toBe('academic');
      expect(result[1].category).toBe('holiday');
      // Check fallback endDate
      expect(result[1].endDate).toEqual(result[1].startDate);
    });

    it('should filter by date range with overlap logic', async () => {
      (prisma.calendarEvent.findMany as any).mockResolvedValue([]);
      const startDate = new Date('2023-01-01');
      const endDate = new Date('2023-01-31');

      await getAcademicEvents('unit-1', startDate, endDate);

      expect(prisma.calendarEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([
              { startDate: { lte: endDate } },
              {
                OR: expect.arrayContaining([
                  { endDate: { gte: startDate } },
                  { endDate: null, startDate: { gte: startDate } },
                ]),
              },
            ]),
          }),
        })
      );
    });
  });
});
