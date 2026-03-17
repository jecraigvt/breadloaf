import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const categories = [
  { name: "Deeds & Titles", slug: "deeds-titles", icon: "FileText", color: "blue" },
  { name: "Tax Records", slug: "tax-records", icon: "Receipt", color: "red" },
  { name: "Insurance", slug: "insurance", icon: "Shield", color: "green" },
  { name: "Maintenance", slug: "maintenance", icon: "Wrench", color: "orange" },
  { name: "Warranties", slug: "warranties", icon: "BadgeCheck", color: "purple" },
  { name: "Surveys & Maps", slug: "surveys-maps", icon: "Map", color: "teal" },
  { name: "Inspections", slug: "inspections", icon: "ClipboardCheck", color: "yellow" },
  { name: "Contracts", slug: "contracts", icon: "Handshake", color: "indigo" },
  { name: "Correspondence", slug: "correspondence", icon: "Mail", color: "pink" },
  { name: "Receipts", slug: "receipts", icon: "DollarSign", color: "emerald" },
  { name: "Photos", slug: "photos", icon: "Camera", color: "sky" },
  { name: "Other", slug: "other", icon: "Folder", color: "gray" },
];

async function main() {
  for (const cat of categories) {
    await prisma.category.upsert({
      where: { slug: cat.slug },
      update: {},
      create: cat,
    });
  }
  console.log("Seeded categories:", categories.length);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
