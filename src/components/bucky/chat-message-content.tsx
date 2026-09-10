"use client";

import React from "react";
import Link from "next/link";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUpRight } from "lucide-react";
import { resolveBuckyChatLink } from "@/lib/bucky-chat-link";

export function ChatMessageContent({ content }: { content: string }) {
  return (
    <div className="fg-bucky-markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ href, children, title }) => {
            const link = resolveBuckyChatLink(href);
            if (!link) return <span>{children}</span>;

            const label = (
              <>
                {children}
                <ArrowUpRight className="fg-bucky-link-icon" size={13} aria-hidden="true" />
                <span className="sr-only"> (opens in a new tab)</span>
              </>
            );

            if (link.kind === "internal") {
              return (
                <Link href={link.href} target="_blank" rel="noopener noreferrer" prefetch={false} title={title}>
                  {label}
                </Link>
              );
            }

            return (
              <a href={link.href} target="_blank" rel="noopener noreferrer" title={title}>
                {label}
              </a>
            );
          },
          // Generated replies must not automatically fetch remote images.
          img: ({ alt }) => <span>{alt || "Image"}</span>,
          table: ({ children }) => (
            <div className="fg-bucky-table-scroll" role="region" aria-label="Table in Bucky’s reply" tabIndex={0}>
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {content}
      </Markdown>
    </div>
  );
}
