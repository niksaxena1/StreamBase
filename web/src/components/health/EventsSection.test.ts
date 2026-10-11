import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { EventsSection } from "./EventsSection";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";

const fixture = vi.hoisted(() => ({
  open: false, expanded: false, effects: [] as Array<() => unknown>, fetch: vi.fn(),
}));
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useEffect: (effect: () => unknown) => fixture.effects.push(effect),
  useState: (initial: unknown) => initial === false
    ? [fixture.expanded, (next: boolean) => { fixture.expanded = next; }]
    : [initial, vi.fn()],
}));
vi.mock("@/lib/useStoredBoolState", () => ({ useStoredBoolState: () => [fixture.open, vi.fn()] }));
vi.mock("@/lib/api", () => ({ fetchApiJson: fixture.fetch }));
vi.mock("@/components/shell/RouteLink", () => ({ default: "a" }));

function flushEffects() {
  const effects = fixture.effects.splice(0);
  for (const effect of effects) effect();
}

beforeEach(() => {
  vi.clearAllMocks(); fixture.open = false; fixture.expanded = false; fixture.effects.length = 0;
  fixture.fetch.mockResolvedValue({ events: [] });
});

describe("Events lazy loading after hydration", () => {
  it("loads a remembered-open section from an effect without a native toggle", () => {
    const props = { mode: "competitor" as const, labelKey: "label-a" };
    const first = EventsSection(props);
    CollapsibleSection(first.props);
    flushEffects();
    expect(fixture.fetch).not.toHaveBeenCalled();
    // useStoredBoolState restores the saved value after hydration.
    fixture.open = true;
    CollapsibleSection(EventsSection(props).props);
    expect(fixture.expanded).toBe(false);
    flushEffects();
    expect(fixture.expanded).toBe(true);
    const child = EventsSection(props).props.children as ReactElement;
    const render = child.type as (props: unknown) => unknown;
    render(child.props);
    expect(fixture.fetch).not.toHaveBeenCalled();
    flushEffects();
    expect(fixture.fetch).toHaveBeenCalledExactlyOnceWith("/api/health-events?days=30&mode=competitor&label=label-a");
  });
  it("keeps a remembered-closed section unloaded after hydration", () => {
    for (let render = 0; render < 2; render++) {
      const element = EventsSection({ mode: "own" });
      CollapsibleSection(element.props);
      flushEffects();
      expect(EventsSection({ mode: "own" }).props.children).toBeNull();
    }
    expect(fixture.fetch).not.toHaveBeenCalled();
  });
});
