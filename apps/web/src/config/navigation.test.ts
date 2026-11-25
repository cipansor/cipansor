import { describe, it, expect } from "vitest";
import { ClipboardCheck } from "lucide-react";
import {
  activeNavHref,
  getNavigationForRoleCode,
  withDutiesHeld,
  type NavGroup,
} from "./navigation";

const item = (href: string, children: string[] = []) => ({
  title: href,
  href,
  icon: ClipboardCheck,
  children: children.map((c) => ({ title: c, href: c, icon: ClipboardCheck })),
});

describe("activeNavHref — the one entry a page belongs to", () => {
  const nav: NavGroup[] = [
    { title: "Mengajar", items: [item("/attendance"), item("/classes")] },
    {
      title: "Wali Kelas",
      items: [item("/homeroom"), item("/attendance/record")],
    },
    { title: "Keuangan", items: [item("/finance", ["/finance/wallet"])] },
  ];

  it("lights the longest address the page sits at, not every one it sits under", () => {
    expect(activeNavHref(nav, "/attendance/record")).toBe("/attendance/record");
    expect(activeNavHref(nav, "/attendance")).toBe("/attendance");
  });

  it("a page with no entry of its own lights the section it sits in", () => {
    expect(activeNavHref(nav, "/attendance/calendar")).toBe("/attendance");
    expect(activeNavHref(nav, "/homeroom/behavior")).toBe("/homeroom");
  });

  it("reaches into submenus", () => {
    expect(activeNavHref(nav, "/finance/wallet/topup")).toBe("/finance/wallet");
  });

  it("a shared prefix is not a path: /classes-archive is not under /classes", () => {
    expect(activeNavHref(nav, "/classes-archive")).toBeNull();
  });

  it("a teacher who is a wali kelas has exactly one entry lit on the daily register", () => {
    const menu = withDutiesHeld(getNavigationForRoleCode("SDIT_GURU"), {
      homeroom: true,
    });
    const active = activeNavHref(menu, "/attendance/record");
    const lit = menu.flatMap((g) => g.items).filter((i) => i.href === active);
    expect(active).toBe("/attendance/record");
    expect(lit.map((i) => i.title)).toEqual(["Absensi Harian"]);
  });
});

describe("kepala sekolah sees the academic calendar", () => {
  const hrefs = (menu: NavGroup[]): string[] =>
    menu.flatMap((group) =>
      group.items.flatMap((item) => [
        item.href,
        ...(item.children ?? []).map((child) => child.href),
      ]),
    );

  it.each([
    "TKQ_KEPALA_SEKOLAH",
    "SDIT_KEPALA_SEKOLAH",
    "SMPIT_KEPALA_SEKOLAH",
    "SMAQ_KEPALA_SEKOLAH",
  ])("%s", (roleCode) => {
    expect(hrefs(getNavigationForRoleCode(roleCode))).toContain("/calendar");
  });

  it("a guru does not get the calendar menu", () => {
    expect(hrefs(getNavigationForRoleCode("SDIT_GURU"))).not.toContain(
      "/calendar",
    );
  });
});
