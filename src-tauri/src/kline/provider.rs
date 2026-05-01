use crate::error::AppResult;
use chrono::NaiveDate;

#[derive(Debug, Clone)]
pub struct DailyBar {
    pub date: NaiveDate,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub pre_close: Option<f64>,
    pub volume: f64,
    pub amount: f64,
    pub turnover: Option<f64>,
    pub adj_factor: Option<f64>,
    pub change: Option<f64>,
    pub change_pct: Option<f64>,
    pub amplitude: Option<f64>,
    pub source: String,
}

pub trait KlineProvider {
    fn name(&self) -> &'static str;
    fn fetch_daily_bars(
        &self,
        stock_code: &str,
        start_date: NaiveDate,
        end_date: NaiveDate,
    ) -> AppResult<Vec<DailyBar>>;
}
