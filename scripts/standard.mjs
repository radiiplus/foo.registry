import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, "..");
const workspace = resolve(repository, "..", "..");
const standardRoot = resolve(process.argv[2] ?? join(workspace, "std"));
const version = JSON.parse(await readFile(join(workspace, "package.json"), "utf8")).version;
const revision = execFileSync("git", ["-C", workspace, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const updated = execFileSync("git", ["-C", workspace, "log", "-1", "--format=%cs", "--", "std"], { encoding: "utf8" }).trim();

for (const path of await jsonFiles(join(repository, "packages"))) {
  if (path.includes(`${sep}packages${sep}std${sep}`)) continue;
  const record = JSON.parse(await readFile(path, "utf8"));
  record.kind = "package";
  record.api = api(record.source);
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`);
}

const destination = join(repository, "packages", "std");
await rm(destination, { recursive: true, force: true });
for (const path of await sourceFiles(standardRoot)) {
  const module = relative(standardRoot, path).split(sep).join("/").replace(/\.iv$/, "");
  const content = (await readFile(path, "utf8")).replace(/\r\n?/g, "\n");
  const sourcePath = `std/${module}.iv`;
  const source = bundle([{ path: sourcePath, content }]);
  const description = summary(content) || `Foo standard library module ${module}.`;
  const record = {
    schema: "foo.package/v1",
    kind: "standard",
    name: `std/${module}`,
    version,
    description,
    category: "standard library",
    tags: ["standard", ...new Set(module.split("/"))].sort(),
    license: "MIT OR Apache-2.0",
    compatible: true,
    deprecated: "",
    platforms: module === "os/windows" ? ["windows"] : module === "os/unix" ? ["linux", "macos"] : ["all"],
    updated,
    owner: { id: 152736140, login: "radiiplus" },
    repository: "https://github.com/radiiplus/foo",
    revision,
    install: module.includes("/") ? `use "${module}".` : `use ${module}.`,
    dependencies: [],
    readme: [description, `Import this module with ${module.includes("/") ? `use "${module}".` : `use ${module}.`}`],
    source,
    api: api(source),
  };
  const output = join(destination, ...module.split("/"), version + ".json");
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(record, null, 2)}\n`);
}

function api(source) {
  return {
    schema: "foo.api/v1",
    modules: source.files.filter((file) => file.path.endsWith(".iv")).map((file) => ({
      name: file.path.replace(/\.iv$/, "").replace(/^src\//, ""),
      path: file.path,
      summary: summary(file.content),
      items: declarations(file.content),
    })),
  };
}

function declarations(source) {
  const lines = source.split("\n");
  const result = [];
  let comments = [];
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (trimmed.startsWith("--")) {
      const comment = trimmed.replace(/^---?!?\s?/, "").trim();
      if (comment) comments.push(comment);
      continue;
    }
    if (!trimmed) continue;
    if (!trimmed.startsWith("public ")) {
      comments = [];
      continue;
    }
    let declaration = trimmed;
    const type = /^public define\s+/.test(trimmed);
    if (type && trimmed.includes("{")) {
      let depth = braces(trimmed);
      while (depth > 0 && index + 1 < lines.length) {
        declaration += `\n${lines[++index].trimEnd()}`;
        depth += braces(lines[index]);
      }
    } else if (/^public function\s+/.test(trimmed)) {
      while (!declaration.includes("{") && index + 1 < lines.length) declaration += ` ${lines[++index].trim()}`;
      declaration = declaration.split("{")[0].trim().replace(/[.]$/, "") + ".";
    } else {
      while (!declaration.trimEnd().endsWith(".") && index + 1 < lines.length) declaration += ` ${lines[++index].trim()}`;
    }
    const match = declaration.match(/^public\s+(?:use\s+"[^"]+"\s+)?(function|define|constant|dynamic)\s+([A-Za-z][A-Za-z0-9_]*)/);
    if (match) result.push({
      kind: match[1] === "define" ? "type" : match[1] === "dynamic" ? "value" : match[1],
      name: match[2],
      signature: declaration,
      documentation: comments.join(" "),
    });
    comments = [];
  }
  return result;
}

function braces(value) {
  return [...value].reduce((depth, character) => depth + (character === "{" ? 1 : character === "}" ? -1 : 0), 0);
}

function summary(source) {
  const lines = [];
  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (lines.length) break;
      continue;
    }
    if (!trimmed.startsWith("--")) break;
    const value = trimmed.replace(/^---?!?\s?/, "").trim();
    if (value) lines.push(value);
  }
  return lines.join(" ");
}

function bundle(files) {
  files.sort((left, right) => left.path.localeCompare(right.path));
  const canonical = files.map((file) => `${file.path}\0${file.content}\0`).join("");
  return { format: "foo.source/v1", digest: createHash("sha256").update(canonical).digest("hex"), files };
}

async function sourceFiles(root) {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...await sourceFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".iv")) result.push(path);
  }
  return result.sort();
}

async function jsonFiles(root) {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...await jsonFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".json")) result.push(path);
  }
  return result;
}
