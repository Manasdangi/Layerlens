import { useEffect, useState } from "react";
import { fetchDetails, type ElementDetails } from "../api";
import type { LiveProps } from "../protocol";
import { useStore } from "../state";
import { Region } from "./Region";
import { useRegion } from "./regionApi";

export function Inspector({ width }: { width: number }) {
  const screenId = useStore((s) => s.selection?.screenId ?? s.activeId);
  return (
    <aside className="panel inspector-panel" style={{ width }}>
      <div className="panel-header">Inspector</div>
      <Region name="inspector" screenId={screenId} className="panel-error">
        <InspectorBody />
      </Region>
    </aside>
  );
}

type Field = { label: string; get: (p: LiveProps) => string; color?: boolean };

const FIELDS: Field[] = [
  { label: "Name", get: (p) => p.name },
  { label: "Tag", get: (p) => p.tag },
  { label: "ID", get: (p) => p.id || "—" },
  { label: "Classes", get: (p) => p.classes.join(" ") || "—" },
  { label: "Size", get: (p) => `${p.width} × ${p.height}` },
  { label: "Position", get: (p) => `${p.x}, ${p.y}` },
  { label: "Text", get: (p) => p.text || "—" },
  { label: "Color", get: (p) => p.color, color: true },
  { label: "Background", get: (p) => p.background, color: true },
  { label: "Font family", get: (p) => p.fontFamily },
  { label: "Font size", get: (p) => p.fontSize },
  { label: "Font weight", get: (p) => p.fontWeight },
];

const MIXED = "Mixed";

function InspectorBody() {
  const selection = useStore((s) => s.selection);
  const goneNotice = useStore((s) => s.goneNotice);
  const live = useStore((s) => (s.selection ? s.live[s.selection.screenId] : undefined));
  const devThrow = useStore((s) => s.dev.inspectorThrow);

  if (devThrow) throw new Error("Dev fault: the inspector threw while rendering");

  if (!selection) return <p className="empty">{goneNotice ? "This element no longer exists" : "Select an element to inspect it"}</p>;

  const items = selection.ids.map((id) => live?.[id]);
  if (items.some((p) => !p)) return <p className="empty">Reading element…</p>;
  const props = items as LiveProps[];

  const values = FIELDS.map((f) => {
    const all = props.map(f.get);
    return all.every((v) => v === all[0]) ? all[0] : MIXED;
  });

  return (
    <div className="inspector">
      {props.length > 1 && <div className="inspector-count">{props.length} elements</div>}
      <section>
        <h3>Live</h3>
        <dl className="props">
          {FIELDS.map((f, i) => (
            <div key={f.label} className="prop">
              <dt>{f.label}</dt>
              <dd className={values[i] === MIXED ? "mixed" : undefined}>
                {f.color && values[i] !== MIXED && <span className="swatch" style={{ background: values[i] }} />}
                {values[i]}
              </dd>
            </div>
          ))}
        </dl>
      </section>
      {props.length === 1 && (
        <section>
          <h3>Details</h3>
          {props[0].key ? (
            <Region key={`${selection.screenId}:${props[0].key}`} name="details" screenId={selection.screenId} elementKey={props[0].key} className="section-error">
              <Details elementKey={props[0].key} />
            </Region>
          ) : (
            <p className="empty">No details</p>
          )}
        </section>
      )}
    </div>
  );
}

type DetailsState = { status: "loading" } | { status: "missing" } | { status: "ready"; data: ElementDetails };

function Details({ elementKey }: { elementKey: string }) {
  const { raise } = useRegion();
  // The answer is tagged with its key: until the current key's answer lands, it's loading.
  const [result, setResult] = useState<{ key: string; state: DetailsState } | null>(null);
  const state: DetailsState = result?.key === elementKey ? result.state : { status: "loading" };

  // One request per key; a newer selection aborts this one (not a failure), so
  // only the latest selection's details can ever be shown.
  useEffect(() => {
    const ac = new AbortController();
    fetchDetails(elementKey, ac.signal)
      .then((data) => {
        if (!ac.signal.aborted) setResult({ key: elementKey, state: data ? { status: "ready", data } : { status: "missing" } });
      })
      .catch((error) => {
        if (!ac.signal.aborted) raise(error);
      });
    return () => ac.abort();
  }, [elementKey, raise]);

  if (state.status === "loading") return <p className="empty">Loading details…</p>;
  if (state.status === "missing") return <p className="empty">No details for this element</p>;
  const d = state.data;
  return (
    <dl className="props">
      {(
        [
          ["Component", d.component],
          ["Description", d.description],
          ["Status", d.status],
          ["Owner", d.owner],
        ] as const
      ).map(([label, value]) => (
        <div key={label} className="prop">
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
