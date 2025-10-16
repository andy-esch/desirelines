export function offsetDate(dateStr: string) {
  const da = new Date(Date.parse(dateStr) + 24 * 3600 * 1000); // Offset by one day
  const tempDate = `${da.getUTCFullYear()}-${String(da.getUTCMonth() + 1).padStart(
    2,
    "0"
  )}-${String(da.getUTCDate()).padStart(2, "0")}`;
  return tempDate;
}
