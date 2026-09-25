import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { build, entries, limit, normalizeCategory, normalizePackage, shards } from "../scripts/index.mjs";

const temporary = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

test("normalizes user-defined categories and sorts by category then package name", () => {
  assert.equal(normalizeCategory("  Developer   Tools  "), "developer tools");
  const indexed = entries([
    fixture("zeta", " Networking "),
    fixture("beta", "Developer   Tools"),
    fixture("alpha", "developer tools"),
  ]);
  assert.deepEqual(indexed.map(({ category, name }) => [category, name]), [
    ["developer tools", "alpha"],
    ["developer tools", "beta"],
    ["networking", "zeta"],
  ]);
});

test("rejects unknown fields including analytics counters", () => {
  assert.throws(() => normalizePackage({ ...fixture("alpha", "data"), downloads: 10 }), /unknown package fields: downloads/);
  assert.throws(() => normalizePackage({ ...fixture("alpha", "data"), schema: "other/v1" }), /invalid package schema/);
  assert.throws(() => normalizePackage({ ...fixture("alpha", "data"), readme: [] }), /readme must contain at least one line/);
});

test("enforces the hard shard limit", () => {
  const records = Array.from({ length: limit + 1 }, (_, index) => index);
  assert.deepEqual(shards(records).map((group) => group.length), [limit, 1]);
  assert.throws(() => shards(records, limit + 1), RangeError);
});

test("writes canonical records and deterministic six-digit shards", async () => {
  const destination = await mkdtemp(join(tmpdir(), "foo-registry-"));
  temporary.push(destination);
  const input = [fixture("zeta", "Networking"), fixture("alpha", "Data")];
  const first = await build(input, destination, 1);
  const before = await snapshot(destination);
  const second = await build(input, destination, 1);
  const after = await snapshot(destination);

  assert.deepEqual(first, second);
  assert.deepEqual(before, after);
  assert.equal(first.limit, 100_000);
  assert.deepEqual(first.order, ["category", "name"]);
  assert.deepEqual(first.shards.map(({ path }) => path), [
    "indexes/index-000001.json",
    "indexes/index-000002.json",
  ]);
  const shard = JSON.parse(await readFile(join(destination, "indexes", "index-000001.json"), "utf8"));
  assert.equal(shard.schema, "foo.index/v1");
  assert.deepEqual(shard.entries.map(({ name }) => name), ["alpha"]);
});

function fixture(name, category) {
  return {
    schema: "foo.package/v1",
    name,
    version: "1.0.0",
    description: `${name} package`,
    category,
    tags: ["example"],
    license: "MIT",
    compatible: true,
    deprecated: "",
    platforms: ["linux"],
    updated: "2026-09-25",
    owner: { id: 1, login: "radiiplus" },
    repository: `https://github.com/radiiplus/${name}`,
    install: `foo install ${name}`,
    dependencies: [],
    readme: ["Example documentation."],
  };
}

async function snapshot(destination) {
  const paths = [];
  for (const directory of ["indexes", "packages/alpha", "packages/zeta"]) {
    for (const file of (await readdir(join(destination, directory))).sort()) {
      paths.push([`${directory}/${file}`, await readFile(join(destination, directory, file), "utf8")]);
    }
  }
  return paths;
}
