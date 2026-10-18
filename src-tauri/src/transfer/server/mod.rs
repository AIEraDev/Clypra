pub mod listener;
pub mod network;
pub mod routes;
pub mod template;
pub mod types;

#[cfg(test)]
mod tests;

pub use listener::start;
pub use network::{
    generate_qr_svg, get_non_colliding_path, list_network_interfaces, local_ip, select_best_lan_ip,
    unix_secs,
};
pub use template::{render_upload_page, UPLOAD_PAGE};
pub use types::{
    AppState, CancelledEventPayload, CompleteEventPayload, FileMetadata, IncomingEventPayload,
    IncomingFileBrief, NetworkInterfaceInfo, PrepareUploadRequest, ProgressEventPayload, SenderInfo,
    SessionQuery, UploadQuery,
};
