import { describe, expect, it } from "vitest";
import { getErrorMessage, parseApiError } from "./api-error";

const axiosLike = (status: number, data: unknown) => ({
  response: { status, data },
});

describe("parseApiError", () => {
  it("shows the reason the API gave in its error envelope", () => {
    const error = axiosLike(400, {
      success: false,
      error: {
        code: "BAD_REQUEST",
        message: "Kata sandi ini terlalu umum atau pernah bocor.",
      },
    });
    expect(getErrorMessage(error)).toBe(
      "Kata sandi ini terlalu umum atau pernah bocor.",
    );
    expect(parseApiError(error).isValidationError).toBe(true);
  });

  it("shows the field reason when the envelope only says Validation failed", () => {
    const error = axiosLike(400, {
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Validation failed",
        details: [
          {
            field: "targetValue",
            message: "Target hafalan harus berupa jumlah juz, misalnya 10 juz",
          },
        ],
      },
    });

    expect(getErrorMessage(error)).toBe(
      "Target hafalan harus berupa jumlah juz, misalnya 10 juz",
    );
    expect(parseApiError(error).details).toEqual([
      "targetValue: Target hafalan harus berupa jumlah juz, misalnya 10 juz",
    ]);
  });

  it("still reads a bare message", () => {
    expect(getErrorMessage(axiosLike(409, { message: "Sudah ada." }))).toBe(
      "Sudah ada.",
    );
  });

  it("falls back to the status's own sentence when the API said nothing", () => {
    expect(getErrorMessage(axiosLike(400, {}))).toBe(
      "Data yang dikirim tidak sesuai format. Periksa kembali input Anda.",
    );
  });
});
