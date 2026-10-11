import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({ context: vi.fn(), own: vi.fn(), competitor: vi.fn() }));
vi.mock("@/lib/requestAppContext.server", () => ({ getRequestAppContext: mocks.context }));
vi.mock("@/lib/health/loadOwnHealthEvents", () => ({ loadOwnHealthEvents: mocks.own }));
vi.mock("@/lib/health/competitor/loadCompetitorHealthEvents", () => ({ loadCompetitorHealthEvents: mocks.competitor }));

const svc = {};
const context = { svc, user: { id: "admin" }, isAdmin: true,
  shellContext: { datasetMode: "own", competitorLabelKey: "label-a", competitorLabels: [{ label_key: "label-a" }] } };
const request = (query = "mode=own") => new NextRequest(`https://example.com/api/health-events?${query}`);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue(context);
  mocks.own.mockResolvedValue({ data: [], error: null });
  mocks.competitor.mockResolvedValue({ data: [], error: null });
});

describe("Health Events access and dataset isolation", () => {
  it("does not invoke analytics loaders without a session or admin access", async () => {
    mocks.context.mockResolvedValueOnce({ ...context, user: null });
    expect((await GET(request())).status).toBe(401);
    mocks.context.mockResolvedValueOnce({ ...context, isAdmin: false });
    expect((await GET(request())).status).toBe(403);
    expect(mocks.own).not.toHaveBeenCalled();
    expect(mocks.competitor).not.toHaveBeenCalled();
  });
  it("rejects invalid windows and stale dataset requests before analytics reads", async () => {
    expect((await GET(request("mode=own&days=10000"))).status).toBe(400);
    expect((await GET(request("mode=competitor"))).status).toBe(409);
    expect(mocks.own).not.toHaveBeenCalled();
    expect(mocks.competitor).not.toHaveBeenCalled();
  });
  it("defaults to 30 days and dispatches exclusively to the own loader", async () => {
    expect((await GET(request())).status).toBe(200);
    expect(mocks.own).toHaveBeenCalledWith(svc, expect.objectContaining({ start: expect.any(String), end: expect.any(String) }));
    expect(mocks.competitor).not.toHaveBeenCalled();
  });
  it("validates competitor labels and respects the Health page's explicit label", async () => {
    mocks.context.mockResolvedValue({ ...context, shellContext: { ...context.shellContext, datasetMode: "competitor" } });
    expect((await GET(request("mode=competitor&label=unknown"))).status).toBe(400);
    expect(mocks.competitor).not.toHaveBeenCalled();
    expect((await GET(request("mode=competitor&label=label-a&days=7"))).status).toBe(200);
    expect(mocks.competitor).toHaveBeenCalledWith(svc, expect.any(Object), "label-a");
    expect(mocks.own).not.toHaveBeenCalled();
  });
  it("supports all competitors and reports failed reads rather than an empty success", async () => {
    mocks.context.mockResolvedValue({ ...context, shellContext: { ...context.shellContext, datasetMode: "competitor" } });
    mocks.competitor.mockResolvedValue({ data: null, error: { message: "Query failed" } });
    const response = await GET(request("mode=competitor&label=__all__&days=90"));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ success: false, error: "Query failed" });
    expect(mocks.competitor).toHaveBeenCalledWith(svc, expect.any(Object), "__all__");
  });
});
