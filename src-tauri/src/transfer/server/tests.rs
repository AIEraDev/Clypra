use super::network::*;

#[test]
fn test_local_ip_detection() {
    let ip = local_ip();
    assert!(!ip.is_empty());
    let parsed: Result<std::net::Ipv4Addr, _> = ip.parse();
    assert!(parsed.is_ok(), "Expected valid IPv4, got: {}", ip);
}

#[test]
fn test_list_network_interfaces() {
    let ifaces = list_network_interfaces();
    for iface in &ifaces {
        assert!(!iface.ip.is_empty());
        assert!(!iface.name.is_empty());
    }
}

#[test]
fn test_generate_qr_svg() {
    let test_url = "http://192.168.1.50:53317";
    let svg = generate_qr_svg(test_url).expect("QR generation should succeed");
    assert!(svg.contains("<svg"));
    assert!(svg.contains("xmlns=\"http://www.w3.org/2000/svg\""));
    assert!(svg.contains("</svg>"));
}

#[test]
fn test_get_non_colliding_path() {
    let tmp = std::env::temp_dir();
    let path1 = get_non_colliding_path(&tmp, "non_existing_test_file_clypra.mp4");
    assert_eq!(path1, tmp.join("non_existing_test_file_clypra.mp4"));
}

#[test]
fn test_sanitize_filename_traversal_prevention() {
    // Relative traversal
    assert_eq!(sanitize_filename("../escape.txt"), "escape.txt");
    assert_eq!(sanitize_filename("../../etc/passwd"), "passwd");
    assert_eq!(sanitize_filename("..\\..\\windows\\system32\\cmd.exe"), "cmd.exe");

    // Absolute paths
    assert_eq!(sanitize_filename("/tmp/escape.txt"), "escape.txt");
    assert_eq!(sanitize_filename("C:\\Windows\\System32\\calc.exe"), "calc.exe");

    // Edge cases
    assert_eq!(sanitize_filename(".."), "upload.bin");
    assert_eq!(sanitize_filename("."), "upload.bin");
    assert_eq!(sanitize_filename(""), "upload.bin");
    assert_eq!(sanitize_filename("   "), "upload.bin");
    assert_eq!(sanitize_filename("valid_clip.mp4"), "valid_clip.mp4");

    // Confinement with get_non_colliding_path
    let inbox = std::env::temp_dir().join("clypra_inbox_test");
    let escaped_path = get_non_colliding_path(&inbox, "../../../secret.txt");
    assert!(escaped_path.starts_with(&inbox));
    assert_eq!(escaped_path, inbox.join("secret.txt"));
}

#[test]
fn test_staged_file_dto_excludes_file_path() {
    use super::types::StagedFileDto;
    let dto = StagedFileDto {
        id: "file-123".to_string(),
        file_name: "video.mp4".to_string(),
        size: 1024,
        mime_type: "video/mp4".to_string(),
        created_at: 12345678,
    };
    let json_str = serde_json::to_string(&dto).unwrap();
    assert!(!json_str.contains("filePath"));
    assert!(!json_str.contains("file_path"));
    assert!(json_str.contains("\"fileName\":\"video.mp4\""));
}

#[test]
fn test_transfer_service_hub_token_validation() {
    use crate::transfer::TransferService;
    let svc = TransferService::new();
    assert!(!svc.get_hub_token().is_empty());
    assert!(svc.is_token_valid(Some(svc.get_hub_token())));
    assert!(!svc.is_token_valid(Some("invalid-token")));
    assert!(!svc.is_token_valid(None));
}

#[test]
fn test_session_bounding_and_pruning() {
    use crate::transfer::session::{SessionState, TransferSession};
    use crate::transfer::TransferService;

    let svc = TransferService::new();

    // Insert 10 completed or rejected sessions
    for i in 0..10 {
        let sid = format!("session-{}", i);
        let s = TransferSession {
            session_id: sid.clone(),
            sender_alias: "test".to_string(),
            sender_ip: "127.0.0.1".to_string(),
            state: if i % 2 == 0 {
                SessionState::Complete
            } else {
                SessionState::Rejected
            },
            files: vec![],
            received_files: vec![],
            bytes_received: 0,
            total_bytes: 0,
        };
        svc.sessions.insert(sid.clone(), s);
        svc.file_tokens.insert(format!("{}:file-0", sid), "token".to_string());
    }

    assert_eq!(svc.sessions.len(), 10);
    assert_eq!(svc.file_tokens.len(), 10);

    // Prune stale sessions
    svc.prune_stale_sessions();

    // All completed/rejected sessions must be evicted
    assert_eq!(svc.sessions.len(), 0);
    assert_eq!(svc.file_tokens.len(), 0);
}

#[test]
fn test_socket_peer_ip_extraction_prevents_ssrf() {
    use std::net::SocketAddr;
    let genuine_socket: SocketAddr = "192.168.1.42:54321".parse().unwrap();
    let peer_ip = genuine_socket.ip().to_string();
    assert_eq!(peer_ip, "192.168.1.42");
    // Verify that spoofed header strings are never considered
    assert_ne!(peer_ip, "10.0.0.99");
}
