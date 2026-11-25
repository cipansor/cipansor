"use client";

import { useAuth } from "@/hooks/use-auth";
import { useUnits } from "@/hooks/use-units";
import { overseesAllUnits, sessionUnitId } from "@/lib/session-scope";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * The yayasan's organs oversee every unit and belong to none: their token
 * carries no unit. The API shows them every unit and lets them narrow to one
 * (`listUnitScope` in the API's resolve-unit-id.ts); everyone else is pinned
 * to their own, so these controls are only for the former.
 *
 * The scope comes from the active role assignment, not the profile unit: a
 * person can hold a yayasan role and a unit role, and the API follows the
 * active one.
 */
export function useOverseesAllUnits(): boolean {
  const { user } = useAuth();
  return overseesAllUnits(user);
}

/** The unit the active role writes into, matching the API's `tokenUnitId`. */
export function useSessionUnitId(): string | undefined {
  const { user } = useAuth();
  return sessionUnitId(user);
}

const ALL = "ALL";

/** "Semua unit" or one unit — for a list the yayasan's organs read across units. */
export function UnitScopeFilter({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (unitId: string | undefined) => void;
}) {
  const { data: units } = useUnits();
  return (
    <Select
      value={value ?? ALL}
      onValueChange={(v) => onChange(v === ALL ? undefined : v)}
    >
      <SelectTrigger className="w-[200px]" aria-label="Unit">
        <SelectValue placeholder="Semua unit" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>Semua unit</SelectItem>
        {units?.map((u) => (
          <SelectItem key={u.id} value={u.id}>
            {u.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** The unit a new row belongs to, for a writer who belongs to no unit. */
export function UnitSelect({
  id,
  value,
  onChange,
}: {
  id?: string;
  value: string | undefined;
  onChange: (unitId: string) => void;
}) {
  const { data: units } = useUnits();
  return (
    // "" matches no item, so the placeholder shows until a unit is chosen.
    <Select value={value ?? ""} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder="Pilih unit" />
      </SelectTrigger>
      <SelectContent>
        {units?.map((u) => (
          <SelectItem key={u.id} value={u.id}>
            {u.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
