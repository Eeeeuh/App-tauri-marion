//! Crash-safe JSON persistence for the library.
//!
//! Writes go to a temp file that is fsync'd then atomically renamed over the
//! real file; the previous version is kept as `library.bak.json`. On read, a
//! missing or corrupted main file falls back to the backup.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

pub const FILE: &str = "library.json";
pub const BACKUP: &str = "library.bak.json";
const TMP: &str = "library.json.tmp";
/// Hard cap to protect against runaway data (≈ tens of thousands of shows).
pub const MAX_BYTES: usize = 10 * 1024 * 1024;

fn is_valid_json(text: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(text).is_ok()
}

fn read_valid(path: &Path) -> Option<String> {
    let text = fs::read_to_string(path).ok()?;
    is_valid_json(&text).then_some(text)
}

/// Returns the stored library, `None` if nothing has been saved yet.
pub fn load(dir: &Path) -> Result<Option<String>, String> {
    let main = dir.join(FILE);
    if let Some(text) = read_valid(&main) {
        return Ok(Some(text));
    }
    if let Some(text) = read_valid(&dir.join(BACKUP)) {
        return Ok(Some(text));
    }
    if main.exists() {
        // Present but unreadable/corrupted and no usable backup: refuse to
        // pretend it's empty, otherwise the next save would wipe it.
        return Err(format!("{} est illisible", main.display()));
    }
    Ok(None)
}

/// Validates then atomically writes `data`.
pub fn save(dir: &Path, data: &str) -> Result<(), String> {
    if data.len() > MAX_BYTES {
        return Err("données trop volumineuses".into());
    }
    if !is_valid_json(data) {
        return Err("JSON invalide".into());
    }
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;

    let main = dir.join(FILE);
    let tmp = dir.join(TMP);
    write_synced(&tmp, data).map_err(|e| e.to_string())?;

    // Keep the last good version around before replacing it.
    if read_valid(&main).is_some() {
        let _ = fs::copy(&main, dir.join(BACKUP));
    }
    fs::rename(&tmp, &main).map_err(|e| e.to_string())?;
    Ok(())
}

fn write_synced(path: &PathBuf, data: &str) -> std::io::Result<()> {
    let mut f = fs::File::create(path)?;
    f.write_all(data.as_bytes())?;
    f.sync_all()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_dir_loads_none() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(load(dir.path()).unwrap(), None);
    }

    #[test]
    fn roundtrip_and_creates_dir() {
        let dir = tempfile::tempdir().unwrap();
        let sub = dir.path().join("nested/app");
        save(&sub, r#"{"version":1,"shows":[]}"#).unwrap();
        assert_eq!(
            load(&sub).unwrap().as_deref(),
            Some(r#"{"version":1,"shows":[]}"#)
        );
        assert!(!sub.join(TMP).exists());
    }

    #[test]
    fn keeps_backup_of_previous_version() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), r#"{"v":1}"#).unwrap();
        save(dir.path(), r#"{"v":2}"#).unwrap();
        assert_eq!(
            fs::read_to_string(dir.path().join(BACKUP)).unwrap(),
            r#"{"v":1}"#
        );
        assert_eq!(load(dir.path()).unwrap().as_deref(), Some(r#"{"v":2}"#));
    }

    #[test]
    fn rejects_invalid_json_and_keeps_existing_data() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), r#"{"v":1}"#).unwrap();
        assert!(save(dir.path(), "{not json").is_err());
        assert_eq!(load(dir.path()).unwrap().as_deref(), Some(r#"{"v":1}"#));
    }

    #[test]
    fn rejects_oversized_payload() {
        let dir = tempfile::tempdir().unwrap();
        let big = format!("\"{}\"", "a".repeat(MAX_BYTES));
        assert!(save(dir.path(), &big).is_err());
    }

    #[test]
    fn corrupted_main_falls_back_to_backup() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), r#"{"v":1}"#).unwrap();
        save(dir.path(), r#"{"v":2}"#).unwrap();
        fs::write(dir.path().join(FILE), "garbage{").unwrap();
        assert_eq!(load(dir.path()).unwrap().as_deref(), Some(r#"{"v":1}"#));
    }

    #[test]
    fn corrupted_without_backup_is_an_error_not_empty() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(FILE), "garbage{").unwrap();
        assert!(load(dir.path()).is_err());
    }

    #[test]
    fn stale_tmp_file_is_ignored() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), r#"{"v":1}"#).unwrap();
        fs::write(dir.path().join(TMP), "half-writ").unwrap();
        assert_eq!(load(dir.path()).unwrap().as_deref(), Some(r#"{"v":1}"#));
        save(dir.path(), r#"{"v":2}"#).unwrap();
        assert_eq!(load(dir.path()).unwrap().as_deref(), Some(r#"{"v":2}"#));
    }
}
