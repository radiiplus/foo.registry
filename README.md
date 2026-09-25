# Foo registry data

This directory is the seed for the standalone [`radiiplus/foo.registry`](https://github.com/radiiplus/foo.registry) Git repository. Git is the database: the registry has no SQL store, cache, counters, or server-side state.

## Layout

```text
packages/<name>/<version>.json  canonical releases (scopes add @scope/)
indexes/index.json             shard manifest
indexes/index-000001.json      generated discovery shard
schemas/*.json                 strict JSON schemas
scripts/index.mjs              deterministic index builder
test/index.mjs                 data-layer tests
```

Categories and tags exist only as user-defined package metadata. They never create filesystem directories. The builder normalizes categories by trimming whitespace, collapsing repeated spaces, and lowercasing them. Entries sort by category first and package name second.

Each release binds its repository to a full 40-character Git commit SHA. Clients fetch that immutable revision and record a source digest in `foo.lock`.

## Build

Regenerate from the canonical `packages/` tree:

```sh
node scripts/index.mjs
```

Or build from a JSON array of package releases into another local Git repository:

```sh
node scripts/index.mjs packages.json ../foo.registry
```

Shard names use six-digit sequence numbers and each shard is hard-limited to 100,000 entries. Canonical records and generated indexes use compact one-line JSON. The manifest revision is a SHA-256 digest of the canonical sorted index, so identical input produces identical files.

The read-only API consumes these files from GitHub. Browsers consume the API and never parse registry storage directly.
