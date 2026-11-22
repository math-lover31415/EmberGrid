import test from "node:test";
import assert from "node:assert/strict";

test("frontend package exposes the required build and test commands", async () => {
  const packageJson = await import("../package.json", { with: { type: "json" } });
  assert.equal(typeof packageJson.default.scripts.build, "string");
  assert.equal(typeof packageJson.default.scripts.test, "string");
});
