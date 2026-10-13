// A failure region: shows an error with Retry in place of its children, and
// reports each failure exactly once. Errors reach it the same way wherever they
// happen: thrown during render (error boundary), or passed to `raise` / thrown
// inside a `guard`-wrapped handler, timer, message handler or response callback.
//
// After a retry or unmount, raise/guard from the old generation do nothing: a
// response that arrives after its region is gone changes nothing, reports nothing.
import { Component, Fragment, type ReactNode } from "react";
import { Cancelled } from "../connection";
import { report, type Region as RegionName } from "../report";
import { RegionContext, type RegionApi } from "./regionApi";

const isCancel = (e: unknown) => e instanceof Cancelled || (e instanceof DOMException && e.name === "AbortError");

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

const DEFAULT_MESSAGES: Record<RegionName, string> = {
  board: "Couldn't load the board",
  preview: "This preview hit an error",
  layers: "Couldn't load layers",
  "layers-row": "Couldn't load",
  details: "Couldn't load details",
  inspector: "The inspector hit an error",
};

interface Props {
  name: RegionName;
  screenId: string | null;
  elementKey?: string;
  className?: string;
  message?: (error: unknown) => string;
  children: ReactNode;
}

interface State {
  error: unknown;
  failed: boolean;
  gen: number;
}

export class Region extends Component<Props, State> {
  state: State = { error: null, failed: false, gen: 0 };

  private gen = 0;
  private failed = false;
  private unmounted = false;
  private api: RegionApi = this.makeApi(0);

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error, failed: true };
  }

  componentDidMount() {
    this.unmounted = false; // StrictMode remounts
  }

  componentWillUnmount() {
    this.unmounted = true;
  }

  componentDidCatch(error: unknown) {
    if (!this.failed) this.fail(error);
  }

  private fail(error: unknown) {
    this.failed = true;
    const { name, screenId, elementKey } = this.props;
    report(error, { region: name, screenId, ...(elementKey ? { elementKey } : {}) });
  }

  private makeApi(gen: number): RegionApi {
    const raise = (error: unknown) => {
      if (this.unmounted || gen !== this.gen || this.failed || isCancel(error)) return;
      this.fail(error);
      this.setState({ error, failed: true });
    };
    const guard =
      <A extends unknown[], R>(fn: (...args: A) => R) =>
      (...args: A): R | undefined => {
        try {
          return fn(...args);
        } catch (error) {
          raise(error);
          return undefined;
        }
      };
    return { raise, guard, run: (fn) => guard(fn)() };
  }

  private retry = () => {
    this.gen += 1;
    this.failed = false;
    this.api = this.makeApi(this.gen);
    this.setState({ error: null, failed: false, gen: this.gen });
  };

  render() {
    const { name, className, message, children } = this.props;
    if (this.state.failed) {
      const { error } = this.state;
      return (
        <div className={`region-error ${className ?? ""}`} role="alert">
          <strong>{message?.(error) ?? DEFAULT_MESSAGES[name]}</strong>
          <small>{errorMessage(error)}</small>
          <button type="button" onClick={this.retry}>
            Retry
          </button>
        </div>
      );
    }
    return (
      <RegionContext.Provider value={this.api}>
        <Fragment key={this.state.gen}>{children}</Fragment>
      </RegionContext.Provider>
    );
  }
}
