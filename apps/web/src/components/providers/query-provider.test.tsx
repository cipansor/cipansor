import { describe, it, expect, vi, beforeEach } from "vitest";
import { AxiosError } from "axios";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError } }));

import { handleQueryError } from "./query-provider";

describe("handleQueryError", () => {
  beforeEach(() => vi.clearAllMocks());

  it("toasts a generic message for an unknown error", () => {
    handleQueryError(new Error("boom"), undefined, undefined, {});
    expect(toastError).toHaveBeenCalled();
  });

  it("stays silent for a mutation that opted out via meta", () => {
    // The push reconciliation runs on every authenticated page and must not
    // raise "missing permission" / "route not found" at the user.
    handleQueryError(new Error("boom"), undefined, undefined, {
      meta: { silentError: true },
    });
    expect(toastError).not.toHaveBeenCalled();
  });

  it("stays silent for a request that opted out via skipErrorToast", () => {
    const error = new AxiosError("nope");
    error.config = { skipErrorToast: true } as never;
    handleQueryError(error, undefined, undefined, {});
    expect(toastError).not.toHaveBeenCalled();
  });

  it("stays silent only for the status the request expected", () => {
    const expected = new AxiosError("nope");
    expected.response = { status: 404 } as never;
    expected.config = { skipErrorToastForStatus: [404] } as never;
    handleQueryError(expected, undefined, undefined, {});
    expect(toastError).not.toHaveBeenCalled();

    const unexpected = new AxiosError("boom");
    unexpected.response = { status: 500 } as never;
    unexpected.config = { skipErrorToastForStatus: [404] } as never;
    handleQueryError(unexpected, undefined, undefined, {});
    expect(toastError).toHaveBeenCalled();
  });
});
