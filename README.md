# Foo registry data

This directory is the seed for the standalone [`radiiplus/foo.registry`](https://github.com/radiiplus/foo.registry) Git repository. Git is the database: the registry has no SQL store, cache, counters, or server-side state.

## Layout

```text
packages/<name>/<version>.json  canonical releases
indexes/index.json             shard manifest
indexes/index-000001.json      generated discovery shard
schemas/*.json                 strict JSON schemas
scripts/index.mjs              deterministic index builder
test/index.mjs                 data-layer tests
```

Categories and tags exist only as user-defined package metadata. They never create filesystem directories. The builder normalizes categories by trimming whitespace, collapsing repeated spaces, and lowercasing them. Entries sort by category first and package name second.

## Build

Regenerate from the canonical `packages/` tree:

```sh
node scripts/index.mjs
```

Or build from a JSON array of package releases into another local Git repository:

```sh
node scripts/index.mjs packages.json ../foo.registry
```

Shard names use six-digit sequence numbers and each shard is hard-limited to 100,000 entries. The manifest revision is a SHA-256 digest of the canonical sorted index, so identical input produces identical files.

The UI reads these files directly from GitHub. Set `VITE_REGISTRY_URL` to the raw repository root when using a different source.
