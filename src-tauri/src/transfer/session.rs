use serde::Serialize;

/// Lifecycle state of a file-receive session.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SessionState {
    Pending,
    Accepted,
    Rejected,
    InProgress,
    Complete,
    Cancelled,
}

/// Metadata for a single file within a transfer session.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IncomingFile {
    pub id: String,
    pub file_name: String,
    pub size: u64,
    pub file_type: String,
}

/// A complete receive session, including consent state, file list, and
/// progress counters.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferSession {
    pub session_id: String,
    pub sender_alias: String,
    pub sender_ip: String,
    pub state: SessionState,
    pub files: Vec<IncomingFile>,
    /// Absolute paths of files that have been fully saved to disk.
    pub received_files: Vec<String>,
    pub bytes_received: u64,
    pub total_bytes: u64,
}

/// A per-file upload token (opaque UUID string).
pub struct FileToken(pub String);
