import { describe, it, expect, vi, beforeEach } from "vitest";
import { AxiosError } from "axios";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError } }));

import { api } from "./api";

function failingAdapter(status: number) {
  return async (config: any) => {
    throw new AxiosError(
      `Request failed with status code ${status}`,
      "ERR_BAD_REQUEST",
      config,
      undefined,
      {
        data: { message: "tidak ditemukan" },
        status,
        statusText: "Error",
        headers: {},
        config,
      } as never,
    );
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("api error toast", () => {
  it("suppresses the toast for a status the caller expects", async () => {
    await expect(
      api.get("/expected-404", {
        adapter: failingAdapter(404),
        skipErrorToastForStatus: [404],
      }),
    ).rejects.toBeInstanceOf(AxiosError);

    expect(toastError).not.toHaveBeenCalled();
  });

  it("still toasts a status the caller did not opt out of", async () => {
    await expect(
      api.get("/unexpected-500", {
        adapter: failingAdapter(500),
        skipErrorToastForStatus: [404],
      }),
    ).rejects.toBeInstanceOf(AxiosError);

    expect(toastError).toHaveBeenCalledWith(
      "tidak ditemukan",
      expect.anything(),
    );
  });
});
