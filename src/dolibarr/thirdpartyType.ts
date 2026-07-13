import type { DolibarrThirdparty } from "../types/dolibarr.js";

// Pure thirdparty client/supplier classification. Kept free of client.js so
// serializers and resolvers can share it without loading HTTP/config code.

export function getThirdpartySupplierFlag(thirdparty: DolibarrThirdparty): number {
  return Number(thirdparty.supplier ?? thirdparty.fournisseur ?? 0);
}

export function getThirdpartyClientFlag(thirdparty: DolibarrThirdparty): number {
  return Number(thirdparty.client ?? 0);
}

export function getThirdpartyType(
  thirdparty: DolibarrThirdparty,
): "client" | "supplier" | "both" | "other" {
  const isClient = getThirdpartyClientFlag(thirdparty) > 0;
  const isSupplier = getThirdpartySupplierFlag(thirdparty) > 0;

  if (isClient && isSupplier) {
    return "both";
  }

  if (isSupplier) {
    return "supplier";
  }

  if (isClient) {
    return "client";
  }

  return "other";
}
