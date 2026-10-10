import { afterEach, expect, it, vi } from "vitest";
import { ApiError, apiUrl, getJSON } from "./api";
afterEach(() => vi.unstubAllGlobals());
function origin() {
  vi.stubGlobal("window", { location: { origin: "http://127.0.0.1:8765" } });
}
it("creates stable, local cache URLs and encodes query values", () => {
  origin();
  expect(apiUrl("/api/tracks", { z: "a&b", a: 2, omitted: null })).toBe(
    "/api/tracks?a=2&z=a%26b",
  );
  expect(() => apiUrl("https://example.test/api/tracks")).toThrow(
    "local /api/",
  );
});
it("returns typed JSON and forwards the abort signal", async () => {
  origin();
  const mock = vi
    .fn()
    .mockResolvedValue(new Response('{"token":"test"}', { status: 200 }));
  vi.stubGlobal("fetch", mock);
  const controller = new AbortController();
  expect(
    await getJSON<{ token: string }>("/api/session", {}, controller.signal),
  ).toEqual({ token: "test" });
  expect(mock).toHaveBeenCalledWith(
    "/api/session",
    expect.objectContaining({ signal: controller.signal }),
  );
});
it("uses the API error JSON message and preserves status", async () => {
  origin();
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response('{"error":"No archive loaded"}', { status: 503 }),
      ),
  );
  await expect(getJSON("/api/tracks")).rejects.toMatchObject({
    name: "ApiError",
    message: "No archive loaded",
    status: 503,
  });
});
it("reports malformed successful JSON as an ApiError", async () => {
  origin();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("not JSON", { status: 200 })),
  );
  await expect(getJSON("/api/tracks")).rejects.toBeInstanceOf(ApiError);
});
it("keeps aborts separate from server errors", async () => {
  origin();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new DOMException("Aborted", "AbortError")),
  );
  await expect(getJSON("/api/tracks")).rejects.toMatchObject({
    name: "AbortError",
  });
});
