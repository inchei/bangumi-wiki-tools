const idRegex = /^((person|character|episode)_)?id$/;

export function isIDColumn(colName) {
  let field = String(colName).toLowerCase();
  const dot = field.lastIndexOf(".");
  if (dot >= 0) field = field.slice(dot + 1);
  return idRegex.test(field);
}

export function headerId(dc) {
  return "colh-" + dc.ci;
}
