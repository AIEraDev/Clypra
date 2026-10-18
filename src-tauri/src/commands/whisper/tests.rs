use super::*;
use std::io::Write;

#[test]
fn test_is_valid_whisper_model_rejects_missing_and_tiny_files() {
    let temp_dir = std::env::temp_dir().join("clypra_test_whisper");
    let _ = std::fs::create_dir_all(&temp_dir);

    // 1. Missing file
    let missing = temp_dir.join("nonexistent.bin");
    assert!(!is_valid_whisper_model_file(&missing));

    // 2. 68-byte mock file (reproducing the exact mock found on disk)
    let mock_file = temp_dir.join("mock.bin");
    std::fs::write(
        &mock_file,
        b"Downloaded at: SystemTime { tv_sec: 1781398073 }",
    )
    .unwrap();
    assert!(!is_valid_whisper_model_file(&mock_file));

    // 3. PyTorch file (.pt) rejected even if large
    let pt_file = temp_dir.join("test.pt");
    let mut pt_handle = std::fs::File::create(&pt_file).unwrap();
    pt_handle.write_all(b"PK\x03\x04").unwrap();
    pt_handle.set_len(15 * 1024 * 1024).unwrap();
    drop(pt_handle);
    assert!(!is_valid_whisper_model_file(&pt_file));

    // 4. Large file (15MB) with WRONG magic header
    let wrong_magic = temp_dir.join("wrong_magic.bin");
    let mut wm_handle = std::fs::File::create(&wrong_magic).unwrap();
    wm_handle.write_all(b"RAND").unwrap();
    wm_handle.set_len(15 * 1024 * 1024).unwrap();
    drop(wm_handle);
    assert!(!is_valid_whisper_model_file(&wrong_magic));

    // 5. Large file (15MB) with VALID "ggml" magic header
    let valid_ggml = temp_dir.join("valid_model.bin");
    let mut valid_handle = std::fs::File::create(&valid_ggml).unwrap();
    valid_handle.write_all(b"ggml").unwrap();
    valid_handle.set_len(15 * 1024 * 1024).unwrap();
    drop(valid_handle);
    assert!(is_valid_whisper_model_file(&valid_ggml));

    // Clean up
    let _ = std::fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_resolve_model_file_path_rejects_corrupted_candidates() {
    let temp_dir = std::env::temp_dir().join("clypra_test_whisper_resolve");
    let models_dir = temp_dir.join("models").join("whisper");
    let _ = std::fs::create_dir_all(&models_dir);

    // Put a 68-byte mock file at tiny.bin
    let corrupt_path = models_dir.join("tiny.bin");
    std::fs::write(&corrupt_path, b"Downloaded at: mock").unwrap();

    // Put a .pt file at tiny.pt
    let pt_path = models_dir.join("tiny.pt");
    std::fs::write(&pt_path, b"pytorch").unwrap();

    // resolve_model_file_path must NOT return the corrupt or .pt candidate!
    assert_eq!(resolve_model_file_path(&temp_dir, "tiny"), None);

    // Now place a valid ggml file at ggml-tiny.bin
    let valid_path = models_dir.join("ggml-tiny.bin");
    let mut file = std::fs::File::create(&valid_path).unwrap();
    file.write_all(b"ggml").unwrap();
    file.set_len(15 * 1024 * 1024).unwrap();
    drop(file);

    // Must now find the valid model!
    assert_eq!(resolve_model_file_path(&temp_dir, "tiny"), Some(valid_path));

    let _ = std::fs::remove_dir_all(&temp_dir);
}
