import { store, type Screen } from "./state";

const API = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export interface ElementDetails {
  component: string;
  description: string;
  status: string;
  owner: string;
}

export class HttpError extends Error {
  constructor(route: string, status: number) {
    super(`GET ${route} failed with ${status}`);
    this.name = "HttpError";
  }
}

function url(route: string, fail: boolean) {
  const u = new URL(route, API);
  const { latency } = store.get().dev;
  if (latency > 0) u.searchParams.set("latency", String(latency));
  if (fail) u.searchParams.set("fail", "1");
  return u.toString();
}

const isString = (v: unknown): v is string => typeof v === "string";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export async function fetchScreens(signal: AbortSignal): Promise<Screen[]> {
  const res = await fetch(url("/screens", store.get().dev.screensFail), { signal });
  if (!res.ok) throw new HttpError("/screens", res.status);
  const data: unknown = await res.json(); // a malformed body throws here
  if (!Array.isArray(data) || !data.every((s) => isRecord(s) && isString(s.id) && isString(s.name) && isString(s.url))) {
    throw new Error("GET /screens returned malformed data");
  }
  return data as Screen[];
}

/** null = no details for this key (404, not an error). */
export async function fetchDetails(key: string, signal: AbortSignal): Promise<ElementDetails | null> {
  const route = `/elements/${encodeURIComponent(key)}`;
  const res = await fetch(url(route, store.get().dev.detailsFail), { signal });
  if (res.status === 404) return null;
  if (!res.ok) throw new HttpError(route, res.status);
  const data: unknown = await res.json();
  if (!isRecord(data) || !["component", "description", "status", "owner"].every((k) => isString(data[k]))) {
    throw new Error(`GET ${route} returned malformed data`);
  }
  return data as unknown as ElementDetails;
}
