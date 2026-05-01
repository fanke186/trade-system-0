use crate::error::{AppError, AppResult};
use crate::kline::provider::{DailyBar, KlineProvider};
use chrono::{Duration as ChronoDuration, NaiveDate};
use reqwest::blocking::Client;
use std::collections::BTreeMap;
use std::time::Duration;

const TENCENT_WINDOW_LIMIT: usize = 2000;
const TENCENT_MAX_WINDOWS: usize = 20;

pub struct EastmoneyDailyBarProvider {
    client: Client,
}

impl EastmoneyDailyBarProvider {
    pub fn new() -> AppResult<Self> {
        Ok(Self {
            client: Client::builder()
                .timeout(Duration::from_secs(12))
                .user_agent("Mozilla/5.0 trade-system-0/0.1")
                .build()?,
        })
    }
}

impl KlineProvider for EastmoneyDailyBarProvider {
    fn name(&self) -> &'static str {
        "eastmoney"
    }

    fn fetch_daily_bars(
        &self,
        stock_code: &str,
        start_date: NaiveDate,
        end_date: NaiveDate,
    ) -> AppResult<Vec<DailyBar>> {
        let url = format!(
            "https://push2his.eastmoney.com/api/qt/stock/kline/get?secid={}.{}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&lmt=1000000&beg={}&end={}",
            eastmoney_market(stock_code),
            stock_code,
            start_date.format("%Y%m%d"),
            end_date.format("%Y%m%d")
        );
        let value: serde_json::Value = self
            .client
            .get(url)
            .header("Accept", "application/json,text/plain,*/*")
            .header("Referer", "https://quote.eastmoney.com/")
            .send()?
            .error_for_status()?
            .json()?;
        let klines = value
            .pointer("/data/klines")
            .and_then(|node| node.as_array())
            .ok_or_else(|| {
                AppError::with_detail(
                    "kline_sync_failed",
                    "Eastmoney 响应缺少 data.klines",
                    true,
                    value.clone(),
                )
            })?;

        let mut bars = Vec::new();
        for item in klines {
            let Some(line) = item.as_str() else {
                continue;
            };
            let parts: Vec<&str> = line.split(',').collect();
            if parts.len() < 7 {
                continue;
            }
            let date = parse_date(parts[0])?;
            if date < start_date || date > end_date {
                continue;
            }
            bars.push(DailyBar {
                date,
                open: parse_f64(parts[1])?,
                close: parse_f64(parts[2])?,
                high: parse_f64(parts[3])?,
                low: parse_f64(parts[4])?,
                volume: parse_f64(parts[5])?,
                amount: parse_f64(parts[6])?,
                pre_close: None,
                turnover: parts.get(10).and_then(|value| value.parse::<f64>().ok()),
                adj_factor: Some(1.0),
                change: parts.get(9).and_then(|value| value.parse::<f64>().ok()),
                change_pct: parts.get(8).and_then(|value| value.parse::<f64>().ok()),
                amplitude: parts.get(7).and_then(|value| value.parse::<f64>().ok()),
                source: self.name().to_string(),
            });
        }
        Ok(bars)
    }
}

pub struct TencentDailyBarProvider {
    client: Client,
}

impl TencentDailyBarProvider {
    pub fn new() -> AppResult<Self> {
        Ok(Self {
            client: Client::builder()
                .timeout(Duration::from_secs(12))
                .user_agent("Mozilla/5.0 trade-system-0/0.1")
                .build()?,
        })
    }

    fn fetch_window(
        &self,
        market_code: &str,
        start_date: NaiveDate,
        end_date: NaiveDate,
    ) -> AppResult<Vec<DailyBar>> {
        let url = format!(
            "https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param={},day,{},{},{}",
            market_code,
            start_date.format("%Y-%m-%d"),
            end_date.format("%Y-%m-%d"),
            TENCENT_WINDOW_LIMIT
        );
        let value: serde_json::Value = self
            .client
            .get(url)
            .header("Accept", "application/json,text/plain,*/*")
            .header("Referer", "https://gu.qq.com/")
            .send()?
            .error_for_status()?
            .json()?;
        let rows = value
            .pointer(&format!("/data/{}/day", market_code))
            .and_then(|node| node.as_array())
            .ok_or_else(|| {
                AppError::with_detail(
                    "kline_sync_failed",
                    "Tencent 响应缺少 day",
                    true,
                    value.clone(),
                )
            })?;

        let mut bars = Vec::new();
        for row in rows {
            let Some(row) = row.as_array() else {
                continue;
            };
            if row.len() < 6 {
                continue;
            }
            let date = parse_date(row[0].as_str().unwrap_or_default())?;
            if date < start_date || date > end_date {
                continue;
            }
            let open = json_str_f64(&row[1])?;
            let close = json_str_f64(&row[2])?;
            let high = json_str_f64(&row[3])?;
            let low = json_str_f64(&row[4])?;
            let volume = json_str_f64(&row[5])? * 100.0;
            bars.push(DailyBar {
                date,
                open,
                high,
                low,
                close,
                pre_close: None,
                volume,
                amount: volume * close,
                turnover: None,
                adj_factor: Some(1.0),
                change: None,
                change_pct: None,
                amplitude: None,
                source: self.name().to_string(),
            });
        }
        Ok(bars)
    }
}

impl KlineProvider for TencentDailyBarProvider {
    fn name(&self) -> &'static str {
        "tencent"
    }

    fn fetch_daily_bars(
        &self,
        stock_code: &str,
        start_date: NaiveDate,
        end_date: NaiveDate,
    ) -> AppResult<Vec<DailyBar>> {
        let market_code = tencent_market_code(stock_code);
        let mut bars_by_date = BTreeMap::new();
        let mut cursor_end = end_date;

        for _ in 0..TENCENT_MAX_WINDOWS {
            if cursor_end < start_date {
                break;
            }

            let bars = self.fetch_window(&market_code, start_date, cursor_end)?;
            if bars.is_empty() {
                break;
            }

            let first_date = bars[0].date;
            let row_count = bars.len();
            for bar in bars {
                bars_by_date.insert(bar.date, bar);
            }

            if row_count < TENCENT_WINDOW_LIMIT || first_date <= start_date {
                break;
            }
            let Some(next_end) = first_date.checked_sub_signed(ChronoDuration::days(1)) else {
                break;
            };
            cursor_end = next_end;
        }

        Ok(bars_by_date.into_values().collect())
    }
}

fn eastmoney_market(stock_code: &str) -> i32 {
    if stock_code.starts_with('6') || stock_code.starts_with('5') || stock_code.starts_with('9') {
        1
    } else {
        0
    }
}

fn tencent_market_code(stock_code: &str) -> String {
    if stock_code.starts_with('6') || stock_code.starts_with('5') || stock_code.starts_with('9') {
        format!("sh{}", stock_code)
    } else {
        format!("sz{}", stock_code)
    }
}

fn parse_date(value: &str) -> AppResult<NaiveDate> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d").map_err(|error| {
        AppError::with_detail(
            "kline_sync_failed",
            "K 线日期解析失败",
            true,
            serde_json::json!({ "value": value, "error": error.to_string() }),
        )
    })
}

fn parse_f64(value: &str) -> AppResult<f64> {
    value.parse::<f64>().map_err(|error| {
        AppError::with_detail(
            "kline_sync_failed",
            "K 线数值解析失败",
            true,
            serde_json::json!({ "value": value, "error": error.to_string() }),
        )
    })
}

fn json_str_f64(value: &serde_json::Value) -> AppResult<f64> {
    if let Some(number) = value.as_f64() {
        return Ok(number);
    }
    parse_f64(value.as_str().unwrap_or_default())
}
