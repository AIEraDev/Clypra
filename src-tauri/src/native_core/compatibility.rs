#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NativeFeatureStatus {
    Native,
    MigrationRequired,
    Unsupported,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NativeFeatureManifestEntry {
    pub feature_id: &'static str,
    pub category: &'static str,
    pub status: NativeFeatureStatus,
}

/// Compatibility inventory for the native frame graph. The manifest is kept
/// explicit so unsupported browser-only features cannot silently disappear
/// during the cutover. Entries move to `Native` only when the golden corpus
/// covers their output.
pub fn native_feature_manifest() -> &'static [NativeFeatureManifestEntry] {
    &[
        NativeFeatureManifestEntry {
            feature_id: "media.video",
            category: "media",
            status: NativeFeatureStatus::Native,
        },
        NativeFeatureManifestEntry {
            feature_id: "media.image",
            category: "media",
            status: NativeFeatureStatus::MigrationRequired,
        },
        NativeFeatureManifestEntry {
            feature_id: "layer.solid",
            category: "layer",
            status: NativeFeatureStatus::MigrationRequired,
        },
        NativeFeatureManifestEntry {
            feature_id: "layer.text",
            category: "layer",
            status: NativeFeatureStatus::MigrationRequired,
        },
        NativeFeatureManifestEntry {
            feature_id: "layer.sticker",
            category: "layer",
            status: NativeFeatureStatus::MigrationRequired,
        },
        NativeFeatureManifestEntry {
            feature_id: "layer.mask",
            category: "layer",
            status: NativeFeatureStatus::MigrationRequired,
        },
        NativeFeatureManifestEntry {
            feature_id: "effect.adjustment",
            category: "effect",
            status: NativeFeatureStatus::MigrationRequired,
        },
        NativeFeatureManifestEntry {
            feature_id: "effect.filter",
            category: "effect",
            status: NativeFeatureStatus::MigrationRequired,
        },
        NativeFeatureManifestEntry {
            feature_id: "effect.video",
            category: "effect",
            status: NativeFeatureStatus::MigrationRequired,
        },
        NativeFeatureManifestEntry {
            feature_id: "transition.dissolve",
            category: "transition",
            status: NativeFeatureStatus::MigrationRequired,
        },
        NativeFeatureManifestEntry {
            feature_id: "transition.wipe",
            category: "transition",
            status: NativeFeatureStatus::MigrationRequired,
        },
        NativeFeatureManifestEntry {
            feature_id: "sticker.lottie",
            category: "sticker",
            status: NativeFeatureStatus::MigrationRequired,
        },
        NativeFeatureManifestEntry {
            feature_id: "export.video",
            category: "export",
            status: NativeFeatureStatus::MigrationRequired,
        },
    ]
}

pub fn assert_native_feature_supported(feature_id: &str) -> Result<(), String> {
    match native_feature_manifest()
        .iter()
        .find(|entry| entry.feature_id == feature_id)
    {
        Some(entry) if entry.status == NativeFeatureStatus::Native => Ok(()),
        Some(entry) => Err(format!(
            "Native feature '{}' is {:?}",
            entry.feature_id, entry.status
        )),
        None => Err(format!(
            "Native feature '{}' is not in the compatibility manifest",
            feature_id
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn video_is_the_first_native_graph_feature() {
        assert!(assert_native_feature_supported("media.video").is_ok());
        assert!(assert_native_feature_supported("layer.text").is_err());
    }
}
