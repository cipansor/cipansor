// Reception / Front Office Module Types

export enum VisitStatus {
  PENDING = "PENDING",
  APPROVED = "APPROVED",
  REJECTED = "REJECTED",
  COMPLETED = "COMPLETED",
  CANCELLED = "CANCELLED",
}

export enum PackageStatus {
  RECEIVED = "RECEIVED",
  NOTIFIED = "NOTIFIED",
  PICKED_UP = "PICKED_UP",
  RETURNED = "RETURNED",
}

export interface GuestBook {
  id: string;
  unitId: string;
  name: string;
  institution?: string | null;
  purpose: string;
  phone?: string | null;
  checkIn: Date;
  checkOut?: Date | null;
  visitorCount: number;
  vehicleNumber?: string | null;
  receivedById: string;
  notes?: string | null;
  createdAt: Date;
  updatedAt: Date;

  // Relations
  receivedBy?: {
    name: string;
  };
}

export interface StudentVisit {
  id: string;
  studentId: string;
  unitId: string;
  visitorName: string;
  relationship: string; // Changed from relation to match page
  needs: string; // Changed from purpose to match page/impl
  checkIn: Date;
  checkOut?: Date | null;
  status: VisitStatus;
  notes?: string | null;
  createdAt: Date;
  updatedAt: Date;

  // Relations
  student?: {
    name: string;
    nis: string;
    class?: {
      name: string;
    };
  };
}

export interface StudentPackage {
  id: string;
  studentId: string;
  unitId: string;
  senderName: string;
  expedition: string; // Added to match page
  content: string; // Added to match page (description -> content)
  photoUrl?: string | null;
  storageLocation?: string | null;
  receivedAt: Date;
  receivedById: string;
  status: PackageStatus;
  pickedUpAt?: Date | null; // Changed from deliveredAt
  notes?: string | null;
  createdAt: Date;
  updatedAt: Date;

  // Relations
  student?: {
    name: string;
    nis: string;
    class?: {
      name: string;
    };
  };
  receivedBy?: {
    name: string;
  };
}

// DTOs
export interface CreateGuestBookInput {
  name: string;
  institution?: string;
  purpose: string;
  phone?: string;
  visitorCount?: number;
  vehicleNumber?: string;
  notes?: string;
}

export interface UpdateGuestBookInput {
  checkOut?: Date;
  notes?: string;
}

export interface CreateStudentVisitInput {
  studentId: string;
  visitorName: string;
  relationship: string;
  needs: string;
  notes?: string;
}

export interface UpdateStudentVisitInput {
  checkOut?: Date;
  status?: VisitStatus;
  notes?: string;
}

export interface CreateStudentPackageInput {
  studentId: string;
  senderName: string;
  expedition: string;
  content: string;
  photoUrl?: string;
  storageLocation?: string;
  notes?: string;
}

export interface UpdateStudentPackageInput {
  status?: PackageStatus;
  pickedUpAt?: Date;
  notes?: string;
}

export interface ReceptionStats {
  guestsToday: number;
  activeVisits: number;
  pendingPackages: number;
}
