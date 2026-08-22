# clypra-native-cli

Headless validation entry point for the shared native core. It is intentionally
small and deterministic; rendering and golden-frame commands will be added as
the native compositor moves out of the Tauri adapter.

```bash
cargo run --manifest-path crates/clypra-native-cli/Cargo.toml -- manifest
cargo run --manifest-path crates/clypra-native-cli/Cargo.toml -- validate request.json
cargo run --manifest-path crates/clypra-native-cli/Cargo.toml -- cache-key request.json
cargo run --manifest-path crates/clypra-native-cli/Cargo.toml -- diff actual.png expected.png 2

# Checked-in contract fixture
cargo run --manifest-path crates/clypra-native-cli/Cargo.toml -- \
  validate crates/clypra-native-cli/fixtures/minimal-request.json
```

The CLI consumes the same `FrameRequest` contract used by the editor. This
makes Studio and CI able to reject invalid native scenes before a desktop app
is involved.

A raster smoke fixture can be rendered directly via the CLI:

```bash
cargo run --manifest-path crates/clypra-native-cli/Cargo.toml -- \
  render crates/clypra-native-cli/fixtures/raster-request.json raster.png
```
