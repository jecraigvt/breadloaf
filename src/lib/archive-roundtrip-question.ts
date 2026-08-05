import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { MODELS } from "@/lib/ai";
import { getOpenAIClient, withRetry } from "@/lib/openai-client";
import { distinctiveTitleWords, leakedTitleWords } from "@/lib/archive-verification";

const MAX_CONTENT_CHARS = 7000;
const QUESTION_ATTEMPTS = 3;

const QuestionSchema = z.object({
  question: z.string().min(12).max(240),
});

export interface RoundTripQuestionSource {
  title: string;
}

export function questionShapeProblem(question: string): string | null {
  if (/\r|\n/.test(question)) return "it returned more than one line";
  if (!question.endsWith("?") || question.indexOf("?") !== question.length - 1) {
    return "it did not return exactly one complete question";
  }
  if (/[{}\[\]<>|]/.test(question)) return "it included structured-output debris";
  if (/\b(?:json|final only|invalid json|system message)\b/i.test(question)) {
    return "it included prompt or output-format debris";
  }

  if (/[^\x00-\xFF\u2018\u2019\u201C\u201D\u2013\u2014]/.test(question)) {
    return "it included unrelated non-Latin output debris";
  }
  return null;
}

export async function deriveArchiveQuestion(
  document: RoundTripQuestionSource,
  content: string
): Promise<string> {
  const forbidden = distinctiveTitleWords(document.title);
  let lastProblem = "";

  for (let attempt = 1; attempt <= QUESTION_ATTEMPTS; attempt++) {
    const prompt = `Write one realistic question a family member could ask whose answer is supported by the archive content below.

Rules:
- Derive the question only from the supplied content, not from a filename or title.
- Ask about a specific subject, fact, decision, instruction, person, date, amount, or event in the content.
- Do not say document, file, title, archive, upload, summary, or filename.
- Do not use any forbidden title word: ${forbidden.join(", ") || "(none)"}.
- Use one line of natural English and end with exactly one question mark.
${lastProblem ? `- The prior attempt was rejected because ${lastProblem}. Choose a different phrasing.` : ""}

Archive content:
${content.slice(0, MAX_CONTENT_CHARS)}`;
    const response = await withRetry(() =>
      getOpenAIClient().responses.parse({
        model: MODELS.flash,
        input: prompt,
        text: { format: zodTextFormat(QuestionSchema, "archive_round_trip_question") },
      })
    );
    const question = response.output_parsed?.question.trim();
    if (!question) {
      lastProblem = "it returned no question";
      continue;
    }
    const leaked = leakedTitleWords(question, forbidden);
    if (leaked.length > 0) {
      lastProblem = `it reused forbidden word(s): ${leaked.join(", ")}`;
      continue;
    }
    if (/\b(?:document|file|title|archive|upload|summary|filename)\b/i.test(question)) {
      lastProblem = "it referred to the archive or source artifact";
      continue;
    }
    const shapeProblem = questionShapeProblem(question);
    if (shapeProblem) {
      lastProblem = shapeProblem;
      continue;
    }
    return question;
  }

  throw new Error(lastProblem || "question generation failed");
}
