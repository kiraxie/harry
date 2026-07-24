// A small, correct string library for the agentic eval fixture (no seeded bug).
// Feature-addition eval cases add new functions alongside `slugify`.

export function slugify(str) {
  return String(str)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
