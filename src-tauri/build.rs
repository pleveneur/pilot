fn main() {
    // The Laya service is an OPTIONAL external resource: it is never versioned
    // (.gitignore -> src-tauri/laya/) and is copied in by `npm run prepare:laya`
    // only when the LayaPL source happens to be available. Tauri's build script
    // resolves every entry of `bundle.resources` at compile time and fails with
    // "resource path `laya` doesn't exist" when the directory is absent (as on a
    // fresh clone or in CI, where beforeBuildCommand is not run before
    // `cargo test`). Ensure the directory exists so the compilation succeeds:
    // an empty resource directory embeds nothing and Laya stays optional.
    let laya = std::path::Path::new("laya");
    if !laya.exists() {
        let _ = std::fs::create_dir_all(laya);
    }

    tauri_build::build();

    // Embed the Windows application manifest (Common Controls v6) into test
    // binaries too. tauri-build only links its full resource (version/icon/manifest)
    // to binary targets (cargo:rustc-link-arg-bins), so `cargo test --lib` produced
    // a test binary without the manifest. Without it, the loader resolves comctl32
    // v5.82 (System32) which does not export TaskDialogIndirect, causing
    // STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139) at startup.
    //
    // We embed a manifest-only resource via cargo:rustc-link-arg (applies to every
    // target, including the implicit lib test binary). The manifest uses resource
    // ID 2 (manifest.rc) so it does not collide with tauri-build's manifest (ID 1)
    // on the main binary; the loader picks the lowest-ID manifest, so the main
    // binary keeps tauri-build's and the test binary gets ours.
    if cfg!(target_os = "windows") {
        embed_resource::compile_for_everything("manifest.rc", embed_resource::NONE)
            .manifest_required()
            .expect("failed to embed manifest into test binaries");
    }
}
