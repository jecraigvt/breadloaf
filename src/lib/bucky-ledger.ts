import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type JsonValue = Prisma.InputJsonValue;

interface LedgerInput {
  actionType: string;
  summary: string;
  details?: string;
  initiatedBy?: string;
  entityType?: string;
  entityId?: string;
  sourceType?: string;
  sourceId?: string;
  sourceLabel?: string;
  beforeState?: JsonValue;
  afterState?: JsonValue;
  reversible?: boolean;
}

export async function recordBuckyLedgerEntry(input: LedgerInput) {
  return prisma.buckyLedgerEntry.create({
    data: {
      actionType: input.actionType,
      summary: input.summary,
      details: input.details,
      initiatedBy: input.initiatedBy,
      entityType: input.entityType,
      entityId: input.entityId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      sourceLabel: input.sourceLabel,
      beforeState: input.beforeState,
      afterState: input.afterState,
      reversible: input.reversible ?? false,
    },
  });
}

const TOOL_SUMMARIES: Record<string, (args: Record<string, unknown>, result: Record<string, unknown>) => string> = {
  add_grocery_item: (args) => `Added ${args.name} to the grocery list`,
  create_stay: (_args, result) => {
    const stay = result.stay as { guestName?: string; checkIn?: string; checkOut?: string } | undefined;
    return `Added ${stay?.guestName || "a family stay"} to the calendar${stay?.checkIn ? ` for ${stay.checkIn} to ${stay.checkOut}` : ""}`;
  },
  add_maintenance_record: (args) => `Added maintenance record: ${args.title}`,
  save_asset: (_args, result) => {
    const asset = result.asset as { name?: string } | undefined;
    return `${result.action === "created" ? "Added" : "Updated"} property system: ${asset?.name || "unnamed asset"}`;
  },
  add_bulletin_message: () => "Posted a family bulletin message",
  add_dinner_signup: (args) => `Added ${args.chef} as dinner cook for ${args.date}`,
  add_pantry_item: (args) => `Added ${args.name} to the pantry`,
  save_memory: (args, result) => `${result.action === "updated" ? "Updated" : "Saved"} memory: ${args.topic}`,
  add_expense: (args) => `Recorded expense: ${args.description} ($${args.amount})`,
  ask_family: (args) => `Asked the family: ${args.question}`,
};

export async function recordBuckyToolResult(
  toolName: string,
  args: Record<string, unknown>,
  result: Record<string, unknown>,
  initiatedBy?: string
) {
  if (result.success !== true || toolName === "update_position") return;
  const summarize = TOOL_SUMMARIES[toolName];
  if (!summarize) return;

  const entity = (result.item || result.stay || result.record || result.asset || result.message || result.dinner || result.expense || result.question) as
    | { id?: string }
    | undefined;

  await recordBuckyLedgerEntry({
    actionType: toolName,
    summary: summarize(args, result),
    initiatedBy,
    entityType: toolName.replace(/^(add|save|create)_/, ""),
    entityId: entity?.id,
    sourceType: typeof args.sourceType === "string" ? args.sourceType : "conversation",
    sourceId: typeof args.sourceId === "string" ? args.sourceId : undefined,
    sourceLabel: typeof args.source === "string" ? args.source : undefined,
    afterState: result as JsonValue,
  });
}
