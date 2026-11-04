/** Product photos in public/products: one packshot per base type, shared by every variant
 * ("Ceramic mug Black" and "Ceramic mug 1L" both show the ceramic mug). Rendered by
 * scripts/build-product-images.mjs; keep this list in step with scripts/product-art.mjs. */
const BASE_TYPES: readonly string[] = [
  "Storage box", "Laundry basket", "Clothes hangers", "Sponge set", "Trash bags",
  "Microfiber cloths", "Shoe rack", "Vacuum bags", "Drying rack", "Bath mat",
  "Food container", "Ceramic mug", "Chef knife", "Cutting board", "Glass jar",
  "Frying pan", "Baking tray", "Tea towel", "Water bottle", "Spice rack",
  "Shampoo", "Shower gel", "Hand soap", "Toothpaste", "Hand cream",
  "Deodorant", "Cotton pads", "Face wipes", "Hair conditioner", "Lip balm",
  "Toy car", "Puzzle", "Soft ball", "Building blocks", "Doll",
  "Coloring set", "Bubble wand", "Toy kitchen set", "Water gun", "Board game",
  "Notebook", "Gel pen", "Pencil set", "Sticky notes", "Glue stick",
  "Ruler", "Marker set", "Eraser", "File folder", "Sketchbook",
  "Christmas lights", "Christmas bauble", "Tinsel garland", "Gift bag", "Candle",
  "Snowflake decor", "Advent calendar", "Wrapping paper", "Santa figure", "Star topper",
];

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** Longest base type the product name starts with, e.g. "Toy kitchen set" before "Toy car". */
export function productBase(name: string): string | null {
  let best: string | null = null;
  for (const b of BASE_TYPES) {
    if ((name === b || name.startsWith(b + " ")) && (!best || b.length > best.length)) best = b;
  }
  return best;
}

/** Image URL and alt text for a product, or null when there is no photo (category icon instead). */
export function productImage(name: string | null | undefined): { src: string; alt: string } | null {
  const base = name ? productBase(name) : null;
  return base ? { src: `/products/${slug(base)}.webp`, alt: base } : null;
}
