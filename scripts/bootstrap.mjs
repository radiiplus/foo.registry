import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY ?? "radiiplus/foo.registry";
const branch = process.env.GITHUB_BRANCH ?? "main";
if (!token) throw new Error("GITHUB_TOKEN is required");
if (!/^[^/]+\/[^/]+$/.test(repository)) throw new Error("GITHUB_REPOSITORY must be owner/name");

const api = `https://api.github.com/repos/${repository}`;
let reference = await request(`/git/ref/heads/${encodeURIComponent(branch)}`, "GET", undefined, true);
if (!reference) {
  const readme = await readFile(join(root, "README.md"));
  await request("/contents/README.md", "PUT", {
    message: "initialize foo registry",
    content: readme.toString("base64"),
  });
  reference = await request(`/git/ref/heads/${encodeURIComponent(branch)}`, "GET");
}

const parent = reference.object?.sha;
if (!parent) throw new Error("Registry branch has no head commit");
const commit = await request(`/git/commits/${parent}`, "GET");
if (!commit.tree?.sha) throw new Error("Registry head has no tree");
const files = await walk(root);
const tree = await Promise.all(files.map(async (path) => {
  const content = await readFile(join(root, ...path.split("/")), "utf8");
  const blob = await request("/git/blobs", "POST", { content, encoding: "utf-8" });
  return { path, mode: "100644", type: "blob", sha: blob.sha };
}));
const retained = new Set(files);
const previousTree = await request(`/git/trees/${commit.tree.sha}?recursive=1`, "GET");
for (const item of previousTree.tree ?? []) {
  if (typeof item.path === "string" && /^indexes\/index-\d{6}\.(?:json|jsonl)$/.test(item.path) && !retained.has(item.path)) {
    tree.push({ path: item.path, mode: "100644", type: "blob", sha: null });
  }
}
const createdTree = await request("/git/trees", "POST", { base_tree: commit.tree.sha, tree });
const createdCommit = await request("/git/commits", "POST", {
  message: "add registry foundation",
  tree: createdTree.sha,
  parents: [parent],
});
await request(`/git/refs/heads/${encodeURIComponent(branch)}`, "PATCH", { sha: createdCommit.sha, force: false });
console.log(`bootstrapped ${repository}@${branch} at ${createdCommit.sha}`);

async function walk(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === ".github") continue;
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await walk(absolute));
    else if (entry.isFile()) paths.push(relative(root, absolute).split(sep).join("/"));
  }
  return paths.sort();
}

async function request(path, method, body, optional = false) {
  let response;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      response = await fetch(`${api}${path}`, {
        method,
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "user-agent": "foo-registry-bootstrap",
          "x-github-api-version": "2026-03-10",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (response.status < 500) break;
    } catch (error) {
      if (attempt === 3) throw error;
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }
  if (!response) throw new Error(`GitHub ${method} ${path} returned no response`);
  if (optional && (response.status === 404 || response.status === 409)) return undefined;
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`GitHub ${method} ${path} failed: ${error.message ?? response.status}`);
  }
  return response.json();
}
