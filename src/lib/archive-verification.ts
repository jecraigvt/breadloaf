const GENERIC_TITLE_WORDS = new Set([
  "about",
  "annual",
  "archive",
  "archived",
  "breadloaf",
  "cabin",
  "corporation",
  "craig",
  "document",
  "documents",
  "family",
  "guide",
  "hill",
  "information",
  "instruction",
  "instructions",
  "july",
  "list",
  "meeting",
  "memo",
  "minutes",
  "overview",
  "photo",
  "photos",
  "record",
  "recording",
  "records",
  "update",
  "updates",
  "voice",
]);

export const ROUND_TRIP_NEGATIVE_CONTROLS = [
  "purple monkey dishwasher",
  "where is the swimming pool pump shutoff",
] as const;

function words(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]+/g) || [];
}

export function distinctiveTitleWords(title: string): string[] {
  return Array.from(
    new Set(
      words(title).filter(
        (word) =>
          word.length >= 4 &&
          !/^\d+$/.test(word) &&
          !GENERIC_TITLE_WORDS.has(word)
      )
    )
  );
}

export function leakedTitleWords(question: string, forbiddenWords: string[]): string[] {
  const questionWords = new Set(words(question));
  return forbiddenWords.filter((word) => questionWords.has(word));
}

export function verificationPassRate(results: Array<{ passed: boolean }>): number {
  if (results.length === 0) return 0;
  return (results.filter((result) => result.passed).length / results.length) * 100;
}
