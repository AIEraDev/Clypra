# Clypra — Senior Engineering Standards & Discipline Rules
# Loaded automatically from .agents/rules/ by all agent tools.
# Supplements AGENTS.md, .agents/skills/senior-engineer-decision-making/SKILL.md, and .agents/skills/clypra-bug-hunter/SKILL.md.

## 1. Problem Framing Before Editing
- Understand the existing code paths, call trees, and store structures before making changes.
- Formulate a clear diagnosis of root cause versus symptom.
- Challenge unsound or speculative requests that violate core architectural invariants.

## 2. Minimal Coherent Change
- Scope changes strictly to the task at hand.
- Do not introduce speculative abstractions, unused generic utilities, or unrequested refactorings.
- Maintain documentation integrity: never delete existing comments, JSDoc blocks, or architectural notes unrelated to your change.

## 3. Investigation-Only Mode Default
- When requested to find bugs, review code, audit performance, or investigate regressions, default to **investigation-only mode**.
- Do not modify source code or claim a fix while performing an audit unless explicitly instructed to implement corrections.

## 4. Empirical Hypothesis Validation
- A suspicious pattern or code smell is not automatically a defect.
- Hypothesized bugs or performance bottlenecks must be validated with an executable test, profiler trace, or concrete evidence before being declared as defects.
- Categorize findings honestly: Confirmed, High confidence, Moderate confidence, or Low confidence.

## 5. Strict Type & Build Integrity
- Every code modification must compile cleanly with `npx tsc --noEmit` (0 errors required).
- Never silence TypeScript compiler errors using `any`, `@ts-ignore`, or loose type casts in production source files. Fix the underlying contract.
- Keep the working tree clean: remove any scratch scripts, temporary benchmark dumps, or untracked debris from source directories before completing tasks.

## 6. Protection of In-Flight Work
- Never execute destructive git resets (`git reset --hard`, `git checkout .`, `git clean -fd`) that wipe out uncommitted user edits in the working tree.
- Always inspect `git status` to verify that unrelated modifications remain untouched.
