import { prisma } from "@/lib/prisma";
import nodemailer from "nodemailer";

type NotificationStatus = "sent" | "not_configured" | "no_recipients";

interface QuestionNotificationResult {
  status: NotificationStatus;
  recipientCount: number;
}

function configuredRecipients(): string[] {
  return (process.env.BUCKY_NOTIFICATION_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function siteUrl(): string {
  const configured = process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");

  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
  return railwayDomain ? `https://${railwayDomain}` : "https://breadloafhill.com";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function recipientsFor(targetPerson?: string): Promise<string[]> {
  if (targetPerson) {
    const member = await prisma.familyMember.findFirst({
      where: { name: { equals: targetPerson, mode: "insensitive" } },
      select: { email: true },
    });
    if (member?.email?.trim()) return [member.email.trim().toLowerCase()];
  }

  return configuredRecipients();
}

export async function sendBuckyQuestionNotification(input: {
  questionId: string;
  targetPerson?: string;
}): Promise<QuestionNotificationResult> {
  const appPassword = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, "");
  if (!appPassword) return { status: "not_configured", recipientCount: 0 };

  const recipients = await recipientsFor(input.targetPerson);
  if (recipients.length === 0) return { status: "no_recipients", recipientCount: 0 };

  const person = input.targetPerson?.trim();
  const greeting = person ? `Hi ${person},` : "Hello,";
  const questionsUrl = `${siteUrl()}/assistant?tab=questions`;
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user: "breadloafhillsite@gmail.com",
      pass: appPassword,
    },
  });
  await transporter.sendMail({
    from: "Bucky at Breadloaf Hill <breadloafhillsite@gmail.com>",
    to: recipients,
    subject: person ? `Bucky has a question for ${person}` : "Bucky has a family question",
    text: `${greeting}\n\nBucky needs a clarification from the family. Sign in to Breadloaf Hill and open the Questions tab:\n${questionsUrl}\n\nThe question itself stays inside the family site.`,
    html: `<p>${escapeHtml(greeting)}</p><p>Bucky needs a clarification from the family.</p><p><a href="${questionsUrl}">Open Bucky's Questions tab</a></p><p>The question itself stays inside the family site.</p>`,
    headers: { "X-Breadloaf-Question-ID": input.questionId },
  });

  return { status: "sent", recipientCount: recipients.length };
}
