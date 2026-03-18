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

  // Seed opening/closing checklists
  const existingChecklists = await prisma.checklistItem.count();
  if (existingChecklists === 0) {
    const checklists = [
      // Opening checklist
      { name: "Turn on main water supply", list: "opening", section: "Water System", sortOrder: 1 },
      { name: "Check for frozen/burst pipes", list: "opening", section: "Water System", sortOrder: 2 },
      { name: "Turn on water heater", list: "opening", section: "Water System", sortOrder: 3 },
      { name: "Run all faucets to flush lines", list: "opening", section: "Water System", sortOrder: 4 },
      { name: "Check toilets flush properly", list: "opening", section: "Water System", sortOrder: 5 },
      { name: "Turn on propane at tank", list: "opening", section: "Heating & Gas", sortOrder: 6 },
      { name: "Light pilot lights", list: "opening", section: "Heating & Gas", sortOrder: 7 },
      { name: "Check propane level", list: "opening", section: "Heating & Gas", sortOrder: 8 },
      { name: "Turn on electricity at breaker", list: "opening", section: "Electrical", sortOrder: 9 },
      { name: "Test all light switches", list: "opening", section: "Electrical", sortOrder: 10 },
      { name: "Check smoke detectors", list: "opening", section: "Safety", sortOrder: 11 },
      { name: "Check CO detectors", list: "opening", section: "Safety", sortOrder: 12 },
      { name: "Check fire extinguishers", list: "opening", section: "Safety", sortOrder: 13 },
      { name: "Inspect for animal/pest intrusion", list: "opening", section: "Interior", sortOrder: 14 },
      { name: "Open windows to air out", list: "opening", section: "Interior", sortOrder: 15 },
      { name: "Check fridge/freezer", list: "opening", section: "Kitchen", sortOrder: 16 },
      { name: "Run dishwasher empty cycle", list: "opening", section: "Kitchen", sortOrder: 17 },
      { name: "Check pantry for expired items", list: "opening", section: "Kitchen", sortOrder: 18 },
      { name: "Walk property perimeter", list: "opening", section: "Exterior", sortOrder: 19 },
      { name: "Check roof for damage", list: "opening", section: "Exterior", sortOrder: 20 },
      { name: "Inspect deck/porch", list: "opening", section: "Exterior", sortOrder: 21 },
      { name: "Set up outdoor furniture", list: "opening", section: "Exterior", sortOrder: 22 },
      { name: "Check woods cabin", list: "opening", section: "Exterior", sortOrder: 23 },
      { name: "Connect Starlink", list: "opening", section: "Electrical", sortOrder: 24 },
      // Closing checklist
      { name: "Turn off main water supply", list: "closing", section: "Water System", sortOrder: 1 },
      { name: "Drain all pipes and faucets", list: "closing", section: "Water System", sortOrder: 2 },
      { name: "Add antifreeze to drains/toilets", list: "closing", section: "Water System", sortOrder: 3 },
      { name: "Turn off water heater", list: "closing", section: "Water System", sortOrder: 4 },
      { name: "Turn off propane at tank", list: "closing", section: "Heating & Gas", sortOrder: 5 },
      { name: "Set thermostat to minimum (prevent freeze)", list: "closing", section: "Heating & Gas", sortOrder: 6 },
      { name: "Clean out fridge, leave door propped open", list: "closing", section: "Kitchen", sortOrder: 7 },
      { name: "Remove all perishable food", list: "closing", section: "Kitchen", sortOrder: 8 },
      { name: "Take out all trash", list: "closing", section: "Kitchen", sortOrder: 9 },
      { name: "Clean kitchen thoroughly", list: "closing", section: "Kitchen", sortOrder: 10 },
      { name: "Strip beds and wash linens", list: "closing", section: "Interior", sortOrder: 11 },
      { name: "Close and lock all windows", list: "closing", section: "Interior", sortOrder: 12 },
      { name: "Unplug non-essential electronics", list: "closing", section: "Electrical", sortOrder: 13 },
      { name: "Disconnect Starlink", list: "closing", section: "Electrical", sortOrder: 14 },
      { name: "Store outdoor furniture", list: "closing", section: "Exterior", sortOrder: 15 },
      { name: "Secure woods cabin", list: "closing", section: "Exterior", sortOrder: 16 },
      { name: "Check for any maintenance needs", list: "closing", section: "Exterior", sortOrder: 17 },
      { name: "Lock all doors", list: "closing", section: "Security", sortOrder: 18 },
      { name: "Set mousetraps", list: "closing", section: "Security", sortOrder: 19 },
      { name: "Notify family the property is closed", list: "closing", section: "Security", sortOrder: 20 },
    ];

    for (const item of checklists) {
      await prisma.checklistItem.create({ data: item });
    }
    console.log("Seeded checklists:", checklists.length);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
