const invoiceStatusLabels: Record<number, string> = {
  0: "draft",
  1: "validated",
  2: "paid",
  3: "abandoned",
};

const proposalStatusLabels: Record<number, string> = {
  0: "draft",
  1: "validated",
  2: "accepted",
  3: "refused",
  4: "billed",
};

const orderStatusLabels: Record<number, string> = {
  [-1]: "canceled",
  0: "draft",
  1: "validated",
  2: "shipment_in_process",
  3: "delivered",
};

function numberOrUndefined(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function statusLabel(labels: Record<number, string>, value: unknown): string | undefined {
  const status = numberOrUndefined(value);
  if (status === undefined) return undefined;
  return labels[status] ?? String(status);
}

export function invoiceStatusLabel(value: unknown): string | undefined {
  return statusLabel(invoiceStatusLabels, value);
}

export function proposalStatusLabel(value: unknown): string | undefined {
  return statusLabel(proposalStatusLabels, value);
}

export function orderStatusLabel(value: unknown): string | undefined {
  return statusLabel(orderStatusLabels, value);
}
