# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a [Daggerverse](https://daggerverse.dev) repository containing reusable Dagger modules:

- `flux/` — Dagger TypeScript module for Flux CD operations (bootstrap, OCI artifact push, manifest validation)
- `ansible/` — Dagger TypeScript module for Ansible operations (in early development)

## Tools & Setup

Tool versions are managed via [mise](https://mise.jdx.dev):
- Dagger `v0.20.3` (defined in `mise.toml`)

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
dagger call validate --help
dagger call bootstrap --help

# Run the Dagger development shell
dagger develop
```

### Module structure

- `flux/src/flux.ts` — `Flux` class with all implementations (`bootstrap`, `pushArtifact`, `validate`)
- `flux/sdk/` — Auto-generated Dagger TypeScript SDK (do not edit manually)
- `flux/dagger.json` — Module manifest (name, engine version, SDK)

### Exposed functions

| Function | Description |
|---|---|
| `bootstrap` | Installs Flux Operator on an existing Kubernetes cluster via Helm, creates secrets, optionally applies manifests and waits for readiness |
| `pushArtifact` | Pushes OCI artifacts to a registry (single or multi-component mode), optionally signs with Cosign |
| `validate` | Lints YAML with yamllint and validates manifests with kubeconform + kustomize |

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

## Module: ansible/

### Running Dagger functions

```bash
cd ansible

# Call a function
dagger call container-echo --string-arg="hello"
dagger call grep-dir --directory-arg=. --pattern="pattern"

# Run the Dagger development shell
dagger develop
```

### Module structure

- `ansible/src/index.ts` — `Ansible` class (currently scaffold with `containerEcho` and `grepDir` functions)
- `ansible/sdk/` — Auto-generated Dagger TypeScript SDK (do not edit manually)
- `ansible/dagger.json` — Module manifest (name, engine version, SDK)
