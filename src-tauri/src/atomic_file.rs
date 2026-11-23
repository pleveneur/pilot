// atomic_file.rs — Replace a file's content without ever truncating the
// previous version in place (VLT-01 / COMP-13).
//
// Callers: `vault.rs` (`~/.pilot/vault.json`) and `mcp_config.rs` (`mcp.json`).

use std::ffi::{OsStr, OsString};
use std::fs::{File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

/// Points where a TEST may inject an I/O failure. Never reachable in a
/// production build: `injected` is a constant `false` outside `cfg(test)`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) enum Fault {
    /// The data write fails after only part of the bytes reached the file
    /// (models a short write / disk full / I/O error while writing).
    DuringWrite,
    /// Every byte is written and flushed, then the step that publishes the new
    /// content fails (models an error just before the replacement).
    BeforeReplace,
}

#[cfg(test)]
thread_local! {
    static FAULT: std::cell::Cell<Option<Fault>> = const { std::cell::Cell::new(None) };
}

/// Test-only: arm a fault for the CURRENT thread; it fires once.
#[cfg(test)]
pub(crate) fn inject_fault(fault: Fault) {
    FAULT.with(|f| f.set(Some(fault)));
}

#[cfg(test)]
fn injected(stage: Fault) -> bool {
    FAULT.with(|f| {
        if f.get() == Some(stage) {
            f.set(None);
            true
        } else {
            false
        }
    })
}

#[cfg(not(test))]
#[inline(always)]
fn injected(_stage: Fault) -> bool {
    false
}

fn injected_error(stage: Fault) -> io::Error {
    io::Error::other(format!("injected test failure: {:?}", stage))
}

/// Writes `bytes` into `file`. Under an injected `DuringWrite` fault, only the
/// first half is written before the error is returned.
fn write_data(file: &mut File, bytes: &[u8]) -> io::Result<()> {
    if injected(Fault::DuringWrite) {
        file.write_all(&bytes[..bytes.len() / 2])?;
        return Err(injected_error(Fault::DuringWrite));
    }
    file.write_all(bytes)
}

/// Creates a NEW temp file next to `file_name` in `dir`, exclusively
/// (`create_new`: never opens an existing file, so two concurrent writers can
/// never share it). Unique name `.<file_name>.<uuid>.tmp`; owner-only
/// permissions on Unix (the content may be secrets).
fn create_exclusive_temp(dir: &Path, file_name: &OsStr) -> io::Result<(PathBuf, File)> {
    let mut last_err = None;
    for _ in 0..4 {
        let mut name = OsString::from(".");
        name.push(file_name);
        name.push(format!(".{}.tmp", uuid::Uuid::new_v4().simple()));
        let tmp = dir.join(name);
        let mut opts = OpenOptions::new();
        opts.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        match opts.open(&tmp) {
            Ok(f) => return Ok((tmp, f)),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => last_err = Some(e),
            Err(e) => return Err(e),
        }
    }
    Err(last_err.unwrap_or_else(|| io::Error::other("temp file name collision")))
}

/// Replaces the content of `path` with `bytes` WITHOUT truncating the previous
/// version in place:
/// 1. the bytes go to an exclusive temp file in the SAME directory;
/// 2. the temp file is flushed to disk (`sync_all`) and closed;
/// 3. it is renamed over `path` (`std::fs::rename` replaces an existing
///    destination; the old file is never removed first).
///
/// On any error before the rename, `path` is left untouched and the temp file
/// is removed. Once the rename succeeded the new content is committed: the
/// directory sync that follows (Unix) is best effort and never turns a
/// committed replacement into a reported failure (callers such as the vault
/// update their in-memory key only on `Ok`, which must match the file).
///
/// A symlink at `path` is written through (its target is replaced), as
/// `std::fs::write` did.
pub(crate) fn write_replacing(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let target: PathBuf = match std::fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_symlink() => std::fs::canonicalize(path)?,
        _ => path.to_path_buf(),
    };
    let file_name = target
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "path without file name"))?;
    let dir = match target.parent() {
        Some(p) if !p.as_os_str().is_empty() => p,
        _ => Path::new("."),
    };

    let (tmp, mut file) = create_exclusive_temp(dir, file_name)?;
    let written = (|| {
        write_data(&mut file, bytes)?;
        file.sync_all()?;
        if injected(Fault::BeforeReplace) {
            return Err(injected_error(Fault::BeforeReplace));
        }
        Ok(())
    })();
    // Close before renaming (required on Windows).
    drop(file);
    if let Err(e) = written.and_then(|()| std::fs::rename(&tmp, &target)) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    sync_dir_best_effort(dir);
    Ok(())
}

/// Persists the rename itself (directory entry) on Unix. Not available through
/// `std` on Windows (opening a directory needs extra flags): skipped there.
fn sync_dir_best_effort(dir: &Path) {
    #[cfg(unix)]
    {
        if let Ok(d) = File::open(dir) {
            let _ = d.sync_all();
        }
    }
    #[cfg(not(unix))]
    {
        let _ = dir;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(dir: &Path) -> Vec<String> {
        let mut v: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        v.sort();
        v
    }

    #[test]
    fn replaces_content_and_never_touches_a_foreign_tmp_file() {
        let dir = crate::test_util::TempDir::new("pilot_atomic_file_ok");
        let path = dir.join("data.json");
        // A file a naive implementation could reuse as its fixed temp name.
        std::fs::write(dir.join("data.json.tmp"), b"foreign").unwrap();
        write_replacing(&path, b"first").unwrap();
        write_replacing(&path, b"second").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"second");
        assert_eq!(std::fs::read(dir.join("data.json.tmp")).unwrap(), b"foreign");
        assert_eq!(names(&dir), vec!["data.json", "data.json.tmp"]);
    }

    #[test]
    fn concurrent_writers_leave_one_complete_version_and_no_residue() {
        let dir = crate::test_util::TempDir::new("pilot_atomic_file_concurrent");
        let path = dir.join("data.json");
        std::fs::write(&path, b"initial").unwrap();
        let contents: Vec<Vec<u8>> = (0..8u8).map(|i| vec![b'a' + i; 64 * 1024]).collect();
        let results: Vec<io::Result<()>> = std::thread::scope(|s| {
            let handles: Vec<_> = contents
                .iter()
                .map(|c| {
                    let p = path.clone();
                    s.spawn(move || write_replacing(&p, c))
                })
                .collect();
            handles.into_iter().map(|h| h.join().unwrap()).collect()
        });
        // POSIX rename never fails here; on Windows a concurrent replacement
        // may be refused (sharing violation): that writer then reports an
        // error, which is acceptable, but must leave nothing behind.
        #[cfg(unix)]
        assert!(results.iter().all(|r| r.is_ok()), "{:?}", results);
        #[cfg(not(unix))]
        assert!(results.iter().any(|r| r.is_ok()), "{:?}", results);
        let finale = std::fs::read(&path).unwrap();
        assert!(contents.contains(&finale), "mixed or partial content");
        assert_eq!(names(&dir), vec!["data.json"]);
    }
}
