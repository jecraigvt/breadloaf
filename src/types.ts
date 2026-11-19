import type { Prisma, Stay } from "@prisma/client";

export type StayType = Stay;

export type RoomWithStays = Prisma.RoomGetPayload<{
  include: { stays: true };
}>;

export type DocumentWithCategory = Prisma.DocumentGetPayload<{
  include: { category: true };
}> & {
  displaySummary?: string | null;
  scan?: {
    relativePath: string;
    pageCount: number | null;
    pages: { number: number; years: number[]; needsReview: boolean }[];
    related: { id: string; name: string }[];
  };
};
