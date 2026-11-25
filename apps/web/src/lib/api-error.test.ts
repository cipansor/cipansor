import { describe, expect, it } from "vitest";
import {
  formatValidationErrors,
  getErrorMessage,
  parseApiError,
} from "./api-error";

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
      "Target: Target hafalan harus berupa jumlah juz, misalnya 10 juz",
    );
    expect(parseApiError(error).details).toEqual([
      "Target: Target hafalan harus berupa jumlah juz, misalnya 10 juz",
    ]);
  });

  it("falls back to the API field name when it has no label", () => {
    const error = axiosLike(400, {
      error: {
        message: "Validation failed",
        details: [{ field: "customField", message: "Tidak boleh kosong" }],
      },
    });

    expect(getErrorMessage(error)).toBe("customField: Tidak boleh kosong");
  });

  it("keeps API field paths as validation keys even when labels collide", () => {
    const error = axiosLike(400, {
      error: {
        message: "Validation failed",
        details: [
          { field: "student.name", message: "Wajib diisi" },
          { field: "guardian.name", message: "Wajib diisi" },
        ],
      },
    });

    expect(formatValidationErrors(error)).toEqual({
      "student.name": "Wajib diisi",
      "guardian.name": "Wajib diisi",
    });
    expect(getErrorMessage(error)).toBe("Nama: Wajib diisi");
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
