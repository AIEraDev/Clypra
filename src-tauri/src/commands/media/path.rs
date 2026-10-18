/// URL-percent decoding of a byte slice without external crate.
fn urlencoding_decode(s: &str) -> String {
    let mut bytes = Vec::with_capacity(s.len());
    let mut chars = s.bytes();
    while let Some(b) = chars.next() {
        if b == b'%' {
            let h1 = chars.next();
            let h2 = chars.next();
            if let (Some(c1), Some(c2)) = (h1, h2) {
                if let Ok(val) =
                    u8::from_str_radix(std::str::from_utf8(&[c1, c2]).unwrap_or(""), 16)
                {
                    bytes.push(val);
                    continue;
                }
            }
        }
        bytes.push(b);
    }
    String::from_utf8_lossy(&bytes).to_string()
}

pub fn normalize_file_path(path: &str) -> String {
    let trimmed = path.trim();
    let stripped = if let Some(rest) = trimmed.strip_prefix("asset://localhost/") {
        rest
    } else if let Some(rest) = trimmed.strip_prefix("asset://localhost%2F") {
        rest
    } else if let Some(rest) = trimmed.strip_prefix("http://asset.localhost/") {
        rest
    } else if let Some(rest) = trimmed.strip_prefix("https://asset.localhost/") {
        rest
    } else if let Some(rest) = trimmed.strip_prefix("asset://") {
        rest
    } else if let Some(rest) = trimmed.strip_prefix("file://") {
        rest
    } else {
        trimmed
    };

    if stripped == trimmed {
        return trimmed.to_string();
    }

    let mut decoded = urlencoding_decode(stripped);
    if decoded.starts_with("//") {
        while decoded.starts_with("//") {
            decoded.remove(0);
        }
    }
    #[cfg(target_os = "windows")]
    {
        if decoded.starts_with('/') && decoded.len() > 2 && decoded.as_bytes()[2] == b':' {
            decoded = decoded[1..].to_string();
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        if !decoded.starts_with('/') {
            decoded.insert(0, '/');
        }
    }
    decoded
}
