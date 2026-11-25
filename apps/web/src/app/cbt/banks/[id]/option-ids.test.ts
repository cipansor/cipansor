import { describe, expect, it } from "vitest";
import {
  answerKeyIdOf,
  nextOptionId,
  normalizeOptions,
  optionIdOf,
  uniqueOptionIds,
} from "./option-ids";

describe("option ids", () => {
  it("trims stored ids and keys the way the API compares them", () => {
    expect(optionIdOf(" B ", 3)).toBe("B");
    expect(optionIdOf(undefined, 2)).toBe("C");
    expect(answerKeyIdOf(" B ")).toBe("B");
    expect(answerKeyIdOf({ id: " B " })).toBe("B");
    expect(answerKeyIdOf("   ")).toBeNull();
  });

  it("picks the first unused letter, so a removed option is filled again", () => {
    expect(nextOptionId([])).toBe("A");
    expect(nextOptionId(["A", "C", "D"])).toBe("B");
    expect(nextOptionId(["A", "B", "C", "D"])).toBe("E");
  });

  it("falls back past Z without colliding", () => {
    const letters = Array.from({ length: 26 }, (_, i) =>
      String.fromCharCode(65 + i),
    );
    expect(nextOptionId(letters)).toBe("OPT27");
    expect(nextOptionId([...letters, "OPT27"])).toBe("OPT28");
  });

  it("re-letters only a duplicate, keeping the first one the key names", () => {
    const options = [
      { id: "A", text: "3" },
      { id: "C", text: "4" },
      { id: "D", text: "5" },
      { id: "D", text: "6" },
    ];

    expect(uniqueOptionIds(options).map((o) => o.id)).toEqual([
      "A",
      "C",
      "D",
      "B",
    ]);
    expect(uniqueOptionIds(options)[2].text).toBe("5");
  });

  it("reserves stored ids so a blank option cannot take the key's id", () => {
    const options = [
      { id: "A", text: "Bandung" },
      { id: " ", text: "Surabaya" },
      { id: "B", text: "Jakarta" },
    ];

    const normalized = uniqueOptionIds(options, "B");
    expect(normalized.map((o) => o.id)).toEqual(["A", "C", "B"]);
    expect(normalized[1].text).toBe("Surabaya");
    expect(normalized[2].text).toBe("Jakarta");
  });

  it("does not hand a replacement an id another option still owns", () => {
    const options = [
      { id: "A", text: "satu" },
      { id: "A", text: "dua" },
      { id: "B", text: "tiga" },
    ];

    expect(uniqueOptionIds(options).map((o) => o.id)).toEqual(["A", "C", "B"]);
    // The key still names the third option, not the re-lettered duplicate.
    expect(uniqueOptionIds(options)[2].text).toBe("tiga");
  });

  it("turns legacy string options into form options the key still matches", () => {
    const normalized = uniqueOptionIds(
      normalizeOptions(["-31", "-14", "46", "1"]),
      "-31",
    );

    expect(normalized.map((o) => o.id)).toEqual(["-31", "-14", "46", "1"]);
    expect(normalized[0].text).toBe("-31");
  });
});
