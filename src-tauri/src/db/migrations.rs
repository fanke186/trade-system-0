use crate::error::AppResult;
use chrono::Utc;
use std::path::{Path, PathBuf};

pub fn backup_if_present(app_dir: &Path, db_path: &Path) -> AppResult<Option<PathBuf>> {
    if !db_path.exists() {
        return Ok(None);
    }
    let backup_dir = app_dir.join("backup");
    std::fs::create_dir_all(&backup_dir)?;
    let stem = db_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("database");
    let target = backup_dir.join(format!(
        "{}.{}.bak",
        stem,
        Utc::now().format("%Y%m%d%H%M%S")
    ));
    std::fs::copy(db_path, &target)?;
    Ok(Some(target))
}
