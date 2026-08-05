declare module "word-extractor" {
  interface ExtractedWordDocument {
    getBody(): string;
    getFootnotes(): string;
    getEndnotes(): string;
    getHeaders(options?: { includeFooters?: boolean }): string;
    getFooters(): string;
    getAnnotations(): string;
    getTextboxes(options?: {
      includeHeadersAndFooters?: boolean;
      includeBody?: boolean;
    }): string;
  }

  export default class WordExtractor {
    extract(source: string | Buffer): Promise<ExtractedWordDocument>;
  }
}
