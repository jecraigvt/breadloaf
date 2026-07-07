// Shared grocery categorization — used by the grocery page, the grocery
// API route, and the assistant's add_grocery_item tool so every entry
// point sorts items the same way. Ported from Craig Command Center's
// auto-categorizer, ordered to walk a typical supermarket.

export const GROCERY_CATEGORIES = [
  "Produce",
  "Bakery",
  "Meat",
  "Dairy",
  "Frozen",
  "Pantry",
  "Beverages",
  "Snacks",
  "Health",
  "Household",
  "Tools & Hardware",
  "Outdoor",
  "Other",
] as const;

export type GroceryCategory = (typeof GROCERY_CATEGORIES)[number];

export const GROCERY_EMOJI: Record<string, string> = {
  Produce: "🥬",
  Bakery: "🍞",
  Meat: "🥩",
  Dairy: "🥛",
  Frozen: "🧊",
  Pantry: "🥫",
  Beverages: "☕",
  Snacks: "🍿",
  Health: "🧴",
  Household: "🧹",
  "Tools & Hardware": "🔧",
  Outdoor: "🌿",
  Other: "📦",
};

// Aliases for categories the assistant or older data might use.
// "general" maps to null so those items fall through to name-based
// auto-categorization instead of a meaningless bucket.
const CATEGORY_ALIASES: Record<string, GroceryCategory | null> = {
  general: null,
  kitchen: "Household",
  cleaning: "Household",
  "cleaning supplies": "Household",
  "paper goods": "Household",
  "household supplies": "Household",
  bathroom: "Health",
  "personal care": "Health",
  toiletries: "Health",
  hardware: "Tools & Hardware",
  tools: "Tools & Hardware",
  fruit: "Produce",
  fruits: "Produce",
  vegetables: "Produce",
  veggies: "Produce",
  "meat & seafood": "Meat",
  seafood: "Meat",
  deli: "Meat",
  bread: "Bakery",
  drinks: "Beverages",
  "canned goods": "Pantry",
  "dry goods": "Pantry",
  baking: "Pantry",
  condiments: "Pantry",
  "spices & seasonings": "Pantry",
};

const GROCERY_AUTOCATEGORY: Record<string, GroceryCategory> = {
  // Produce
  apple: "Produce", apples: "Produce", banana: "Produce", bananas: "Produce",
  lettuce: "Produce", carrot: "Produce", carrots: "Produce", onion: "Produce",
  onions: "Produce", garlic: "Produce", tomato: "Produce", tomatoes: "Produce",
  potato: "Produce", potatoes: "Produce", spinach: "Produce", avocado: "Produce",
  avocados: "Produce", cucumber: "Produce", pepper: "Produce", peppers: "Produce",
  mushroom: "Produce", mushrooms: "Produce", strawberries: "Produce",
  strawberry: "Produce", lemon: "Produce", lemons: "Produce", lime: "Produce",
  limes: "Produce", grape: "Produce", grapes: "Produce", orange: "Produce",
  oranges: "Produce", celery: "Produce", broccoli: "Produce", kale: "Produce",
  blueberries: "Produce", raspberries: "Produce", cilantro: "Produce",
  basil: "Produce", parsley: "Produce", "salad mix": "Produce", arugula: "Produce",
  zucchini: "Produce", squash: "Produce", melon: "Produce", watermelon: "Produce",
  cantaloupe: "Produce", peach: "Produce", peaches: "Produce", pear: "Produce",
  pears: "Produce", pineapple: "Produce", mango: "Produce", ginger: "Produce",
  corn: "Produce", "sweet corn": "Produce",
  // Dairy
  milk: "Dairy", cheese: "Dairy", yogurt: "Dairy", butter: "Dairy",
  cream: "Dairy", "sour cream": "Dairy", "cream cheese": "Dairy",
  "half and half": "Dairy", eggs: "Dairy", egg: "Dairy", "almond milk": "Dairy",
  "oat milk": "Dairy", "soy milk": "Dairy", hummus: "Dairy",
  // Meat
  chicken: "Meat", beef: "Meat", pork: "Meat", turkey: "Meat",
  bacon: "Meat", salmon: "Meat", "ground beef": "Meat", sausage: "Meat",
  ham: "Meat", "ground turkey": "Meat", shrimp: "Meat", fish: "Meat",
  steak: "Meat", "rotisserie chicken": "Meat", "hot dogs": "Meat",
  burgers: "Meat", "hamburger patties": "Meat",
  // Bakery
  bread: "Bakery", bagel: "Bakery", bagels: "Bakery", muffin: "Bakery",
  muffins: "Bakery", croissant: "Bakery", tortilla: "Bakery",
  tortillas: "Bakery", buns: "Bakery", bun: "Bakery", roll: "Bakery",
  rolls: "Bakery", "english muffins": "Bakery", "pita bread": "Bakery",
  // Frozen
  "ice cream": "Frozen", pizza: "Frozen", "frozen vegetables": "Frozen",
  "frozen fruit": "Frozen", "frozen pizza": "Frozen", popsicles: "Frozen",
  "frozen berries": "Frozen", "frozen meals": "Frozen", ice: "Frozen",
  // Pantry
  pasta: "Pantry", rice: "Pantry", flour: "Pantry", sugar: "Pantry",
  salt: "Pantry", "olive oil": "Pantry", oil: "Pantry", vinegar: "Pantry",
  "peanut butter": "Pantry", jelly: "Pantry", jam: "Pantry", cereal: "Pantry",
  oats: "Pantry", oatmeal: "Pantry", "canned tomatoes": "Pantry",
  beans: "Pantry", soup: "Pantry", honey: "Pantry", syrup: "Pantry",
  "maple syrup": "Pantry", soy: "Pantry", "soy sauce": "Pantry",
  ketchup: "Pantry", mustard: "Pantry", mayo: "Pantry", mayonnaise: "Pantry",
  "salad dressing": "Pantry", spices: "Pantry", "baking powder": "Pantry",
  "baking soda": "Pantry", quinoa: "Pantry", lentils: "Pantry",
  "pancake mix": "Pantry",
  // Beverages
  juice: "Beverages", coffee: "Beverages", tea: "Beverages",
  soda: "Beverages", water: "Beverages", "sparkling water": "Beverages",
  lacroix: "Beverages", "la croix": "Beverages", beer: "Beverages",
  wine: "Beverages", seltzer: "Beverages", gatorade: "Beverages",
  cider: "Beverages", lemonade: "Beverages",
  // Snacks
  chips: "Snacks", chocolate: "Snacks", candy: "Snacks", cookies: "Snacks",
  popcorn: "Snacks", nuts: "Snacks", "trail mix": "Snacks", granola: "Snacks",
  "granola bars": "Snacks", pretzels: "Snacks", crackers: "Snacks",
  "fruit snacks": "Snacks", goldfish: "Snacks", "s'mores": "Snacks",
  smores: "Snacks", marshmallows: "Snacks", "graham crackers": "Snacks",
  // Health & personal care
  toothpaste: "Health", toothbrush: "Health", shampoo: "Health",
  conditioner: "Health", soap: "Health", "body wash": "Health",
  deodorant: "Health", razors: "Health", "razor blades": "Health",
  vitamins: "Health", advil: "Health", tylenol: "Health", aspirin: "Health",
  ibuprofen: "Health", "cough syrup": "Health", bandaids: "Health",
  "band-aids": "Health", sunscreen: "Health", "feminine products": "Health",
  tampons: "Health", pads: "Health", floss: "Health", mouthwash: "Health",
  lotion: "Health", chapstick: "Health", "lip balm": "Health",
  // Household
  "paper towels": "Household", "paper towel": "Household",
  "toilet paper": "Household", tissues: "Household", kleenex: "Household",
  "dish soap": "Household", detergent: "Household",
  "laundry detergent": "Household", "trash bags": "Household",
  batteries: "Household", ziploc: "Household", "ziplock bags": "Household",
  foil: "Household", "tin foil": "Household", "aluminum foil": "Household",
  "saran wrap": "Household", "plastic wrap": "Household",
  napkins: "Household", "paper plates": "Household",
  "paper cups": "Household", "cleaning spray": "Household",
  bleach: "Household", "fabric softener": "Household", swiffer: "Household",
  "dryer sheets": "Household", lightbulbs: "Household", "light bulbs": "Household",
  matches: "Household", "mouse traps": "Household", "mouse trap": "Household",
  candles: "Household",
  // Tools & Hardware
  "duct tape": "Tools & Hardware", screws: "Tools & Hardware",
  nails: "Tools & Hardware", "wd-40": "Tools & Hardware",
  rope: "Tools & Hardware", tarp: "Tools & Hardware",
  "extension cord": "Tools & Hardware",
  // Outdoor
  firewood: "Outdoor", propane: "Outdoor", charcoal: "Outdoor",
  "lighter fluid": "Outdoor", "bug spray": "Outdoor",
  "insect repellent": "Outdoor", citronella: "Outdoor",
  "ice melt": "Outdoor", "grass seed": "Outdoor",
};

// Longest keys first so "peanut butter" wins over "butter".
const AUTOCATEGORY_KEYS = Object.keys(GROCERY_AUTOCATEGORY).sort(
  (a, b) => b.length - a.length
);

export function autoCategorize(text: string): GroceryCategory | null {
  const lower = text.trim().toLowerCase();
  if (!lower) return null;
  if (GROCERY_AUTOCATEGORY[lower]) return GROCERY_AUTOCATEGORY[lower];
  for (const key of AUTOCATEGORY_KEYS) {
    if (lower.includes(key)) return GROCERY_AUTOCATEGORY[key];
  }
  return null;
}

// Map a raw category string (any case, legacy names, assistant output)
// to a canonical category, or null if unrecognized/unset.
export function normalizeCategory(
  raw: string | null | undefined
): GroceryCategory | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  for (const cat of GROCERY_CATEGORIES) {
    if (cat.toLowerCase() === trimmed) return cat;
  }
  if (trimmed in CATEGORY_ALIASES) return CATEGORY_ALIASES[trimmed];
  return null;
}

// Best category for an item: honor an explicit/recognizable category,
// otherwise auto-categorize from the item name, otherwise "Other".
export function resolveCategory(
  raw: string | null | undefined,
  name: string
): GroceryCategory {
  return normalizeCategory(raw) ?? autoCategorize(name) ?? "Other";
}
