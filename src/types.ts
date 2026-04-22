import type { Prisma, Stay } from "@prisma/client";

export type StayType = Stay;

export type RoomWithStays = Prisma.RoomGetPayload<{
  include: { stays: true };
}>;

export type DocumentWithCategory = Prisma.DocumentGetPayload<{
  include: { category: true };
}>;
