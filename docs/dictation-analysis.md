# Dictations: source, display, and Bucky's internal notes

Completed audio intake retains its recording and automated transcript. Chat
passes the first transcript into document filing rather than transcribing the
same audio a second time. An archived duplicate reuses the retained transcript.
Background reanalysis and the archive backfill also preserve existing transcripts.

The archive and maintenance log show one display sentence, original audio controls,
and the complete transcript in an expandable section. Existing descriptions and
summaries are retained; they are not overwritten to change presentation. The
authenticated recording routes support byte ranges for playback and seeking.

`DictationAnalysis` is a separate derived table keyed by the retained file path.
Its display sentence describes the dictation alone. Its internal summary retains
details of the dictation; separate connection entries link to other source records.
Connections are always `possible` or `likely`, never confirmed. Each needs a
server-resolved source and matching evidence from both original texts. The model
cannot provide arbitrary links or a replacement transcript. This follows the
[Structured Outputs interface](https://developers.openai.com/api/docs/guides/structured-outputs).

Analysis searches relevant family documents, active memories, and maintenance
records. It reopens their retained text rather than treating old inferred links
as evidence. Bucky loads the internal note when the associated source is retrieved;
referenced records must still be accessible and contain the cited evidence.
Connections are excluded from embeddings so a removed source's evidence cannot
survive there. The original transcript remains searchable.

This runs as an awaited enrichment attempt after ordinary audio intake is saved.
It does not change the background queue, local-worker settings, or fallback budget.
If analysis fails, the original remains saved and the display uses a short fallback;
an intake retry or the backfill can retry the internal analysis. These are inference
notes, not new maintenance actions, insurance claims, or family notifications.

For existing family recordings, list candidates without provider calls:

```powershell
npx tsx scripts/backfill-dictation-analysis.ts
```

With the migration applied and the normal database/OpenAI environment configured,
add `--apply` to save derived analyses and refresh indexes. Use `--only=DOCUMENT_ID`
for one recording, or `--force` to refresh existing analyses against current source
records. No transcript, audio file, human title, category, or description is changed.

On September 10, the two unprocessed maintenance Word files were rechecked against
their live originals. Both contained zero text nodes, no images, and four embedded
font files. At Jeremy's request, both were moved to Recently Deleted through the
normal archive API. The live count afterward was 50 analyzed / 50 active, zero issues.

Validation covers evidence and source-link checks, one-sentence display, immutable
transcripts during reanalysis, original-byte retention, audio range responses, and
mobile/desktop archive and maintenance views.
