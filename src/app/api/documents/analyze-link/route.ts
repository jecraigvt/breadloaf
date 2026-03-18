import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { prisma } from "@/lib/prisma";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || "");

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();

    if (!url) {
      return NextResponse.json({ error: "URL required" }, { status: 400 });
    }

    // Fetch the page
    let pageTitle = "";
    let pageText = "";
    let metaDescription = "";

    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; BreadloafHill/1.0; +https://breadloafhill.com)",
        },
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        const html = await res.text();

        // Extract <title>
        const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        if (titleMatch) {
          pageTitle = titleMatch[1]
            .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .trim();
        }

        // Extract meta description
        const metaMatch = html.match(
          /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i
        );
        if (metaMatch) {
          metaDescription = metaMatch[1].trim();
        }

        // Extract visible text (strip tags, scripts, styles)
        pageText = html
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 3000);
      }
    } catch {
      // URL fetch failed — continue with just the URL itself
    }

    // Clean up Google Docs title (remove " - Google Docs" suffix)
    if (pageTitle.includes(" - Google")) {
      pageTitle = pageTitle.replace(/ - Google (Docs|Sheets|Slides|Drive).*$/, "").trim();
    }

    // Get categories for AI suggestion
    const categories = await prisma.category.findMany({
      select: { name: true, slug: true },
    });
    const categoryNames = categories.map((c) => c.name);

    // Use AI to analyze and suggest metadata
    let suggestedTitle = pageTitle || url;
    let suggestedCategory = "";
    let suggestedDescription = metaDescription;
    let contentSummary = "";

    if (process.env.GOOGLE_AI_API_KEY) {
      try {
        const model = genAI.getGenerativeModel({
          model: "gemini-3-flash-preview",
        });

        const prompt = `Analyze this linked document and return ONLY valid JSON (no markdown fences):
{
  "title": "a clear, descriptive title for this document",
  "category": "one of: ${categoryNames.join(", ")}",
  "description": "1-2 sentence description of what this document is about",
  "summary": "brief summary of the document content for search and reference"
}

URL: ${url}
Page title: ${pageTitle || "unknown"}
Meta description: ${metaDescription || "none"}
Page content excerpt: ${pageText.slice(0, 2000) || "could not fetch content"}

This is for a family property archive (Breadloaf Hill, Vermont). The property is owned as an S-Corp by four Craig brothers.
If the content suggests a corporate/financial document, use the appropriate category (Meeting Minutes, Corporate Filings, Financial Statements, K-1 Forms, Bank Statements, Capital Accounts).`;

        const result = await model.generateContent(prompt);
        const text = result.response.text();
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          suggestedTitle = parsed.title || suggestedTitle;
          suggestedCategory = parsed.category || "";
          suggestedDescription = parsed.description || suggestedDescription;
          contentSummary = parsed.summary || "";
        }
      } catch {
        // AI analysis failed — use what we have
      }
    }

    // Map category name to slug
    const matchedCategory = categories.find(
      (c) =>
        c.name.toLowerCase() === suggestedCategory.toLowerCase() ||
        c.slug === suggestedCategory.toLowerCase().replace(/\s+/g, "-")
    );

    return NextResponse.json({
      title: suggestedTitle,
      categorySlug: matchedCategory?.slug || "",
      categoryName: matchedCategory?.name || suggestedCategory,
      description: suggestedDescription,
      contentSummary,
      pageText: pageText.slice(0, 1000),
    });
  } catch (error) {
    console.error("Analyze link error:", error);
    return NextResponse.json(
      { error: "Failed to analyze link" },
      { status: 500 }
    );
  }
}
