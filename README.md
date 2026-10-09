# FOO Registry

The official package catalog for the [FOO programming language](https://github.com/radiiplus/foo).

This repository stores published community packages. The registry reads bundled standard modules from the [FOO source catalog](https://github.com/radiiplus/foo/blob/main/registry/standard.json), generated from `lib/*.iv` in the FOO repository. Standard modules are not published here.

New to the language? Visit the [main FOO repository](https://github.com/radiiplus/foo) for installation, documentation, examples, and releases.

## Quick usage

Find a package:

```sh
foo search http
foo info lib/json
foo info package-name
```

Bundled FOO modules use the reserved `lib/` namespace. For example, the
standard catalog record for `use json.` is `lib/json`.

Add and install a package:

```sh
foo add package-name
foo install
```

Check for and install compatible updates:

```sh
foo outdated
foo update package-name
```

Create and publish a package:

```sh
foo login
foo init my-package
cd my-package
foo publish
```
