import { dolibarr } from "./client.js";

// The user behind the API token. Needs user read rights; normal users without
// them get a 403 and callers fall back to DOLIBARR_DEFAULT_COMMERCIAL_ID.
export async function getCurrentUser(): Promise<{ id: number | string }> {
  return dolibarr.get<{ id: number | string }>("/users/info");
}
