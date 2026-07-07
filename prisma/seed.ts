import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const categories = [
  { name: "Deeds & Titles", slug: "deeds-titles", icon: "FileText", color: "blue", description: "Property deeds, titles, and ownership records" },
  { name: "Tax Records", slug: "tax-records", icon: "Receipt", color: "red", description: "Property tax bills, tax returns, and assessments" },
  { name: "Insurance", slug: "insurance", icon: "Shield", color: "green", description: "Insurance policies, declarations, claims, and renewal notices" },
  { name: "Maintenance", slug: "maintenance", icon: "Wrench", color: "orange", description: "Repair records, service reports, and contractor work on the property" },
  { name: "Warranties", slug: "warranties", icon: "BadgeCheck", color: "purple", description: "Product warranties and manuals for appliances and equipment" },
  { name: "Surveys & Maps", slug: "surveys-maps", icon: "Map", color: "teal", description: "Land surveys, plot maps, boundary and topographic documents" },
  { name: "Inspections", slug: "inspections", icon: "ClipboardCheck", color: "yellow", description: "Building, septic, water, and safety inspection reports" },
  { name: "Contracts", slug: "contracts", icon: "Handshake", color: "indigo", description: "Signed agreements with contractors, vendors, and service providers" },
  { name: "Correspondence", slug: "correspondence", icon: "Mail", color: "pink", description: "Letters and emails about the property (town, neighbors, lawyers)" },
  { name: "Receipts", slug: "receipts", icon: "DollarSign", color: "emerald", description: "Purchase receipts and invoices for property expenses" },
  { name: "Photos", slug: "photos", icon: "Camera", color: "sky", description: "Photos documenting the property, projects, and conditions" },
  { name: "Meeting Minutes", slug: "meeting-minutes", icon: "FileText", color: "slate", description: "S-Corp board meeting minutes, resolutions, and votes" },
  { name: "Corporate Filings", slug: "corporate-filings", icon: "Building", color: "indigo", description: "Articles of incorporation, bylaws, annual reports, state filings" },
  { name: "Financial Statements", slug: "financial-statements", icon: "BarChart", color: "emerald", description: "P&L statements, balance sheets, and income statements" },
  { name: "K-1 Forms", slug: "k1-forms", icon: "FileSpreadsheet", color: "violet", description: "Schedule K-1 shareholder tax forms" },
  { name: "Bank Statements", slug: "bank-statements", icon: "Landmark", color: "cyan", description: "Bank and account statements for the S-Corp" },
  { name: "Capital Accounts", slug: "capital-accounts", icon: "PiggyBank", color: "amber", description: "Shareholder capital account statements and equity records" },
  { name: "Other", slug: "other", icon: "Folder", color: "gray", description: "Documents that don't fit any other category" },
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
  // The categorization scheme evolves (the AI can add/merge categories),
  // so only seed the full set into an empty table — re-seeding on every
  // deploy would resurrect categories that were merged or renamed.
  const categoryCount = await prisma.category.count();
  if (categoryCount === 0) {
    for (const cat of categories) {
      await prisma.category.create({ data: cat });
    }
    console.log("Seeded categories:", categories.length);
  } else {
    // Backfill descriptions on seeded categories that don't have one yet
    for (const cat of categories) {
      await prisma.category.updateMany({
        where: { slug: cat.slug, description: null },
        data: { description: cat.description },
      });
    }
    console.log("Categories already present:", categoryCount, "(descriptions backfilled)");
  }

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

  // Seed pantry items
  const existingPantry = await prisma.pantryItem.count();
  if (existingPantry === 0) {
    const pantryItems = [
      { name: "Canned Tomatoes", category: "Canned Goods", quantity: 4, unit: "cans", updatedBy: "Tom" },
      { name: "Black Beans", category: "Canned Goods", quantity: 3, unit: "cans", updatedBy: "Tom" },
      { name: "Chicken Broth", category: "Canned Goods", quantity: 2, unit: "cans", updatedBy: "Sandy" },
      { name: "Tuna", category: "Canned Goods", quantity: 6, unit: "cans", updatedBy: "Jim" },
      { name: "Pasta (Spaghetti)", category: "Dry Goods", quantity: 3, unit: "boxes", updatedBy: "Tom" },
      { name: "Rice", category: "Dry Goods", quantity: 2, unit: "bags", updatedBy: "Sandy" },
      { name: "Pancake Mix", category: "Dry Goods", quantity: 1, unit: "boxes", updatedBy: "Greg" },
      { name: "Oatmeal", category: "Dry Goods", quantity: 2, unit: "canisters", updatedBy: "Jim" },
      { name: "Garlic Powder", category: "Spices & Seasonings", quantity: 1, unit: "bottles", updatedBy: "Tom" },
      { name: "Italian Seasoning", category: "Spices & Seasonings", quantity: 1, unit: "bottles", updatedBy: "Tom" },
      { name: "Salt", category: "Spices & Seasonings", quantity: 1, unit: "containers", updatedBy: "Sandy" },
      { name: "Black Pepper", category: "Spices & Seasonings", quantity: 1, unit: "bottles", updatedBy: "Sandy" },
      { name: "Olive Oil", category: "Condiments", quantity: 2, unit: "bottles", updatedBy: "Tom" },
      { name: "Ketchup", category: "Condiments", quantity: 1, unit: "bottles", updatedBy: "Greg" },
      { name: "Mustard", category: "Condiments", quantity: 1, unit: "bottles", updatedBy: "Greg" },
      { name: "Soy Sauce", category: "Condiments", quantity: 1, unit: "bottles", updatedBy: "Jim" },
      { name: "Coffee (Ground)", category: "Beverages", quantity: 2, unit: "bags", updatedBy: "Tom" },
      { name: "Tea Bags", category: "Beverages", quantity: 1, unit: "boxes", updatedBy: "Sandy" },
      { name: "Hot Cocoa Mix", category: "Beverages", quantity: 1, unit: "boxes", updatedBy: "Greg" },
      { name: "Tortilla Chips", category: "Snacks", quantity: 2, unit: "bags", updatedBy: "Greg" },
      { name: "Granola Bars", category: "Snacks", quantity: 1, unit: "boxes", updatedBy: "Jim" },
      { name: "Trail Mix", category: "Snacks", quantity: 2, unit: "bags", updatedBy: "Sandy" },
      { name: "Flour", category: "Baking", quantity: 1, unit: "bags", updatedBy: "Tom" },
      { name: "Sugar", category: "Baking", quantity: 1, unit: "bags", updatedBy: "Tom" },
      { name: "Baking Soda", category: "Baking", quantity: 1, unit: "boxes", updatedBy: "Sandy" },
      { name: "Paper Towels", category: "Paper & Cleaning", quantity: 4, unit: "rolls", updatedBy: "Greg" },
      { name: "Dish Soap", category: "Paper & Cleaning", quantity: 1, unit: "bottles", updatedBy: "Greg" },
      { name: "Trash Bags", category: "Paper & Cleaning", quantity: 1, unit: "boxes", updatedBy: "Jim" },
    ];

    for (const item of pantryItems) {
      await prisma.pantryItem.create({ data: item });
    }
    console.log("Seeded pantry items:", pantryItems.length);
  }

  // Seed dinner signups (upcoming week)
  const existingDinners = await prisma.dinnerSignup.count();
  if (existingDinners === 0) {
    const today = new Date();
    today.setHours(18, 0, 0, 0);

    const dinnerSignups = [
      {
        date: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 18, 0, 0),
        chef: "Tom & Lisa",
        meal: "Grilled burgers and corn on the cob",
        headCount: 12,
        notes: "Vegetarian burgers available too",
      },
      {
        date: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 2, 18, 0, 0),
        chef: "Sandy's crew",
        meal: "Pasta night - spaghetti and meatballs",
        headCount: 15,
        notes: "Gluten-free pasta for those who need it",
      },
      {
        date: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 4, 18, 0, 0),
        chef: "Greg & family",
        meal: "Taco bar",
        headCount: 14,
        notes: "Kids love taco night!",
      },
    ];

    for (const dinner of dinnerSignups) {
      await prisma.dinnerSignup.create({ data: dinner });
    }
    console.log("Seeded dinner signups:", dinnerSignups.length);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
