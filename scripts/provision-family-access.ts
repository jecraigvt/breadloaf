import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { normalizeSignInEmail } from "../src/lib/sign-in-policy";

async function main() {
  const args = process.argv.slice(2);
  const value = (key: string) => args[args.indexOf(key) + 1];
  const memberId = args.includes("--member-id") ? value("--member-id") : null;
  const email = args.includes("--email") ? normalizeSignInEmail(value("--email")) : null;
  if (!memberId || !email) throw new Error("Usage: npx tsx scripts/provision-family-access.ts --member-id ID --email ADDRESS");
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "FamilyMember" WHERE "id" = ${memberId} FOR UPDATE`;
    const member = await tx.familyMember.findUnique({ where: { id: memberId } });
    if (!member || !member.canClaim || member.isMinor || member.deceased) throw new Error("Choose an eligible adult family profile");
    const duplicates = await tx.familyMember.count({ where: { id: { not: memberId }, email: { equals: email, mode: "insensitive" }, accessApproved: true } });
    if (duplicates) throw new Error("That address is already approved for another profile");
    if (normalizeSignInEmail(member.email) !== email) {
      await tx.familySession.updateMany({ where: { memberId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.familySignInLink.updateMany({ where: { memberId, usedAt: null }, data: { usedAt: new Date() } });
    }
    await tx.familyMember.update({ where: { id: memberId }, data: { email, accessApproved: true } });
  });
  console.log("Family email approved. Existing caretaker roles were preserved; no email was sent.");
}

main().catch(error => { console.error(error instanceof Error ? error.message : "Provisioning failed"); process.exitCode = 1; }).finally(() => prisma.$disconnect());
