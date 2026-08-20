use clypra_native_core::{compare_rgba8, compatibility::native_feature_manifest, FrameRequest};
use std::{env, fs, process::ExitCode};

fn usage() {
    eprintln!(
        "Usage:\n  clypra-native-cli validate <request.json>\n  clypra-native-cli cache-key <request.json>\n  clypra-native-cli diff <actual.png> <expected.png> [tolerance]\n  clypra-native-cli manifest"
    );
}

fn load_request(path: &str) -> Result<FrameRequest, String> {
    let contents =
        fs::read_to_string(path).map_err(|error| format!("Unable to read {path}: {error}"))?;
    serde_json::from_str(&contents)
        .map_err(|error| format!("Unable to parse native frame request {path}: {error}"))
}

fn run_diff(args: &[String]) -> Result<(), String> {
    let Some(actual_path) = args.get(2) else {
        usage();
        return Err("diff requires an actual PNG path".to_string());
    };
    let Some(expected_path) = args.get(3) else {
        usage();
        return Err("diff requires an expected PNG path".to_string());
    };
    let tolerance = args
        .get(4)
        .map(|value| {
            value
                .parse::<u8>()
                .map_err(|_| format!("invalid channel tolerance: {value}"))
        })
        .transpose()?
        .unwrap_or(0);

    let actual = image::open(actual_path)
        .map_err(|error| format!("Unable to read actual PNG {actual_path}: {error}"))?
        .to_rgba8();
    let expected = image::open(expected_path)
        .map_err(|error| format!("Unable to read expected PNG {expected_path}: {error}"))?
        .to_rgba8();

    if actual.dimensions() != expected.dimensions() {
        return Err(format!(
            "PNG dimensions differ: actual {:?}, expected {:?}",
            actual.dimensions(),
            expected.dimensions()
        ));
    }

    let (width, height) = actual.dimensions();
    let diff = compare_rgba8(&actual, &expected, width, height)?;
    println!(
        "{}",
        serde_json::to_string_pretty(&diff).map_err(|error| error.to_string())?
    );
    if diff.is_within_tolerance(tolerance) {
        Ok(())
    } else {
        Err(format!(
            "golden mismatch: max channel error {} exceeds tolerance {}",
            diff.max_channel_error, tolerance
        ))
    }
}

fn run(args: &[String]) -> Result<(), String> {
    let Some(command) = args.get(1).map(String::as_str) else {
        usage();
        return Err("Missing command".to_string());
    };

    match command {
        "validate" => {
            let Some(path) = args.get(2) else {
                usage();
                return Err("validate requires a request JSON path".to_string());
            };
            let request = load_request(path)?;
            request.validate().map_err(|error| error.to_string())?;
            println!(
                "valid contractVersion={} requestId={} frame={} output={}x{}",
                request.contract_version,
                request.request_id,
                request.frame_time.frame_index,
                request.output_width,
                request.output_height
            );
            Ok(())
        }
        "cache-key" => {
            let Some(path) = args.get(2) else {
                usage();
                return Err("cache-key requires a request JSON path".to_string());
            };
            let request = load_request(path)?;
            println!(
                "{}",
                request.cache_key().map_err(|error| error.to_string())?
            );
            Ok(())
        }
        "diff" => run_diff(args),
        "manifest" => {
            println!("featureId\tcategory\tstatus");
            for feature in native_feature_manifest() {
                println!(
                    "{}\t{}\t{:?}",
                    feature.feature_id, feature.category, feature.status
                );
            }
            Ok(())
        }
        "help" | "--help" | "-h" => {
            usage();
            Ok(())
        }
        _ => {
            usage();
            Err(format!("Unknown command: {command}"))
        }
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = env::args().collect();
    match run(&args) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("clypra-native-cli: {error}");
            ExitCode::from(2)
        }
    }
}
