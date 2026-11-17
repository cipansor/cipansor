import { z } from "zod";

/**
 * The laundry status flow, read by both the API and the web (#989, R27.10,
 * R22.6).
 *
 * `LAUNDRY_STATUS_FLOW` is the one table of legal transitions: the API accepts a
 * status change exactly when the pair is in it, and the Portal offers only the
 * statuses it names. Before this the table lived inside the service's
 * `updateStatus`, so the Portal and the API could disagree about which move is
 * allowed.
 */
export const LAUNDRY_STATUS_VALUES = [
  "RECEIVED", // Diterima
  "WASHING", // Sedang dicuci
  "DRYING", // Sedang dikeringkan
  "IRONING", // Sedang disetrika
  "READY", // Siap diambil
  "DELIVERED", // Sudah diambil
  "CANCELLED", // Dibatalkan
] as const;
export type LaundryStatusCode = (typeof LAUNDRY_STATUS_VALUES)[number];

export const LaundryStatusEnum = z.enum(LAUNDRY_STATUS_VALUES);

/** Every legal transition, keyed by the transaction's current status. */
export const LAUNDRY_STATUS_FLOW: Record<
  LaundryStatusCode,
  readonly LaundryStatusCode[]
> = {
  RECEIVED: ["WASHING", "CANCELLED"],
  WASHING: ["DRYING", "CANCELLED"],
  DRYING: ["IRONING", "READY", "CANCELLED"],
  IRONING: ["READY", "CANCELLED"],
  READY: ["DELIVERED", "CANCELLED"],
  DELIVERED: [],
  CANCELLED: [],
};

/** The statuses a transaction in `from` may move to — the flow's own list. */
export function laundryNextStatuses(
  from: LaundryStatusCode,
): readonly LaundryStatusCode[] {
  return LAUNDRY_STATUS_FLOW[from] ?? [];
}

/** Whether a `from` → `to` move is one the flow allows. */
export function laundryTransitionAllowed(
  from: LaundryStatusCode,
  to: LaundryStatusCode,
): boolean {
  return laundryNextStatuses(from).includes(to);
}
