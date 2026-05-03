use crate::db::{duckdb, migrations, sqlite};
use crate::error::AppResult;
use crate::services::{model_provider_service, watchlist_service};
use rusqlite::Connection as SqliteConnection;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tokio::task::AbortHandle;

pub struct AppState {
    pub app_dir: PathBuf,
    pub sqlite: Mutex<SqliteConnection>,
    pub duckdb: Mutex<duckdb::DuckConnection>,
    pub http: reqwest::Client,
    pub ai_score_worker_running: Mutex<bool>,
    pub pending_llm_requests: Mutex<HashMap<String, AbortHandle>>,
}

impl AppState {
    pub fn initialize(app_dir: PathBuf) -> AppResult<Self> {
        tracing::info!(app_dir = %app_dir.display(), "正在初始化应用状态");

        std::fs::create_dir_all(&app_dir)?;
        for child in [
            "agents",
            "materials",
            "exports",
            "logs",
            "backup",
            "cache/provider",
            "config",
            "secrets",
        ] {
            std::fs::create_dir_all(app_dir.join(child))?;
        }

        let sqlite_path = app_dir.join("app.sqlite");
        let duckdb_path = app_dir.join("kline.duckdb");
        migrations::backup_if_present(&app_dir, &sqlite_path)?;
        migrations::backup_if_present(&app_dir, &duckdb_path)?;

        tracing::info!("正在打开 SQLite 数据库");
        let sqlite = sqlite::open(&sqlite_path)?;
        tracing::info!("SQLite 连接成功，正在执行迁移");
        sqlite::run_migrations(&sqlite)?;
        model_provider_service::export_providers_yaml(&sqlite, &app_dir)?;
        tracing::info!("SQLite 迁移完成");

        tracing::info!("正在打开 DuckDB 数据库");
        let duckdb = duckdb::open(&duckdb_path)?;
        tracing::info!("DuckDB 连接成功，正在执行迁移");
        duckdb::run_migrations(&duckdb)?;
        tracing::info!("DuckDB 迁移完成");

        watchlist_service::normalize_existing_symbols(&sqlite, &duckdb)?;
        tracing::info!("自选标的归一化检查完成");

        tracing::info!("应用状态初始化完成");

        Ok(Self {
            app_dir,
            sqlite: Mutex::new(sqlite),
            duckdb: Mutex::new(duckdb),
            http: reqwest::Client::new(),
            ai_score_worker_running: Mutex::new(false),
            pending_llm_requests: Mutex::new(HashMap::new()),
        })
    }
}
