import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

/**
 * The portal's Tambah form and its list (#1155).
 *
 * The form posted `category` where the API stores `eventType`, and the list
 * asked the API to filter on `category` where it filters on `eventType`. Neither
 * name exists on the model, so every create failed and every category filter
 * silently returned the whole list. These pin the wire shape — a hook that
 * renames a field back fails here rather than in a user's browser.
 */

const { get, post, del } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
}));

vi.mock("@/lib/api", () => {
  const api = { get, post, delete: del };
  return { api, default: api };
});

import { EventType } from "@cipansor/shared";
import {
  useCreateCalendarEvent,
  useDeleteCalendarEvent,
  useCalendarEvents,
  EVENT_CATEGORIES,
} from "./use-calendar";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue({
    data: { data: [], meta: { total: 0, page: 1, limit: 50, totalPages: 0 } },
  });
  post.mockResolvedValue({ data: { data: { id: "event-1" } } });
  del.mockResolvedValue({ data: {} });
});

describe("useCreateCalendarEvent", () => {
  it("posts `eventType`, the field the API stores", async () => {
    const { result } = renderHook(() => useCreateCalendarEvent(), { wrapper });

    await result.current.mutateAsync({
      title: "Ujian Tengah Semester",
      eventType: "EXAM",
      startDate: "2026-03-02",
      isAllDay: true,
      isPublic: true,
      recurrence: "NONE",
    });

    const [path, body] = post.mock.calls[0];
    expect(path).toBe("/calendar");
    expect(body.eventType).toBe("EXAM");
    expect(body).not.toHaveProperty("category");
  });
});

describe("useCalendarEvents", () => {
  it("asks the API to filter on `eventType`, not `category`", async () => {
    const { result } = renderHook(
      () => useCalendarEvents({ eventType: EventType.EXAM }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(get.mock.calls[0][1].params).toMatchObject({ eventType: "EXAM" });
    expect(get.mock.calls[0][1].params).not.toHaveProperty("category");
  });

  it("sends the search to the API so it runs before pagination", async () => {
    const { result } = renderHook(
      () => useCalendarEvents({ page: 2, search: "rapat" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(get.mock.calls[0][1].params).toMatchObject({
      page: 2,
      search: "rapat",
    });
  });

  it("leaves the error to the list instead of showing it twice", async () => {
    const { result } = renderHook(() => useCalendarEvents(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(get.mock.calls[0][1].skipErrorToast).toBe(true);
  });
});

describe("useDeleteCalendarEvent", () => {
  it("names the scope so a series can be removed as one", async () => {
    const { result } = renderHook(() => useDeleteCalendarEvent(), { wrapper });

    await result.current.mutateAsync({ id: "event-1", scope: "SERIES" });

    expect(del).toHaveBeenCalledWith("/calendar/event-1", {
      params: { scope: "SERIES" },
    });
  });

  it("defaults to removing one occurrence", async () => {
    const { result } = renderHook(() => useDeleteCalendarEvent(), { wrapper });

    await result.current.mutateAsync({ id: "event-1" });

    expect(del).toHaveBeenCalledWith("/calendar/event-1", {
      params: { scope: "SINGLE" },
    });
  });
});

describe("EVENT_CATEGORIES", () => {
  it("offers every category the API stores, and only those", () => {
    // A list that omits a stored value renders an empty badge; one that adds a
    // value the API lacks makes the form's save fail. Both shipped in #1155.
    expect(EVENT_CATEGORIES.map((c) => c.value).sort()).toEqual([
      "ACADEMIC",
      "CEREMONY",
      "EXAM",
      "EXTRACURRICULAR",
      "HOLIDAY",
      "MEETING",
      "OTHER",
      "RELIGIOUS",
    ]);
  });

  it("gives every category a label and a colour", () => {
    for (const category of EVENT_CATEGORIES) {
      expect(category.label.length).toBeGreaterThan(0);
      expect(category.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
