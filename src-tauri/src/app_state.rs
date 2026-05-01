use crate::db::{duckdb, migrations, sqlite};
use crate::error::AppResult;
use rusqlite::Connection as SqliteConnection;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct AppState {
    pub app_dir: PathBuf,
    pub sqlite: Mutex<SqliteConnection>,
    pub duckdb: Mutex<duckdb::DuckConnection>,
    pub http: reqwest::Client,
}

impl AppState {
    pub fn initialize(app_dir: PathBuf) -> AppResult<Self> {
        std::fs::create_dir_all(&app_dir)?;
        for child in ["materials", "exports", "logs", "backup", "cache/provider", "secrets"] {
            std::fs::create_dir_all(app_dir.join(child))?;
        }

        let sqlite_path = app_dir.join("app.sqlite");
        let duckdb_path = app_dir.join("kline.duckdb");
        migrations::backup_if_present(&app_dir, &sqlite_path)?;
        migrations::backup_if_present(&app_dir, &duckdb_path)?;

        let sqlite = sqlite::open(&sqlite_path)?;
        sqlite::run_migrations(&sqlite)?;
        let duckdb = duckdb::open(&duckdb_path)?;
        duckdb::run_migrations(&duckdb)?;

        Ok(Self {
            app_dir,
            sqlite: Mutex::new(sqlite),
            duckdb: Mutex::new(duckdb),
            http: reqwest::Client::new(),
        })
    }
}

