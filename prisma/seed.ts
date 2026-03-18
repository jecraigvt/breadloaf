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

const rooms = [
  {
    name: "Tom Craig's Room",
    slug: "tom-craig",
    type: "bedroom",
    minCapacity: 1,
    maxCapacity: 2,
    hasCrib: true,
    description: "Private bathroom, shared showers",
    sortOrder: 1,
  },
  {
    name: "Jim Craig's Room",
    slug: "jim-craig",
    type: "bedroom",
    minCapacity: 1,
    maxCapacity: 2,
    hasCrib: true,
    description: "Private bathroom, shared showers",
    sortOrder: 2,
  },
  {
    name: "Sandy Craig's Room",
    slug: "sandy-craig",
    type: "bedroom",
    minCapacity: 1,
    maxCapacity: 2,
    hasCrib: true,
    description: "Private bathroom, shared showers",
    sortOrder: 3,
  },
  {
    name: "Greg Craig's Room",
    slug: "greg-craig",
    type: "bedroom",
    minCapacity: 1,
    maxCapacity: 2,
    hasCrib: true,
    description: "Private bathroom, shared showers",
    sortOrder: 4,
  },
  {
    name: "The Wedge Room",
    slug: "wedge-room",
    type: "bedroom",
    minCapacity: 2,
    maxCapacity: 3,
    hasCrib: false,
    description: "Camp-style shared bathroom",
    sortOrder: 5,
  },
  {
    name: "Upper Annex",
    slug: "upper-annex",
    type: "annex",
    minCapacity: 1,
    maxCapacity: 6,
    hasCrib: false,
    description: "Camp-style shared bathroom",
    sortOrder: 6,
  },
  {
    name: "Lower Annex",
    slug: "lower-annex",
    type: "annex",
    minCapacity: 1,
    maxCapacity: 4,
    hasCrib: false,
    description: "Camp-style shared bathroom",
    sortOrder: 7,
  },
  {
    name: "The Loft",
    slug: "loft",
    type: "loft",
    minCapacity: 1,
    maxCapacity: 4,
    hasCrib: false,
    description: "Camp-style shared bathroom",
    sortOrder: 8,
  },
  {
    name: "Woods Cabin",
    slug: "woods-cabin",
    type: "cabin",
    minCapacity: 2,
    maxCapacity: 4,
    hasCrib: false,
    description: "Compost toilet",
    sortOrder: 9,
  },
  {
    name: "Tents",
    slug: "tents",
    type: "tent",
    minCapacity: 1,
    maxCapacity: 20,
    hasCrib: false,
    description: "Outdoor camping, camp-style bathroom access",
    sortOrder: 10,
  },
  {
    name: "Off-site",
    slug: "off-site",
    type: "offsite",
    minCapacity: 1,
    maxCapacity: 99,
    hasCrib: false,
    description: "Staying nearby — rental, hotel, etc.",
    sortOrder: 11,
  },
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

  for (const room of rooms) {
    await prisma.room.upsert({
      where: { slug: room.slug },
      update: {},
      create: room,
    });
  }
  console.log("Seeded rooms:", rooms.length);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
