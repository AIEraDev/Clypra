# clypra-native-daemon

Local HTTP adapter for Clypra Studio labs. It exposes the shared native
contract without creating a second desktop product:

```bash
cargo run --manifest-path crates/clypra-native-daemon/Cargo.toml
```

Available endpoints:

- `GET /health`
- `GET /v1/handshake`
- `POST /v1/validate`
- `POST /v1/render/frame` (raster/text frames and cross-dissolve, directional-wipe, and zoom-blur transitions render through the shared wgpu compositor; video decode and other creative transitions remain explicit unsupported capabilities)

Unsupported capabilities return a structured error. Studio must not interpret a
missing native capability as a successful render or silently reintroduce a legacy
implementation.
