import { User } from "./auth";

export enum MessageCategory {
  ACADEMIC = "ACADEMIC",
  BEHAVIOR = "BEHAVIOR",
  HEALTH = "HEALTH",
  GENERAL = "GENERAL",
  ATTENDANCE = "ATTENDANCE",
  TAHFIDZ = "TAHFIDZ",
}

export interface Message {
  id: string;
  senderId: string;
  recipientId: string;
  subject: string;
  content: string;
  category: MessageCategory;
  isRead: boolean;
  parentId?: string | null;
  createdAt: string;
  updatedAt: string;
  sender?: User;
  recipient?: User;
  parent?: Message;
  replies?: Message[];
  /** `GET /messages` counts each row's replies. */
  _count?: { replies: number };
}

export interface CreateMessageInput {
  recipientId: string;
  subject: string;
  content: string;
  category: MessageCategory;
  parentId?: string;
}

export interface MessageStats {
  unreadCount: number;
}
