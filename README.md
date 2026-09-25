# Foo registry data

This directory is the seed for the standalone [`radiiplus/foo.registry`](https://github.com/radiiplus/foo.registry) Git repository. Git is the database: the registry has no SQL store, cache, counters, or server-side state.

## Layout

```text
packages/<name>/<version>.json  canonical releases (scopes add @scope/)
indexes/index.json             shard manifest
indexes/index-000001.jsonl     generated discovery shard (one entry per line)
schemas/*.json                 strict JSON schemas
scripts/index.mjs              deterministic index builder
test/index.mjs                 data-layer tests
```

Categories and tags exist only as user-defined package metadata. They never create filesystem directories. The builder normalizes categories by trimming whitespace, collapsing repeated spaces, and lowercasing them. Entries sort by category first and package name second.

Each expanded release record contains its formatted Foo source bundle and a SHA-256 digest. The repository URL and full 40-character commit SHA remain provenance metadata; installation reproduces the embedded immutable source without executing package code.

## Build

Regenerate from the canonical `packages/` tree:

```sh
node scripts/index.mjs
```

Or build from a JSON array of package releases into another local Git repository:

```sh
node scripts/index.mjs packages.json ../foo.registry
```

Shard names use six-digit sequence numbers and each shard is hard-limited to 100,000 entries. Shards use JSONL with one compact entry per line. Package records and the shard manifest use readable expanded JSON. The manifest revision is a SHA-256 digest of the canonical sorted index, so identical input produces identical files.

The read-only API consumes these files from GitHub. Browsers consume the API and never parse registry storage directly.
