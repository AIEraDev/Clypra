// Integration test for ResolutionTier
// Note: The lib name is "tauri_app_lib" (see Cargo.toml [lib] section)
use tauri_app_lib::thumbnail_engine::ResolutionTier;

#[test]
fn test_resolution_tier_from_dpr() {
    // Test DPR 1.2 → Tier1x
    assert_eq!(ResolutionTier::from_dpr(1.2), ResolutionTier::Tier1x);
    
    // Test DPR 2.0 → Tier2x
    assert_eq!(ResolutionTier::from_dpr(2.0), ResolutionTier::Tier2x);
    
    // Test boundary cases
    assert_eq!(ResolutionTier::from_dpr(1.0), ResolutionTier::Tier1x);
    assert_eq!(ResolutionTier::from_dpr(1.4), ResolutionTier::Tier1x);
    assert_eq!(ResolutionTier::from_dpr(1.49), ResolutionTier::Tier1x);
    assert_eq!(ResolutionTier::from_dpr(1.5), ResolutionTier::Tier2x);
    assert_eq!(ResolutionTier::from_dpr(3.0), ResolutionTier::Tier2x);
}

#[test]
fn test_resolution_tier_dimensions() {
    assert_eq!(ResolutionTier::Tier1x.dimensions(), (80, 60));
    assert_eq!(ResolutionTier::Tier2x.dimensions(), (160, 120));
}

#[test]
fn test_resolution_tier_label() {
    assert_eq!(ResolutionTier::Tier1x.label(), "1x");
    assert_eq!(ResolutionTier::Tier2x.label(), "2x");
}

#[test]
fn test_resolution_tier_from_label() {
    assert_eq!(ResolutionTier::from_label("1x").unwrap(), ResolutionTier::Tier1x);
    assert_eq!(ResolutionTier::from_label("2x").unwrap(), ResolutionTier::Tier2x);
    assert!(ResolutionTier::from_label("3x").is_err());
    assert!(ResolutionTier::from_label("invalid").is_err());
}
