// Error reporter stub. Call it for every failure, as described in R6.4.
//
//   report(error, { region, screenId, elementKey })
//
//   region     "board" | "preview" | "layers" | "layers-row" | "details" | "inspector"
//   screenId   the screen the failure belongs to, or null for the board
//   elementKey optional, the element's data-key when relevant

export type Region = "board" | "preview" | "layers" | "layers-row" | "details" | "inspector";

export interface ReportContext {
  region: Region;
  screenId: string | null;
  elementKey?: string;
}

let count = 0;

export function report(error: unknown, context: ReportContext): void {
  count += 1;
  console.log(`[report #${count}]`, { error, ...context });
}
