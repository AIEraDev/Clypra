# Architecture-First Delivery ADR

Status: accepted.

## Decision

Clypra solves features, defects, refactors, and performance work in the
architecture that owns the behavior. A change must establish one authoritative
state and execution flow across every affected runtime rather than layering a
local patch over a broken contract.

## Rules

- Identify the root cause and owning subsystem before selecting a solution.
- Define one canonical model and data flow. Legacy compatibility and migration
  code may adapt that model, but may not become a second live authority.
- Trace all consumers of a cross-runtime concern: editor controls, browser
  preview, native preview, export, persistence, and project loading where they
  apply.
- A transition layer needs an explicit owner, bounded scope, focused tests,
  and a checkable removal condition: name every remaining consumer, the issue
  or milestone that tracks migration, and the condition for deleting the
  layer (for example, "delete once editor, native preview, browser preview,
  export, and serialization exclusively read `ClipAudioProperties`"). Silent
  fallback is not an acceptable production failure policy.
- Native performance features must be benchmarked and accepted in the native
  runtime. Browser behavior is not evidence of native correctness or
  performance.

## Delivery evidence

Every architecture-affecting pull request completes the Architecture-First
section of the pull-request template. It records the root cause, authority,
affected consumers, and focused regression coverage. A change that affects one
runtime must explicitly confirm the corresponding consumer in each other
applicable runtime still works; native-only evidence does not excuse a broken
browser implementation, and browser-only evidence does not prove native
behavior. Performance changes also record the target runtime, representative
media/hardware conditions, and the relevant before/after measurements from the
performance contract.

## Consequences

This policy can make a fix larger than an isolated patch, but it prevents the
same logical state from diverging across preview, export, persistence, and
platform runtimes. If an architectural boundary cannot be completed safely,
the work remains visibly incomplete rather than being concealed by a fallback.
