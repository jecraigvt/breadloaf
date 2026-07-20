export interface DocumentWithCategory {
  id: string;
  title: string;
  description: string | null;
  fileName: string;
  filePath: string;
  fileType: string;
  fileSize: number;
  categoryId: string | null;
  tags: string | null;
  aiSummary: string | null;
  aiExtractedText: string | null;
  uploadedBy: string | null;
  checksum: string | null;
  accessScope: string;
  backupStatus: string;
  deletedAt: Date | null;
  deletedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  category: {
    id: string;
    name: string;
    slug: string;
    icon: string | null;
    color: string | null;
  } | null;
}

export interface ChatMessageType {
  role: "user" | "model";
  content: string;
}

export interface BulletinMessageType {
  id: string;
  author: string;
  content: string;
  pinned: boolean;
  createdAt: Date;
}

export interface RoomType {
  id: string;
  name: string;
  slug: string;
  type: string;
  minCapacity: number;
  maxCapacity: number;
  hasCrib: boolean;
  description: string | null;
  sortOrder: number;
}

export interface StayType {
  id: string;
  guestName: string;
  roomId: string | null;
  room: RoomType | null;
  checkIn: Date;
  checkOut: Date;
  notes: string | null;
  status: string;
  googleEventId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RoomWithStays extends RoomType {
  stays: StayType[];
}
