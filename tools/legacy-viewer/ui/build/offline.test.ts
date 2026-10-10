import { expect, it } from "vitest";
import { offlineDependencyStrings } from "./offline";
function rewrite(code: string) {
  const chunk = { type: "chunk", code, fileName: "app.js" };
  const hook = offlineDependencyStrings().generateBundle as (
    this: { error: (message: string) => never },
    options: unknown,
    bundle: unknown,
  ) => void;
  hook.call(
    {
      error: (message) => {
        throw new Error(message);
      },
    },
    {},
    { chunk },
  );
  return chunk.code;
}
it("removes bundled error decoder URLs without allowing network endpoints", () => {
  expect(
    rewrite(
      '"https://react.dev/errors/1"; "https://redux.js.org/Errors?code=2"; "https://redux-toolkit.js.org/Errors?code=2"; "https://bit.ly/3cXEKWf"',
    ),
  ).not.toMatch(/https?:\/\//);
  expect(() => rewrite('fetch("https://outside.example/api")')).toThrow(
    "Unexpected external URL",
  );
  expect(() => rewrite('fetch("http://outside.example/api")')).toThrow(
    "Unexpected HTTP literal",
  );
});
it("retains the runtime value of inert DOM namespace identifiers", () => {
  const code = rewrite('"http://www.w3.org/2000/svg"');
  expect(code).not.toContain("http://");
  expect(JSON.parse(code)).toBe("http://www.w3.org/2000/svg");
});
