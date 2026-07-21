import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type JsonValue = Prisma.InputJsonValue;

export interface LedgerInput {
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

export interface ToolAuditMetadata {
  entityType?: string;
  entityId?: string;
  beforeState?: unknown;
  afterState?: unknown;
  reversible?: boolean;
}

const REVERSIBLE_ACTIONS = new Set(["set_document_category", "update_position"]);

export function isUndoSupportedAction(actionType: string): boolean {
  return REVERSIBLE_ACTIONS.has(actionType);
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
  set_document_category: (_args, result) => {
    const document = result.document as { title?: string } | undefined;
    return `Filed ${document?.title || "document"} under ${result.category || "the selected category"}`;
  },
  add_bulletin_message: () => "Posted a family bulletin message",
  add_dinner_signup: (args) => `Added ${args.chef} as dinner cook for ${args.date}`,
  add_pantry_item: (args) => `Added ${args.name} to the pantry`,
  save_memory: (args, result) => `${result.action === "unchanged" ? "Confirmed" : result.action === "updated" ? "Updated" : "Saved"} memory: ${args.topic}`,
  add_expense: (args) => `Recorded expense: ${args.description} ($${args.amount})`,
  ask_family: (args) => `Asked the family: ${args.question}`,
  update_position: (_args, result) => `${result.currentHolder} became ${result.position}${result.previousHolder ? `, replacing ${result.previousHolder}` : ""}`,
};

const TOOL_ENTITY_TYPES: Record<string, string> = {
  add_grocery_item: "grocery_item",
  create_stay: "stay",
  add_maintenance_record: "maintenance_record",
  save_asset: "asset",
  set_document_category: "document",
  add_bulletin_message: "bulletin_message",
  add_dinner_signup: "dinner_signup",
  add_pantry_item: "pantry_item",
  save_memory: "memory",
  add_expense: "expense",
  ask_family: "question",
  update_position: "position",
};

function genericSummary(toolName: string): string {
  const action = toolName.replace(/_/g, " ");
  return `Completed: ${action.charAt(0).toUpperCase()}${action.slice(1)}`;
}

function jsonValue(value: unknown): JsonValue | undefined {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

export function stripToolAuditMetadata(result: Record<string, unknown>): Record<string, unknown> {
  const publicResult = { ...result };
  delete publicResult._audit;
  return publicResult;
}

export function buildLedgerInput(
  toolName: string,
  args: Record<string, unknown>,
  result: Record<string, unknown>,
  initiatedBy?: string
): LedgerInput | null {
  if (result.success !== true) return null;

  const audit = result._audit as ToolAuditMetadata | undefined;
  const publicResult = stripToolAuditMetadata(result);
  const entity = (
    publicResult.item || publicResult.stay || publicResult.record || publicResult.asset ||
    publicResult.document || publicResult.message || publicResult.dinner || publicResult.memory ||
    publicResult.expense || publicResult.question
  ) as { id?: string } | undefined;
  const summarize = TOOL_SUMMARIES[toolName];

  return {
    actionType: toolName,
    summary: summarize ? summarize(args, publicResult) : genericSummary(toolName),
    initiatedBy,
    entityType: audit?.entityType || TOOL_ENTITY_TYPES[toolName] || "bucky_action",
    entityId: audit?.entityId || entity?.id,
    sourceType: typeof args.sourceType === "string" ? args.sourceType : "conversation",
    sourceId: typeof args.sourceId === "string" ? args.sourceId : undefined,
    sourceLabel: typeof args.source === "string" ? args.source : undefined,
    beforeState: jsonValue(audit?.beforeState),
    afterState: jsonValue(audit?.afterState ?? publicResult),
    reversible: Boolean(audit?.reversible && isUndoSupportedAction(toolName)),
  };
}

export async function recordBuckyToolResult(
  toolName: string,
  args: Record<string, unknown>,
  result: Record<string, unknown>,
  initiatedBy?: string
) {
  const input = buildLedgerInput(toolName, args, result, initiatedBy);
  return input ? recordBuckyLedgerEntry(input) : null;
}
