# Hosted Hydrogen generation

Updated November 12, 2026. The August OpenAI migration documents describe historical work; the September queue and local-worker policies continue to apply.

## Providers

`src/lib/ai-models.ts` owns every model ID. Both hosted generation tiers use Gemini 4 Hydrogen through the native Google Interactions API. Routine chat and intake use low thinking; heavy chat and Tidy Up use high thinking. Paid background requests use low thinking within their existing 4,096-token combined output allowance. The migration covers document and image categorization, narration splitting, Mail Room, link analysis, retrieval-query distillation, dictation intelligence, Tidy Up, archive verification questions, and paid background generation.

Local queued work continues through the signed-in Codex subscription using `MODELS.localWorker`. Embeddings remain on OpenAI in the existing vector space, so this migration requires no reindexing. Audio transcription keeps its dedicated Gemini model. Video transcription uses native Hydrogen video input with a verbatim-transcript instruction.

## Credentials and contracts

Railway needs `GOOGLE_AI_API_KEY` for generation and transcription, and `OPENAI_API_KEY` for embeddings. The GitHub background workflow separately needs a `GOOGLE_AI_API_KEY` repository secret. No hosted key is copied into the local subscription worker.

`gemini-generation.ts` sends native stateless requests with `store: false`, validates completion, and validates structured results against the existing Zod schemas. Chat replays the complete native model steps, including thoughts and signatures, between tool rounds. Existing tool permissions, ledger recording, undo, and the eight-round action limit remain in force.

Paid background requests disable both SDK and application retries within an attempt. The existing monthly and per-attempt limits, source checkpoints, eligibility delay, and reservations are unchanged. Standard Hydrogen rates are $1.50 per million input tokens and $7.50 per million output tokens, including thoughts. Cached input is conservatively charged at the full rate. Missing or ambiguous usage retains conservative reservation charging.

## Verification and rollback

Unit tests cover native request schemas, multimodal inputs, malformed and incomplete responses, tool-history replay, retry boundaries, and thinking-token accounting. Existing PostgreSQL integrations and the HTTP worker smoke exercise durable jobs with a mock native provider in CI. `scripts/verify-hydrogen.ts` runs small, synthetic live checks for structured text, a tool round trip with no real actions, PDF extraction, and metered high-thinking output using the full Bucky tool declarations. An optional `--video` argument accepts a silent synthetic MP4 to verify native video input. These live checks passed on November 12. The script prints no credentials and accesses no family records.

Run the live check explicitly with `GOOGLE_AI_API_KEY` available:

```powershell
railway run --service breadloaf-app npx tsx scripts/verify-hydrogen.ts
```

Rollback the complete migration commit through a branch and verified PR. Merely changing the model strings back is insufficient because the native request integration changed too. Retain the OpenAI key for embeddings.

Official references: [release notes](https://aistudio.google.com/docs/changelog#11-12-2026), [Interactions](https://aistudio.google.com/docs/interactions-overview), [stateless tool calls](https://aistudio.google.com/docs/function-calling#stateless-function-calling), and [pricing](https://aistudio.google.com/docs/pricing#gemini-4-hydrogen).
