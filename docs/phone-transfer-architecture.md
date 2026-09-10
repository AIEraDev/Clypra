# Phone Transfer Architecture

> **Status:** Production  
> **Protocol:** LocalSend v2 (LAN-only, no cloud, no account required)  
> **Port:** 53317 (auto-fallback to 53318, 53319 on collision)

---

## 1. Overview

Clypra's phone transfer system lets users move files between their phone and
the desktop editor over a local Wi-Fi network without cables, cloud services,
or accounts. It is a full implementation of the open
[LocalSend v2 protocol](https://localsend.org), meaning it is interoperable
with the LocalSend app on iOS and Android as well as any other LocalSend v2
client on the network.

The system is composed of:

- A **Rust Axum HTTP server** embedded in the Tauri binary (`src-tauri/src/transfer/`)
- A **React UI panel** (`src/components/ui/TransferPanel.tsx`)
- A **theme sync bridge** (`src/store/themeRegistry.ts → update_transfer_theme`)

---

## 2. Protocol — LocalSend v2

### Discovery

Two mechanisms run simultaneously:

**UDP Multicast (LocalSend v2 compatible)**

```
Multicast group: 224.0.0.167:53317
Announce interval: every 4 seconds
```

The announcer broadcasts a JSON payload:

```json
{
  "alias": "Clypra Desktop",
  "version": "2.0",
  "deviceModel": "Desktop",
  "deviceType": "desktop",
  "fingerprint": "<sha256 of device key>",
  "port": 53317,
  "protocol": "http",
  "download": true,
  "announce": true
}
```

The listener reads multicast UDP packets, parses valid peer announcements
(non-empty fingerprint, not self), and immediately sends a **direct unicast
response** back to the sender IP. This ensures mutual visibility even when
multicast is filtered by managed networks.

**Active Subnet Scan**

`scan_subnet` polls `GET /api/localsend/v2/info` on every host in the local
`/24` subnet (`.1` through `.254`) using up to **40 concurrent HTTP requests**
with a **1.2-second timeout** per host. The TransferPanel triggers a scan on
every open and polls discovered devices every **4 seconds**.

### HTTP Routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/localsend/v2/info` | Device identification (fingerprint, alias, OS, port) |
| `POST` | `/api/localsend/v2/register` | Peer registration |
| `POST` | `/api/localsend/v2/prepare-upload` | Initiate a receive session (triggers consent prompt) |
| `POST` | `/api/localsend/v2/upload` | Stream file body (requires `sessionId`, `fileId`, `token` query params) |
| `POST` | `/api/localsend/v2/cancel` | Cancel an in-progress session |
| `GET` | `/` | Web Hub page (served to phone browser for staged-file download) |
| `GET` | `/api/transfer/files` | List staged files |
| `GET` | `/api/transfer/download/:id` | Download a staged file (`Content-Disposition: attachment`) |
| `GET` | `/api/transfer/view/:id` | View a staged file inline (`Content-Disposition: inline`) |
| `GET` | `/api/transfer/theme` | Live editor theme as JSON (consumed by Web Hub JS) |
| `GET` | `/qr` | SVG QR code embedding the local HTTP URL |

---

## 3. State Machine — `TransferService`

`TransferService` (`src-tauri/src/transfer/mod.rs`) is stored as Tauri managed
state and owns:

| Field | Type | Purpose |
|---|---|---|
| `sessions` | `DashMap<String, TransferSession>` | Active receive sessions |
| `staged_files` | `DashMap<String, StagedFile>` | Files staged for phone download |
| `discovered_devices` | `DashMap<String, DiscoveredDevice>` | UDP-discovered peers |
| `consent_senders` | `DashMap<String, oneshot::Sender<bool>>` | Per-session oneshot channels that hold `prepare-upload` open until user accepts/rejects |
| `file_tokens` | `DashMap<String, String>` | Per-file upload tokens (`sessionId:fileId` → UUID) |
| `theme_colors` | `RwLock<HashMap<String, String>>` | Current editor theme for the Web Hub page |
| `bound_port` | `Mutex<u16>` | Actual bound port (may differ from 53317) |

### Session state transitions

```
                  prepare-upload received
                        │
                        ▼
                    Pending (HTTP handler blocks on oneshot)
                   /          \
          accept              reject
             │                   │
             ▼                   ▼
         Accepted             Rejected
             │
    files uploading
             │
             ▼
         Complete
             │ (or user cancels)
             ▼
         Cancelled
```

---

## 4. File Transfer Flows

### Desktop → Phone (Staged files)

1. User picks files via `open_file_path` or the Tauri dialog. `stage_files_for_transfer` adds them to `staged_files`.
2. Phone opens the Web Hub page (`GET /`) in its browser. The page lists staged files and renders a Download/View button per file.
3. Server streams the file via `GET /api/transfer/download/:id` (attachment) or `GET /api/transfer/view/:id` (inline).
4. Alternatively, `send_files_to_peer` sends directly to a discovered LocalSend peer using the prepare-upload / upload flow.

### Phone → Desktop (Receive)

```
Phone POSTs /api/localsend/v2/prepare-upload
  │  (HTTP handler blocks on oneshot for up to 60s)
  │
  └─► Tauri emits "clypra://transfer-incoming" with session ID + file briefs
           │
           ▼
      TransferPanel shows consent dialog (auto-switches to Receive tab)
           │
      User clicks Accept ──► accept_transfer_session(sessionId)
           │                   sends true to oneshot
           │                   HTTP handler unblocks, responds:
           │                   { sessionId, files: { fileId: token } }
           │                   session state → Accepted
           │
      User clicks Reject ──► reject_transfer_session(sessionId)
                               sends false to oneshot
                               HTTP handler returns 403 Declined
                               session state → Rejected
           │
           ▼ (after accept)
Phone POSTs /api/localsend/v2/upload?sessionId=&fileId=&token=
  for each file
  │  (body streamed to disk, bytes_received updated per chunk)
  │  (Tauri emits "clypra://transfer-progress" per chunk)
  │
  └─► All files received:
      Tauri emits "clypra://transfer-complete" with absolute file paths
```

---

## 5. QR Code

`generate_qr_svg` uses the `qrcode` crate to produce an SVG QR code embedding
the local HTTP URL (e.g. `http://192.168.1.5:53317`). TransferPanel fetches it
via the `get_transfer_qr_code` Tauri command and renders it as a data-URL
`<img>`. It is visible in both the Send and Receive tabs so the phone user can
scan to open the Web Hub without manually typing the address.

---

## 6. Theme Sync

The mobile Web Hub page mirrors the desktop editor's visual theme so the
experience feels cohesive.

`syncThemeToTransferService()` in `src/store/themeRegistry.ts` calls
`invoke("update_transfer_theme", { theme })` with the current palette (CSS
variable values). This fires:

- When TransferPanel first opens
- In a `useEffect` watching `uiTheme` and `fontFamily` changes
- From `settingsStore` on every theme or font change

On the Rust side, `update_transfer_theme` updates `theme_colors` in
`TransferService`. The Web Hub page is rendered server-side by
`render_upload_page()` which does string-template replacement of tokens
(`{{BG}}`, `{{ACCENT}}`, `{{FONT_FAMILY}}`, etc.) with live theme values.
`GET /api/transfer/theme` also returns the theme as JSON for client-side JS.

---

## 7. Tauri Commands

| Command | Description |
|---|---|
| `get_transfer_service_status` | Health check and port |
| `get_discovered_devices` | List UDP-discovered peers |
| `start_transfer_service` | Start HTTP server + UDP discovery |
| `stop_transfer_service` | Stop both |
| `get_transfer_server_url` | Local HTTP URL for QR display |
| `get_transfer_qr_code` | SVG QR code |
| `accept_transfer_session` | Unblock the consent oneshot with `true` |
| `reject_transfer_session` | Unblock with `false` |
| `cancel_transfer_session` | Abort an in-progress receive |
| `get_transfer_sessions` | All active sessions |
| `stage_files_for_transfer` | Add files for phone download |
| `unstage_file` | Remove a single staged file |
| `clear_staged_files` | Clear all staged files |
| `get_staged_files` | List staged files |
| `scan_local_network` | Active subnet scan |
| `send_files_to_peer` | Push files to a discovered LocalSend peer |
| `get_transfer_save_directory` | Where received files are saved |
| `set_transfer_save_directory` | Change save directory |
| `open_transfer_save_directory` | Open in Finder/Explorer |
| `update_transfer_theme` | Push editor theme to Web Hub page |
| `get_network_interfaces` | Enumerate local network interfaces |

---

## 8. Security Model

- All transfers are LAN-only. The server only binds to local interfaces; no port is exposed to the internet.
- File uploads require a per-file UUID token issued by the server after user consent. Requests without a valid token are rejected.
- The server validates that the uploaded file size matches the declared size from `prepare-upload`.
- Filename collisions are resolved with `get_non_colliding_path` — files are never silently overwritten.
- The consent oneshot times out after 60 seconds to prevent indefinitely blocked HTTP handlers.
- `stage_files_for_transfer` uses `tauri-plugin-persisted-scope` to grant access to the specific files, not a directory tree.
