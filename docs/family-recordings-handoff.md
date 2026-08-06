# Family Recordings — Handoff

**Written:** 2026-08-06
**For:** the implementing agent (Codex)
**Reviewed by:** Claude, after implementation
**Baseline commit:** `97941d7`

---

## Why this exists

The owner's father wants to record memories with Bucky, and wants the four
brothers to do the same. He asked specifically that **the audio be kept**, not
only the transcript.

He is right to ask, and the system currently does the opposite.

---

## The bug: quick-note audio is discarded

`src/app/api/assistant/route.ts` routes audio like this:

```
transcribeMediaBuffer(buffer)        // transcribe
  -> triageTextDocument(transcript)  // classify
  -> if quick note: captureQuickVoiceNote(...)  // create JarvisMemory
  -> continue                        // <-- skips fileDocumentFromBuffer
```

`fileDocumentFromBuffer` is the only thing that writes the file to disk. A quick
note never reaches it, so **the buffer is transcribed and thrown away.**

Two recordings have already lost their audio this way — the McCabe family-tree
notes from 2026-08-06. Their transcripts survive as memories; the recordings do
not.

This is a side effect of task 18, and task 18 was right about the thing it was
solving. Stopping five-second notes from cluttering the archive was correct.
Coupling that decision to file retention was not. **"Should this be an archive
document?" and "should we keep the file?" are different questions** and were
answered with one branch.

**Every voice note recorded before this is fixed loses its audio permanently.**
That is why this jumps the queue.

---

## The distinction that shapes the feature

"Memories" means two different things here, and they want opposite handling.

**A fact** — the gate code, the furnace reset procedure. The transcript *is* the
value; the audio is packaging. This is what `JarvisMemory` already models, and
it works.

**A story** — how they got the property, what the barn was like before the
renovation, why the Woods Cabin has a compost toilet. Here **the recording is
the artifact.** In thirty years the grandchildren want their grandfather's
voice, his pauses, the way he laughs partway through. A paragraph of extracted
text is not a substitute for that, and no amount of retrieval quality makes it
one.

The system only models the first today.

---

## Storage is not a constraint — measured 2026-08-06

```
archive total                126.4MB across 48 files
audio currently kept          6 files, 2.5MB, avg 0.41MB each
```

At that bitrate an hour of speech is roughly 20MB. Four brothers recording ten
hours each lands under a gigabyte. For comparison the single
`Bestor_Photos_170.pdf` is 52MB — 40% of the whole archive today.

**Keep every recording at full quality.** Do not add compression, expiry, or a
retention policy. If the volume ever becomes tight the answer is a larger volume,
not deleted family voices.

---

## Task 23 — Always keep the audio

**Urgent, small, do first and ship on its own if convenient.**

Persist every uploaded audio file regardless of how triage routes it. Decouple
file retention from document filing: routing decides whether a `Document` row
and archive entry are created; it must not decide whether the bytes survive.

A quick-note `JarvisMemory` should reference the stored file so the recording can
be played back later. There is already a `sourceType: "voice_note"` and a
checksum used as `sourceId` — the file path belongs alongside them.

Note that `fileDocumentFromBuffer` currently bundles saving, categorizing,
Document creation, and indexing. The save step is what needs to be reachable on
its own. Preserve its two load-bearing properties wherever it ends up: the
sha256 dedupe short-circuit, and **saving to disk before any AI call**, which is
why nothing was lost during the quota failure that started this project.

**Done when:** a short voice note creates a memory, creates no Document, and the
audio file exists on the volume and is reachable from the memory.

---

## Task 24 — Recognise a story as its own kind of thing

Triage splits `quick_note` from `archive_document`. Stories are a third
disposition and should become **archive documents** — that earns them
preservation, playback, transcript search, and the existing Documents UI for
free. A story is precisely the durable artifact the archive exists to hold;
"we're out of propane" is not.

Give stories their own category so they are browsable as a set rather than
scattered among receipts and manuals. The oral history of a property is a
collection, and it should look like one.

**Attribution is not metadata here.** A fact is true regardless of who said it;
a story belongs to the person telling it. Identity-at-the-door is live, so
`getCurrentActor()` resolves — surface the speaker's name prominently on the
record, not buried in provenance.

Keep the transcript indexed. Someone asking Bucky about the Woods Cabin should
find the story, and then be able to *listen* to it.

**Done when:** a recorded story becomes a document in its own category with the
speaker named and the audio playable, while a quick note still does not.

---

## Task 25 — Elicitation: give people something to answer

The hardest problem here is not technical. **"Tell me a story" is paralysing.**
Handed a mic and an empty screen, most people freeze or ramble, and the person
whose memories matter most is often the least comfortable performing.

Bucky is unusually well placed to fix this because he already knows the
property, the people, and the documents. *"Your bylaws mention the Woods Cabin
was added in the eighties — what do you remember about building it?"* is
answerable in a way that a blank recording screen is not.

This is a different capability from capture, and it is the one that decides
whether the feature gets used.

Two properties oral history needs that a single recording session does not:

- **It happens across sittings.** Someone should be able to stop and resume, and
  Bucky should not re-ask what has already been answered. The archive and the
  memories are how he knows.
- **Questions should come from the archive, not from a generic list.** A
  question grounded in a document the family actually has will always beat a
  stock prompt, and it makes the rest of the archive more valuable rather than
  less.

Follow the rule that made photo identification work: **propose, do not
interrogate.** A specific question a person can answer or wave off beats an open
one they have to invent an answer to.

**Done when:** Bucky can open a recording session with a question drawn from
something real in the archive, and a returning speaker is not asked the same
thing twice.

---

## A note on transcription quality

`gpt-4o-mini-transcribe` handles a single clear narrator well. Two brothers
recording together, talking over each other, is a different problem —
`gpt-4o-transcribe-diarize` separates speakers and `gpt-4o-mini-transcribe` does
not.

Not needed for task 23 or 24. Worth knowing before someone records an hour of
the four of them at a table, because that recording is not repeatable.

---

## Sequencing

23 first and alone if possible — every day it waits, recordings lose their audio
permanently. Then 24. Then 25, which is the feature the other two exist to serve.

## How this will be reviewed

1. **Audio survives every routing path.** A quick note keeps its file.
2. **Disk-before-AI ordering and the sha256 dedupe survive** wherever the save
   step ends up living.
3. **Quick notes still do not create Documents** — task 18's fix stays fixed.
4. **No compression, expiry, or retention policy.** Storage is cheap; voices are
   not replaceable.
5. **The speaker is named on a story**, resolved from `getCurrentActor()` and
   never from a client-supplied name.
6. Archive harnesses have not regressed. Golden is the reliable one at 88.0%;
   round-trip drifts a few points between runs and that is noise.
