fn main() {
    println!("cargo:rerun-if-env-changed=AGENTHUB_TAURI_REQUIRE_SIDECAR");

    let profile = std::env::var("PROFILE").unwrap_or_default();
    let require_sidecar = std::env::var("AGENTHUB_TAURI_REQUIRE_SIDECAR")
        .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
        .unwrap_or(false);

    if profile == "debug" && !require_sidecar && std::env::var_os("TAURI_CONFIG").is_none() {
        std::env::set_var("TAURI_CONFIG", r#"{"bundle":{"externalBin":[]}}"#);
    }

    tauri_build::build()
}
