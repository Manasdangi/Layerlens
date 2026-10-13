// The handle a <Region> gives its children, so that errors from anywhere land
// in that region (see Region.tsx):
//   raise(error)  report an error caught elsewhere (a rejected request, a timeout)
//   guard(fn)     wrap a callback (timer, listener, promise handler) so a throw lands here
//   run(fn)       run code now, guarded: for event handlers

import { createContext, useContext } from "react";

export interface RegionApi {
  raise(error: unknown): void;
  guard<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R | undefined;
  run<R>(fn: () => R): R | undefined;
}

export const RegionContext = createContext<RegionApi | null>(null);

export function useRegion(): RegionApi {
  const api = useContext(RegionContext);
  if (!api) throw new Error("useRegion() used outside a <Region>");
  return api;
}
