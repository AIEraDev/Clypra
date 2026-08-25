# Contributing to Clypra

First off, thank you for considering contributing to Clypra! It's people like you that make Clypra a great tool for creators worldwide.

## Open Core Model

Clypra uses an **Open Core** model:

- **Open Source (MIT License)**: The core editor, effects engine, and all UI components are free and open source forever
- **Commercial**: AI-powered features (auto-captions, natural language editing, smart reframe) are proprietary and accessed via API

This document covers contributions to the **open source** components. All contributions to the open source core are welcome!

## Code of Conduct

This project and everyone participating in it is governed by our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check the existing issues to avoid duplicates. When you create a bug report, include as many details as possible:

- **Use a clear and descriptive title**
- **Describe the exact steps to reproduce the problem**
- **Provide specific examples** (code snippets, screenshots, videos)
- **Describe the behavior you observed and what you expected**
- **Include your environment**: OS version, Clypra version, hardware specs

### Suggesting Features

Feature suggestions are welcome! Before creating a feature request:

- **Check if the feature already exists** in a newer version
- **Check if it's already been suggested** in Issues or Discussions
- **Provide a clear use case** - why would this benefit users?
- **Consider the scope** - does it fit Clypra's mission?

### Pull Requests

We actively welcome your pull requests:

1. **Fork the repo** and create your branch from `main`
2. **Make your changes** with clear commit messages
3. **Add tests** if you've added code that should be tested
4. **Ensure tests pass**: `npm test && cd src-tauri && cargo test`
5. **Submit your pull request**!

### Architecture-First Delivery

Every feature, fix, refactor, and performance change must solve the problem in
the architecture that owns it. Do not add a symptom-level patch, duplicate live
state, or silent fallback path just to make an isolated case appear to work.

Before requesting review, document in the PR description:

- the root cause and owning subsystem;
- the single authoritative state and data flow;
- every affected runtime consumer (editor, native preview, browser fallback,
  export, and serialization where applicable);
- focused regression tests and, for performance-sensitive work, measured
  evidence from the target runtime.

If the change includes a transition layer, list its owner, every remaining
consumer, tracking issue or milestone, and the exact condition that permits
deleting it. Complete the repository pull-request template; reviewers use it
as a release gate, not as optional prose.

Read the [Architecture-First Delivery ADR](docs/architecture-first-delivery-adr.md)
before changing a cross-runtime contract or introducing a migration layer.

## Benefits for Contributors

Active contributors (3+ merged PRs in the last 12 months) receive:

- **Free Pro Tier Access** ($10/month value) - unlimited AI features
- **Recognition** in CONTRIBUTORS.md and on clypra.com
- **Direct communication** with core maintainers via private Discord channel
- **Early access** to new features and beta releases
- **Speaking opportunities** at community calls and virtual meetups

## Development Setup

### Prerequisites

- Node.js 18+ with npm
- Rust 1.70+ ([install via rustup](https://rustup.rs/))
- FFmpeg 6.0+ with development libraries
- Platform-specific tools (see README.md)

### Quick Start

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/clypra.git
cd clypra

# Add upstream remote
git remote add upstream https://github.com/AIEraDev/clypra.git

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Add your Clypra API key if testing text effects

# Start development
npm run tauri dev
```

### Running Tests

```bash
# Frontend tests (Vitest)
npm test

# Backend tests (Cargo)
cd src-tauri && cargo test

# Specific test file
npm test -- src/lib/__tests__/timelineUtils.test.ts

# With coverage
npm test -- --coverage
```

### Code Quality

Before submitting a PR, ensure:

```bash
# TypeScript type checking
npx tsc --noEmit

# Rust linting
cd src-tauri && cargo clippy -- -D warnings

# Format code
npm run format
cd src-tauri && cargo fmt
```

## Project Structure

```
src/
├── components/          # React components
│   ├── editor/         # Timeline, Preview, Filmstrip
│   ├── screens/        # Launch, Settings screens
│   └── ui/             # Reusable UI components
├── store/               # Zustand state stores
│   ├── timelineStore.ts # Timeline structure
│   ├── playbackStore.ts # Playback state
│   └── projectStore.ts  # Project metadata
├── core/                # Core engine logic
│   ├── runtime/        # ProjectSession lifecycle
│   ├── scheduler/      # Frame scheduler
│   └── render/         # Canvas compositing
├── lib/                 # Shared utilities
│   ├── platform/       # Tauri IPC wrappers
│   └── monitoring/     # Performance monitoring
└── App.tsx              # Application entry

src-tauri/
├── src/
│   ├── commands/       # Tauri command handlers
│   │   ├── thumbnail.rs # Video decode
│   │   └── export.rs    # Export pipeline
│   └── thumbnail_engine/# FFmpeg decoder pool
└── Cargo.toml          # Rust dependencies
```

## Coding Standards

### TypeScript

- Use **strict mode** (enabled in tsconfig.json)
- **Functional components** with hooks (no class components)
- **Named exports** over default exports
- **JSDoc comments** for public APIs
- **Descriptive variable names** (no single-letter vars except loops)

```typescript
// Good
export function calculateClipDuration(clip: Clip, timelinePosition: number): number {
  // Implementation
}

// Bad
export default function calc(c: any, t: any): any {
  // Implementation
}
```

### Rust

- Follow `cargo fmt` formatting
- Pass `cargo clippy` with no warnings
- Use **descriptive names** and **doc comments**
- Prefer **Result** over **panic** for error handling
- Write **unit tests** for public functions

```rust
// Good
/// Decodes a video frame at the specified timestamp.
///
/// # Arguments
/// * `video_path` - Path to the video file
/// * `timestamp_ms` - Timestamp in milliseconds
///
/// # Returns
/// The decoded frame as RGB24 data, or an error if decode fails
pub fn decode_frame(
    video_path: &Path,
    timestamp_ms: i64,
) -> Result<FrameData, DecodeError> {
    // Implementation
}

// Bad
pub fn decode(p: &str, t: i64) -> Vec<u8> {
    // Implementation with unwrap()
}
```

### Git Commits

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add keyboard shortcuts for timeline navigation
fix: resolve audio sync drift during export
docs: update FFmpeg installation instructions
perf: optimize decoder pool eviction strategy
test: add tests for clip trimming edge cases
refactor: extract timeline calculations to utility
```

## Areas for Contribution

### Good First Issues

Look for issues labeled `good first issue`:

- Documentation improvements
- UI polish and accessibility
- Test coverage improvements
- Bug fixes with clear reproduction steps

### High-Impact Areas

- **Performance**: Optimize decoder pool, filmstrip generation, export pipeline
- **Mobile**: iOS/Android Capacitor integration and mobile UI
- **Effects**: New video effects, transitions, filters
- **Accessibility**: Keyboard shortcuts, screen reader support, high contrast themes
- **i18n**: Internationalization and localization

### What We're NOT Looking For

- AI features (proprietary, not open source)
- Cloud sync (planned as commercial feature)
- Major architecture changes without prior discussion
- Features that bloat the core editor

## Getting Help

- **Questions**: Use [GitHub Discussions](https://github.com/AIEraDev/clypra/discussions)
- **Bugs**: Open an [Issue](https://github.com/AIEraDev/clypra/issues)
- **Chat**: Join our [Discord](https://discord.gg/clypra) (community channel)
- **Security**: Email security@clypra.com (do not open public issues)

## Recognition

All contributors are recognized in:

- Git history (your commits are permanently preserved)
- [CONTRIBUTORS.md](./CONTRIBUTORS.md) (name + contribution summary)
- GitHub's Contributors graph
- Annual community call shoutouts

Top contributors may be invited to join the core maintainer team.

## License

By contributing, you agree that your contributions will be licensed under the MIT License, the same license covering the open source Clypra editor.

---

**Thank you for making Clypra better!** 🎬✨

If you have questions about contributing, reach out in Discussions or Discord. We're here to help!
