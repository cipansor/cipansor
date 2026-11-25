import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CalendarEvent } from "@cipansor/shared";
import { EventScope, EventType } from "@cipansor/shared";
import { CalendarEventForm } from "./calendar-event-form";

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const { createMutate, updateMutate, eventState } = vi.hoisted(() => ({
  createMutate: vi.fn(),
  updateMutate: vi.fn(),
  eventState: { current: null as CalendarEvent | null },
}));

vi.mock("@/hooks/use-calendar", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-calendar")>();
  return {
    ...actual,
    useCalendarEvent: () => ({
      data: eventState.current,
      isLoading: false,
      isError: false,
    }),
    useCreateCalendarEvent: () => ({ mutateAsync: createMutate }),
    useUpdateCalendarEvent: () => ({ mutateAsync: updateMutate }),
  };
});
vi.mock("@/hooks/use-units", () => ({ useUnits: () => ({ data: [] }) }));
vi.mock("@/hooks/use-classes", () => ({
  useClasses: () => ({ data: { data: [] } }),
}));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { userRoles: [] }, isLoading: false }),
}));
vi.mock("@/components/shared/unit-scope", () => ({
  useOverseesAllUnits: () => false,
  useSessionUnitId: () => null,
}));
vi.mock("@/hooks/use-calendar-permissions", () => ({
  useCanWriteCalendar: () => true,
}));
vi.mock("@/lib/calendar-access", () => ({
  canModifyCalendarEvent: () => true,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const event = (overrides: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: "event-1",
  title: "Rapat",
  description: null,
  eventType: EventType.MEETING,
  scope: EventScope.SPECIFIC_UNIT,
  startDate: "2026-11-25T00:00:00.000Z",
  endDate: "2026-11-26T00:00:00.000Z",
  isAllDay: true,
  startTime: null,
  endTime: null,
  location: "Aula",
  isOnline: false,
  onlineUrl: null,
  isRecurring: false,
  recurrenceRule: null,
  isPublic: true,
  isDraft: false,
  color: null,
  createdById: "user-1",
  createdAt: "2026-11-20T00:00:00.000Z",
  updatedAt: "2026-11-20T00:00:00.000Z",
  ...overrides,
});

describe("CalendarEventForm draft schedule", () => {
  it("keeps a title-only save free of schedule fields after the detail is refetched", async () => {
    eventState.current = event();
    const { rerender } = render(<CalendarEventForm eventId="event-1" />);

    // The query refetches and the event moves; the open draft stays as it was.
    eventState.current = event({
      startDate: "2026-12-03T00:00:00.000Z",
      endDate: "2026-12-04T00:00:00.000Z",
    });
    rerender(<CalendarEventForm eventId="event-1" />);

    fireEvent.change(screen.getByLabelText(/Judul Event/), {
      target: { value: "Rapat revisi" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Simpan/ }));

    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    const call = updateMutate.mock.calls[0][0] as {
      id: string;
      data: Record<string, unknown>;
    };
    expect(call.id).toBe("event-1");
    expect(call.data.title).toBe("Rapat revisi");
    expect(call.data.startDate).toBeUndefined();
    expect(call.data.endDate).toBeUndefined();
    expect(call.data.startTime).toBeUndefined();
    expect(call.data.endTime).toBeUndefined();
    expect(call.data.isAllDay).toBeUndefined();
  });
});
