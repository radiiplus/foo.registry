import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const limit = 100_000;

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const packagePattern = /^(?:@[a-z0-9][a-z0-9-]{0,38}\/[a-z][a-z0-9-]{0,63}|std\/[a-z][a-z0-9-]{0,63}(?:\/[a-z][a-z0-9-]{0,63})*|[a-z][a-z0-9-]{0,63})$/;
const tokenPattern = /^[a-z0-9][a-z0-9-]{0,31}$/;
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/;
const constraintPattern = /^(?:\^|~)?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const packageFields = new Set([
  "schema", "kind", "name", "version", "description", "category", "tags", "license", "compatible",
  "deprecated", "platforms", "updated", "owner", "repository", "revision", "install", "dependencies", "readme", "source", "api",
]);

export function normalizeCategory(value) {
  const category = requiredString(value, "category").trim().toLowerCase().replace(/\s+/g, " ");
  if (!/^[a-z0-9][a-z0-9 -]{0,63}$/.test(category)) {
    throw new TypeError("category must contain only lowercase letters, numbers, spaces, or hyphens");
  }
  return category;
}

export function normalizePackage(value) {
  if (!object(value)) throw new TypeError("package must be an object");
  const unknown = Object.keys(value).filter((key) => !packageFields.has(key));
  if (unknown.length) throw new TypeError(`unknown package fields: ${unknown.join(", ")}`);
  if (value.schema !== "foo.package/v1") throw new TypeError("invalid package schema");

  const name = requiredString(value.name, "name").trim().toLowerCase();
  if (!packagePattern.test(name)) throw new TypeError("invalid package name");
  const kind = value.kind ?? "package";
  if (!new Set(["package", "standard"]).has(kind)) throw new TypeError("invalid package kind");
  if (kind === "standard" && !name.startsWith("std/")) throw new TypeError("standard names must use the std/ namespace");
  if (kind === "package" && name.startsWith("std/")) throw new TypeError("the std/ namespace is reserved");
  const version = requiredString(value.version, "version").trim();
  if (!versionPattern.test(version)) throw new TypeError("invalid package version");
  const description = requiredString(value.description, "description").trim();
  if (description.length > 280) throw new TypeError("description must be at most 280 characters");
  const license = requiredString(value.license, "license").trim();
  const updated = requiredString(value.updated, "updated").trim();
  const date = new Date(`${updated}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(updated) || Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== updated) {
    throw new TypeError("updated must be an ISO date");
  }
  if (typeof value.compatible !== "boolean") throw new TypeError("compatible must be a boolean");
  if (!object(value.owner) || !Number.isSafeInteger(value.owner.id) || value.owner.id <= 0) {
    throw new TypeError("owner.id must be a positive integer");
  }
  if (Object.keys(value.owner).some((key) => key !== "id" && key !== "login")) throw new TypeError("owner has unknown fields");
  const login = requiredString(value.owner.login, "owner.login").trim();
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(login)) throw new TypeError("invalid owner.login");
  const repository = requiredString(value.repository, "repository").trim();
  try {
    const url = new URL(repository);
    if (url.protocol !== "https:") throw new Error();
  } catch {
    throw new TypeError("repository must be an HTTPS URL");
  }
  const revision = requiredString(value.revision, "revision").trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new TypeError("revision must be a full Git commit SHA");
  const dependencies = array(value.dependencies, "dependencies").map(normalizeDependency);
  dependencies.sort((left, right) => compare(left.name, right.name) || compare(left.kind, right.kind));

  const readme = array(value.readme, "readme").map((line, index) => requiredString(line, `readme[${index}]`));
  if (!readme.length) throw new TypeError("readme must contain at least one line");
  const source = normalizeSource(value.source);
  const api = normalizeApi(value.api, source);

  return {
    schema: "foo.package/v1",
    kind,
    name,
    version,
    description,
    category: normalizeCategory(value.category),
    tags: tokens(value.tags, "tags"),
    license,
    compatible: value.compatible,
    deprecated: optionalString(value.deprecated, "deprecated"),
    platforms: tokens(value.platforms ?? [], "platforms"),
    updated,
    owner: { id: value.owner.id, login },
    repository,
    revision,
    install: requiredString(value.install, "install").trim(),
    dependencies,
    readme,
    source,
    api,
  };
}

export function entries(records) {
  const releases = records.map(normalizePackage);
  const seen = new Set();
  const grouped = new Map();
  for (const release of releases) {
    const key = `${release.name}@${release.version}`;
    if (seen.has(key)) throw new TypeError(`duplicate package release: ${key}`);
    seen.add(key);
    const current = grouped.get(release.name) ?? [];
    current.push(release);
    grouped.set(release.name, current);
  }

  const indexed = [];
  for (const [name, versions] of grouped) {
    versions.sort((left, right) => compareVersions(right.version, left.version));
    const latest = versions.find((release) => !release.version.includes("-")) ?? versions[0];
    indexed.push({
      schema: "foo.entry/v1",
      kind: latest.kind,
      name: latest.name,
      version: latest.version,
      description: latest.description,
      category: latest.category,
      tags: latest.tags,
      license: latest.license,
      compatible: latest.compatible,
      deprecated: latest.deprecated,
      platforms: latest.platforms,
      updated: latest.updated,
      owner: latest.owner,
      repository: latest.repository,
      revision: latest.revision,
      exports: [...new Set(latest.api.modules.flatMap((module) => module.items.map((item) => item.name)))].sort(compare),
      path: `packages/${name}/${latest.version}.json`,
      versions: versions.map((release) => ({
        version: release.version,
        updated: release.updated,
        deprecated: release.deprecated,
        path: `packages/${name}/${release.version}.json`,
      })),
    });
  }
  return indexed.sort((left, right) => compare(left.category, right.category) || compare(left.name, right.name));
}

export function shards(items, size = limit) {
  if (!Number.isSafeInteger(size) || size < 1 || size > limit) {
    throw new RangeError(`shard size must be between 1 and ${limit}`);
  }
  const result = [];
  for (let offset = 0; offset < items.length; offset += size) result.push(items.slice(offset, offset + size));
  return result;
}

export async function build(records, destination = root, size = limit) {
  const normalized = records.map(normalizePackage);
  const indexed = entries(normalized);
  const packageRoot = join(destination, "packages");
  const indexRoot = join(destination, "indexes");
  await mkdir(packageRoot, { recursive: true });
  await mkdir(indexRoot, { recursive: true });

  for (const release of normalized) {
    const directory = join(packageRoot, release.name);
    await mkdir(directory, { recursive: true });
    await writeJson(join(directory, `${release.version}.json`), release);
  }

  for (const file of await readdir(indexRoot)) {
    if (/^(?:index-\d{6}\.jsonl|index-\d{6}\.json|packages-\d{3}\.json)$/.test(file)) await rm(join(indexRoot, file));
  }

  const descriptors = [];
  const groups = shards(indexed, size);
  for (const [position, group] of groups.entries()) {
    const filename = `index-${String(position + 1).padStart(6, "0")}.jsonl`;
    await writeFile(join(indexRoot, filename), `${group.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
    descriptors.push({
      path: `indexes/${filename}`,
      count: group.length,
      first: { category: group[0].category, name: group[0].name },
      last: { category: group.at(-1).category, name: group.at(-1).name },
    });
  }

  const revision = createHash("sha256").update(JSON.stringify(indexed)).digest("hex");
  const standardPackages = indexed.filter((entry) => entry.kind === "standard").map((entry) => {
    const release = normalized.find((candidate) => candidate.name === entry.name && candidate.version === entry.version);
    return {
      kind: release.kind,
      name: release.name,
      version: release.version,
      description: release.description,
      install: release.install,
      api: release.api,
    };
  });
  await writeJson(join(indexRoot, "standard.json"), {
    schema: "foo.standard/v1",
    revision,
    count: standardPackages.length,
    packages: standardPackages,
  });
  const manifest = {
    schema: "foo.registry/v1",
    revision,
    count: indexed.length,
    order: ["category", "name"],
    limit,
    shards: descriptors,
  };
  await writeJson(join(indexRoot, "index.json"), manifest);
  return manifest;
}

export async function readPackages(destination = root) {
  const packageRoot = join(destination, "packages");
  let paths;
  try {
    paths = await jsonFiles(packageRoot);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  return Promise.all(paths.sort(compare).map(async (path) => JSON.parse(await readFile(path, "utf8"))));
}

async function jsonFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await jsonFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".json")) result.push(path);
  }
  return result;
}

function normalizeDependency(value, index) {
  if (!object(value)) throw new TypeError(`dependencies[${index}] must be an object`);
  const allowed = new Set(["name", "version", "kind", "platforms"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new TypeError(`dependencies[${index}] has unknown fields`);
  const name = requiredString(value.name, `dependencies[${index}].name`).trim().toLowerCase();
  if (!packagePattern.test(name)) throw new TypeError(`invalid dependency name: ${name}`);
  const kind = value.kind ?? "runtime";
  if (!["runtime", "dev", "optional", "platform"].includes(kind)) throw new TypeError(`invalid dependency kind: ${kind}`);
  const version = requiredString(value.version, `dependencies[${index}].version`).trim();
  if (!constraintPattern.test(version)) throw new TypeError(`invalid dependency constraint: ${version}`);
  return {
    name,
    version,
    kind,
    platforms: tokens(value.platforms ?? [], `dependencies[${index}].platforms`),
  };
}

function normalizeSource(value) {
  if (!object(value) || value.format !== "foo.source/v1" || !Array.isArray(value.files)) {
    throw new TypeError("source must be a foo.source/v1 bundle");
  }
  if (Object.keys(value).some((key) => !["format", "digest", "files"].includes(key))) {
    throw new TypeError("source has unknown fields");
  }
  if (value.files.length === 0 || value.files.length > 1000) throw new TypeError("source must contain between 1 and 1000 files");
  const seen = new Set();
  const files = value.files.map((file, index) => {
    if (!object(file) || Object.keys(file).some((key) => !["path", "content"].includes(key))) {
      throw new TypeError(`source.files[${index}] must contain path and content`);
    }
    const path = requiredString(file.path, `source.files[${index}].path`).replace(/\\/g, "/");
    if (path.startsWith("/") || path.split("/").some((part) => !part || part === "." || part === "..")) {
      throw new TypeError(`unsafe source path: ${path}`);
    }
    if (typeof file.content !== "string") throw new TypeError(`source.files[${index}].content must be a string`);
    const key = path.toLowerCase();
    if (seen.has(key)) throw new TypeError(`duplicate source path: ${path}`);
    seen.add(key);
    return { path, content: file.content.replace(/\r\n?/g, "\n") };
  }).sort((left, right) => compare(left.path, right.path));
  const bytes = files.reduce((content, file) => `${content}${file.path}\0${file.content}\0`, "");
  return { format: "foo.source/v1", digest: createHash("sha256").update(bytes).digest("hex"), files };
}

function normalizeApi(value, source) {
  if (!object(value) || value.schema !== "foo.api/v1" || !Array.isArray(value.modules) ||
      Object.keys(value).some((key) => !["schema", "modules"].includes(key))) {
    throw new TypeError("api must be a foo.api/v1 index");
  }
  const paths = new Set(source.files.filter((file) => file.path.endsWith(".iv")).map((file) => file.path));
  const modules = value.modules.map((module, moduleIndex) => {
    if (!object(module) || !Array.isArray(module.items) ||
        Object.keys(module).some((key) => !["name", "path", "summary", "items"].includes(key))) {
      throw new TypeError(`invalid api module at index ${moduleIndex}`);
    }
    const path = requiredString(module.path, `api.modules[${moduleIndex}].path`);
    if (!paths.has(path)) throw new TypeError(`api module is not in source: ${path}`);
    const items = module.items.map((item, itemIndex) => {
      if (!object(item) || Object.keys(item).some((key) => !["kind", "name", "signature", "documentation"].includes(key))) {
        throw new TypeError(`invalid api item at ${moduleIndex}:${itemIndex}`);
      }
      if (!["function", "type", "constant", "value"].includes(item.kind)) throw new TypeError("invalid api item kind");
      return {
        kind: item.kind,
        name: requiredString(item.name, "api item name"),
        signature: requiredString(item.signature, "api item signature"),
        documentation: optionalString(item.documentation, "api item documentation"),
      };
    }).sort((left, right) => compare(left.kind, right.kind) || compare(left.name, right.name));
    return {
      name: requiredString(module.name, "api module name"),
      path,
      summary: optionalString(module.summary, "api module summary"),
      items,
    };
  }).sort((left, right) => compare(left.name, right.name));
  return { schema: "foo.api/v1", modules };
}

function compareVersions(left, right) {
  const a = versionPattern.exec(left);
  const b = versionPattern.exec(right);
  for (let index = 1; index <= 3; index += 1) {
    const difference = Number(a[index]) - Number(b[index]);
    if (difference) return difference;
  }
  if (!a[4] && b[4]) return 1;
  if (a[4] && !b[4]) return -1;
  return compare(a[4] ?? "", b[4] ?? "");
}

function tokens(value, field) {
  const result = array(value, field).map((item, index) => requiredString(item, `${field}[${index}]`).trim().toLowerCase());
  for (const item of result) if (!tokenPattern.test(item)) throw new TypeError(`invalid ${field} value: ${item}`);
  return [...new Set(result)].sort(compare);
}

function requiredString(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) throw new TypeError(`${field} must be a non-empty string`);
  return value;
}

function optionalString(value, field) {
  if (value === undefined) return "";
  if (typeof value !== "string") throw new TypeError(`${field} must be a string`);
  return value.trim();
}

function array(value, field) {
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array`);
  return value;
}

function object(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  const input = process.argv[2];
  const destination = process.argv[3] ? resolve(process.argv[3]) : root;
  const records = input ? JSON.parse(await readFile(input, "utf8")) : await readPackages(destination);
  if (!Array.isArray(records)) throw new TypeError("input must be a JSON array of package releases");
  const manifest = await build(records, destination);
  console.log(`indexed ${manifest.count} packages into ${manifest.shards.length} shard(s)`);
}
