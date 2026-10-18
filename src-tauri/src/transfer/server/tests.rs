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
