# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a [Daggerverse](https://daggerverse.dev) repository containing reusable Dagger modules. Currently it contains one module: `flux/` — a Dagger TypeScript module for Flux CD operations (pushing OCI artifacts).

## Tools & Setup

Tool versions are managed via [mise](https://mise.jdx.dev):
- Dagger `v0.19.3` (defined in `mise.toml`)

```bash
mise install   # Install required tools
```

## Module: flux/

### Running Dagger functions

All Dagger commands must be run from within the module directory (`flux/`):

```bash
cd flux

# Call a function
dagger call push-artifact --help

# Run the Dagger development shell
dagger develop
```

### Module structure

- `flux/src/index.ts` — Main module class `Flux`, exports top-level `@func()` functions that delegate to `Flux as FluxFunctions`
- `flux/src/flux.ts` — `Flux` class with the actual implementations
- `flux/sdk/` — Auto-generated Dagger TypeScript SDK (do not edit manually)
- `flux/dagger.json` — Module manifest (name, engine version, SDK)

### TypeScript conventions

Dagger modules use decorator-based registration:
- `@object()` on classes to register them as Dagger types
- `@func()` on methods to expose them as callable Dagger functions
- Imports come from `@dagger.io/dagger` (resolved via `tsconfig.json` paths to the local `sdk/`)

### Regenerating the SDK

If the Dagger engine version changes, regenerate the SDK:

```bash
cd flux
dagger develop
```

This updates `flux/sdk/client.gen.ts` and `flux/dagger.json`.
