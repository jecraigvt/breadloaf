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
