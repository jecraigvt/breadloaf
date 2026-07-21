import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { prisma } from "@/lib/prisma";
import { MODELS } from "@/lib/ai";
import { resolveDocumentTitle } from "@/lib/document-title";

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
    const imageUrls: string[] = [];

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

        // Extract og:image
        const ogImageMatch = html.match(
          /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i
        );
        if (ogImageMatch) {
          imageUrls.push(ogImageMatch[1]);
        }

        // Extract significant images (skip tiny icons/tracking pixels)
        const imgMatches = Array.from(html.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*/gi));
        for (const match of imgMatches) {
          const src = match[1];
          // Skip data URIs, tiny images, tracking pixels, icons
          if (
            src.startsWith("data:") ||
            src.includes("pixel") ||
            src.includes("tracking") ||
            src.includes("favicon") ||
            src.includes("icon") ||
            src.endsWith(".svg")
          ) continue;
          // Make relative URLs absolute
          let absoluteUrl = src;
          if (src.startsWith("/")) {
            try {
              const base = new URL(url);
              absoluteUrl = `${base.origin}${src}`;
            } catch { continue; }
          }
          if (absoluteUrl.startsWith("http") && !imageUrls.includes(absoluteUrl)) {
            imageUrls.push(absoluteUrl);
          }
          if (imageUrls.length >= 5) break; // Cap at 5 images
        }

        // Extract visible text — get as much as possible
        pageText = html
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<nav[\s\S]*?<\/nav>/gi, "")
          .replace(/<footer[\s\S]*?<\/footer>/gi, "")
          .replace(/<header[\s\S]*?<\/header>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 8000);
      }
    } catch {
      // URL fetch failed — continue with just the URL itself
    }

    // Clean up Google Docs title
    if (pageTitle.includes(" - Google")) {
      pageTitle = pageTitle
        .replace(/ - Google (Docs|Sheets|Slides|Drive).*$/, "")
        .trim();
    }

    // Get categories
    const categories = await prisma.category.findMany({
      select: { name: true, slug: true },
    });
    const categoryNames = categories.map((c) => c.name);

    // Analyze images with Vision if available
    let imageDescriptions = "";
    if (process.env.GOOGLE_AI_API_KEY && imageUrls.length > 0) {
      try {
        const model = genAI.getGenerativeModel({
          model: MODELS.flash,
        });

        // Fetch up to 3 images and describe them
        const imagePartsPromises = imageUrls.slice(0, 3).map(async (imgUrl) => {
          try {
            const imgRes = await fetch(imgUrl, {
              signal: AbortSignal.timeout(5000),
            });
            if (!imgRes.ok) return null;
            const contentType = imgRes.headers.get("content-type") || "";
            if (!contentType.startsWith("image/")) return null;
            const buffer = Buffer.from(await imgRes.arrayBuffer());
            if (buffer.length < 1000) return null; // Skip tiny images
            if (buffer.length > 4 * 1024 * 1024) return null; // Skip huge images
            return {
              inlineData: {
                mimeType: contentType.split(";")[0] as "image/jpeg" | "image/png" | "image/webp",
                data: buffer.toString("base64"),
              },
            };
          } catch {
            return null;
          }
        });

        const imageParts = (await Promise.all(imagePartsPromises)).filter(Boolean);

        if (imageParts.length > 0) {
          const visionResult = await model.generateContent([
            ...imageParts as { inlineData: { mimeType: string; data: string } }[],
            {
              text: `Describe what you see in these images. They are from a document related to the Craig family property at Breadloaf Hill in Ripton, Vermont. Be specific about any people, locations, structures, equipment, or documents visible. Keep each description to 1-2 sentences.`,
            },
          ]);
          imageDescriptions = visionResult.response.text();
        }
      } catch {
        // Vision analysis failed — continue without
      }
    }

    // Use AI to do a comprehensive analysis
    let suggestedTitle = pageTitle || url;
    let suggestedCategory = "";
    let suggestedDescription = metaDescription;
    let contentSummary = "";
    let fullExtractedContent = "";

    if (process.env.GOOGLE_AI_API_KEY) {
      try {
        const model = genAI.getGenerativeModel({
          model: MODELS.flash,
        });

        const prompt = `You are Bucky Dragon, document analyst for the Craig family property at Breadloaf Hill, Vermont. Analyze this linked document thoroughly and return ONLY valid JSON (no markdown fences):
{
  "title": "a clear, descriptive title for this document",
  "category": "one of: ${categoryNames.join(", ")}",
  "description": "1-2 sentence description of what this document is about",
  "summary": "comprehensive summary capturing all key facts, dates, names, amounts, decisions, and details from this document — this is what the family assistant will reference when answering questions, so be thorough",
  "extractedContent": "all important factual content from the page — names, dates, dollar amounts, decisions, action items, addresses, contact info, specifications, measurements — anything a family member might ask about later"
}

Title rules:
- Use a concise, human-readable title based on the page content, usually 4-12 words.
- Identify the specific document type and subject; include a useful date, vendor, person, or location when supported.
- Do not copy the URL, page filename, or a generic label such as "Document" or "Untitled".

URL: ${url}
Page title: ${pageTitle || "unknown"}
Meta description: ${metaDescription || "none"}
Page content: ${pageText || "could not fetch content"}
${imageDescriptions ? `\nImages found in document:\n${imageDescriptions}` : ""}

This property is owned as an S-Corp by four Craig brothers (Tom, Jim, Sandy, Greg).
Be thorough — extract every useful detail. The family assistant needs this to answer questions about the property.`;

        const result = await model.generateContent(prompt);
        const text = result.response.text();
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          suggestedTitle = parsed.title || suggestedTitle;
          suggestedCategory = parsed.category || "";
          suggestedDescription = parsed.description || suggestedDescription;
          contentSummary = parsed.summary || "";
          fullExtractedContent = parsed.extractedContent || "";
        }
      } catch {
        // AI analysis failed — use what we have
      }
    }

    // Combine all extracted knowledge
    const allExtractedText = [
      fullExtractedContent,
      imageDescriptions ? `[Images: ${imageDescriptions}]` : "",
      pageText.slice(0, 2000),
    ]
      .filter(Boolean)
      .join("\n\n");

    // Map category name to slug
    const matchedCategory = categories.find(
      (c) =>
        c.name.toLowerCase() === suggestedCategory.toLowerCase() ||
        c.slug === suggestedCategory.toLowerCase().replace(/\s+/g, "-")
    );

    return NextResponse.json({
      title: resolveDocumentTitle({
        suggestedTitle,
        fileName: pageTitle || null,
        summary: contentSummary || suggestedDescription,
        extractedText: allExtractedText,
        fileType: "text/html",
        createdAt: new Date(),
      }),
      categorySlug: matchedCategory?.slug || "",
      categoryName: matchedCategory?.name || suggestedCategory,
      description: suggestedDescription,
      contentSummary,
      pageText: allExtractedText,
    });
  } catch (error) {
    console.error("Analyze link error:", error);
    return NextResponse.json(
      { error: "Failed to analyze link" },
      { status: 500 }
    );
  }
}
