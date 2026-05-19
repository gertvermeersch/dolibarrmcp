export function dolibarrStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function dolibarrLikeLiteral(value: string): string {
  return dolibarrStringLiteral(`%${value}%`);
}

export function dolibarrQueryString(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}
