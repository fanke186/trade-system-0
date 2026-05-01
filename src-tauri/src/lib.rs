mod app_state;
mod commands;
mod db;
mod error;
mod kline;
mod llm;
mod models;
mod services;

use app_state::AppState;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_dir = app.path().app_data_dir().unwrap_or_else(|_| {
                std::env::current_dir()
                    .expect("current dir")
                    .join("trade-system-0-data")
            });
            let state = AppState::initialize(app_dir).map_err(|err| {
                anyhow::anyhow!(
                    "{}",
                    serde_json::to_string_pretty(&err)
                        .unwrap_or_else(|_| format!("{}: {}", err.code, err.message))
                )
            })?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::trade_system::list_trade_systems,
            commands::trade_system::get_trade_system,
            commands::trade_system::import_material,
            commands::trade_system::generate_trade_system_draft,
            commands::trade_system::check_trade_system_completeness,
            commands::trade_system::save_trade_system_version,
            commands::trade_system::export_trade_system_version,
            commands::provider::list_model_providers,
            commands::provider::save_model_provider,
            commands::provider::set_active_model_provider,
            commands::provider::test_model_provider,
            commands::agent::create_agent_from_trade_system,
            commands::agent::run_agent_chat,
            commands::kline::sync_kline,
            commands::kline::get_bars,
            commands::kline::get_data_coverage,
            commands::kline::list_securities,
            commands::kline::aggregate_kline,
            commands::review::score_stock,
            commands::review::get_stock_reviews,
            commands::review::run_daily_review,
            commands::stock_meta::get_stock_meta,
            commands::watchlist_ops::reorder_watchlist_item,
            commands::watchlist_ops::move_watchlist_item,
            commands::watchlist_ops::create_watchlist_group,
            commands::watchlist_ops::delete_watchlist_group,
            commands::watchlist_ops::rename_watchlist_group,
            commands::watchlist::list_watchlists,
            commands::watchlist::save_watchlist,
            commands::watchlist::add_watchlist_item,
            commands::watchlist::remove_watchlist_item,
            commands::annotation::list_chart_annotations,
            commands::annotation::save_chart_annotation,
            commands::annotation::delete_chart_annotation,
            commands::data_ops::search_securities,
            commands::data_ops::get_data_health,
            commands::data_ops::sync_securities_metadata,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run trade-system-0");
}
