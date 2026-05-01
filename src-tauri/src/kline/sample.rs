use crate::error::AppResult;
use crate::kline::provider::{DailyBar, KlineProvider};
use chrono::{Datelike, Duration, NaiveDate, Weekday};

pub struct SampleKlineProvider;

impl KlineProvider for SampleKlineProvider {
    fn name(&self) -> &'static str {
        "sample_fallback"
    }

    fn fetch_daily_bars(
        &self,
        stock_code: &str,
        start_date: NaiveDate,
        end_date: NaiveDate,
    ) -> AppResult<Vec<DailyBar>> {
        let seed = stock_code.bytes().map(|byte| byte as i64).sum::<i64>() as f64;
        let mut bars = Vec::new();
        let mut current = start_date;
        let mut previous_close = 18.0 + (seed % 60.0);
        let mut index: f64 = 0.0;

        while current <= end_date {
            if is_trade_day(current) {
                let drift =
                    ((index / 17.0).sin() * 0.035) + ((index / 43.0).cos() * 0.018) + 0.0012;
                let open = previous_close * (1.0 + ((index / 11.0).sin() * 0.012));
                let close = (previous_close * (1.0 + drift)).max(1.0);
                let high = open.max(close) * (1.0 + 0.012 + ((index / 7.0).sin().abs() * 0.018));
                let low = open.min(close) * (1.0 - 0.012 - ((index / 9.0).cos().abs() * 0.014));
                let volume = 1_000_000.0 + (seed * 1_000.0) + (index.sin().abs() * 700_000.0);
                let amount = volume * close;
                bars.push(DailyBar {
                    date: current,
                    open: round2(open),
                    high: round2(high),
                    low: round2(low.max(0.01)),
                    close: round2(close),
                    pre_close: Some(round2(previous_close)),
                    volume: round2(volume),
                    amount: round2(amount),
                    turnover: Some(round2(1.0 + (index % 8.0) * 0.18)),
                    adj_factor: Some(1.0),
                    source: self.name().to_string(),
                });
                previous_close = close;
                index += 1.0;
            }
            current += Duration::days(1);
        }

        Ok(bars)
    }
}

fn is_trade_day(date: NaiveDate) -> bool {
    !matches!(date.weekday(), Weekday::Sat | Weekday::Sun)
}

fn round2(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

#[cfg(test)]
mod tests {
    use super::SampleKlineProvider;
    use crate::kline::provider::KlineProvider;
    use chrono::NaiveDate;

    #[test]
    fn sample_provider_skips_weekends() {
        let provider = SampleKlineProvider;
        let bars = provider
            .fetch_daily_bars(
                "002261",
                NaiveDate::from_ymd_opt(2026, 5, 1).unwrap(),
                NaiveDate::from_ymd_opt(2026, 5, 4).unwrap(),
            )
            .unwrap();
        assert_eq!(bars.len(), 2);
        assert_eq!(bars[0].date.to_string(), "2026-05-01");
        assert_eq!(bars[1].date.to_string(), "2026-05-04");
    }
}
