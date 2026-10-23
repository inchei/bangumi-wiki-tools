let re2Promise;

function loadRE2() {
  re2Promise ??= import("re2js").then(({ RE2JS }) => RE2JS);
  return re2Promise;
}

async function re2RegexError(pattern) {
  if (typeof pattern !== "string" || pattern === "") return null;
  const RE2JS = await loadRE2();
  try {
    RE2JS.compile(pattern);
    return null;
  } catch (e) {
    return e?.message || String(e);
  }
}

export async function collectRegexErrors(node, errors = []) {
  if (!node || typeof node !== "object") return errors;
  if (Array.isArray(node)) {
    for (const item of node) await collectRegexErrors(item, errors);
    return errors;
  }
  if (
    (node.operator === "regex" || node.operator === "not_regex") &&
    typeof node.value === "string"
  ) {
    const error = await re2RegexError(node.value);
    if (error) errors.push({ pattern: node.value, message: error });
  }
  for (const value of Object.values(node)) {
    await collectRegexErrors(value, errors);
  }
  return errors;
}
