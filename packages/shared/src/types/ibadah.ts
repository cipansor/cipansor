/**
 * One row of an ibadah ranking (`GET /ibadah/leaderboard`), as the API sends
 * it. Both ibadah pages used to read `student.name` and `streakDays`, which
 * the API never sent: every name showed as "Unknown" and every streak as
 * "undefined hari".
 */
export interface IbadahLeaderboardEntry {
  rank: number;
  studentId: string;
  /** The santri's account, so a santri can find their own row. */
  userId: string | null;
  studentName: string;
  nis: string;
  className: string;
  totalPoints: number;
  bonusPoints: number;
  recordCount: number;
  completionRate: number;
}

export interface IbadahLeaderboardResult {
  periodType: string;
  startDate: string | Date;
  endDate: string | Date;
  data: IbadahLeaderboardEntry[];
}
