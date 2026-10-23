import { parseAssocToken } from "../columns.js";

export function splitTokens(str) {
  return str
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function findManagedIndex(tokens, prefix) {
  return tokens.findIndex((tk) => {
    const p = parseAssocToken(tk, prefix);
    return p && !p.raw;
  });
}
