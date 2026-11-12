import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api", () => {
  const api = { get };
  return { api, default: api };
});

import { useTodayMenus, type MealMenu } from "./use-meals";

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

const UNIT = "unit-smp-it";

const menu = (mealType: MealMenu["mealType"], mainDish: string): MealMenu =>
  ({
    id: `${mealType}-1`,
    name: `${mealType} menu`,
    mealType,
    dayType: "ALL",
    date: "2026-10-27",
    mainDish,
    unitId: UNIT,
    isActive: true,
    createdAt: "2026-10-27T00:00:00Z",
    updatedAt: "2026-10-27T00:00:00Z",
  }) as MealMenu;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useTodayMenus", () => {
  it("memanggil rute ber-unitId di path, bukan /menus/today yang dibayangi /menus/:id", async () => {
    // #849: the page called `GET /meals/menus/today?unitId=`, which no route
    // answers — `/menus/:id` matched it with `id = "today"` and returned 404, so
    // the Hari Ini tab was always empty. The canonical route carries the unit in
    // the path.
    get.mockResolvedValue({
      data: { data: [menu("BREAKFAST", "Nasi Kuning")] },
    });

    const { result } = renderHook(() => useTodayMenus(UNIT), {
      wrapper: wrapper(makeClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith(`/meals/menus/today/${UNIT}`);
    expect(get).not.toHaveBeenCalledWith(
      "/meals/menus/today",
      expect.anything(),
    );
  });

  it("melipat daftar balasan menjadi objek per jenis makan yang dibaca halaman", async () => {
    // The handler returns an array; the page reads `todayMenus.lunch` etc. An
    // array left as-is rendered every card empty.
    get.mockResolvedValue({
      data: {
        data: [
          menu("BREAKFAST", "Nasi Kuning"),
          menu("LUNCH", "Nasi Putih"),
          menu("DINNER", "Lele Goreng"),
        ],
      },
    });

    const { result } = renderHook(() => useTodayMenus(UNIT), {
      wrapper: wrapper(makeClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.breakfast?.mainDish).toBe("Nasi Kuning");
    expect(result.current.data?.lunch?.mainDish).toBe("Nasi Putih");
    expect(result.current.data?.dinner?.mainDish).toBe("Lele Goreng");
    expect(result.current.data?.snack).toBeUndefined();
  });

  it("tidak memanggil API tanpa unit, karena 'Semua Unit' tidak diagregasi (K5)", async () => {
    const { result } = renderHook(() => useTodayMenus(undefined), {
      wrapper: wrapper(makeClient()),
    });

    // The query is disabled: no unit means no request, and the page asks the
    // user to pick one instead of aggregating.
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(get).not.toHaveBeenCalled();
  });
});
