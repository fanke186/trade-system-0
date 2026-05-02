#!/usr/bin/env python3
"""
TickFlow K-line sync script.
Syncs A-share stocks and indices K-line data to Parquet files.
Can be run standalone or triggered by the Tauri app.

Usage:
  python3 scripts/sync_kline.py --mode incremental
  python3 scripts/sync_kline.py --symbols 600519,000001 --periods 1d --mode full
"""

import argparse
import json
import sys
import time
from datetime import datetime
from pathlib import Path

import pandas as pd
from tickflow import TickFlow

PERIODS = ["1d", "1w", "1M", "1Q", "1Y"]
MAX_RETRIES = 5
RETRY_BASE_DELAY = 2  # seconds


def emit(event_type, **kwargs):
    """Write JSON progress line to stdout."""
    line = json.dumps(
        {"type": event_type, "timestamp": datetime.now().isoformat(), **kwargs},
        ensure_ascii=False,
        default=str,
    )
    sys.stdout.write(line + "\n")
    sys.stdout.flush()


def get_all_symbols(tf):
    """Fetch all A-share stocks and indices from TickFlow."""
    emit("phase", phase="discovery", message="获取全 A 股标的列表...")

    symbols = []

    for exchange in ["SH", "SZ", "BJ"]:
        for inst_type, label in [("stock", "股票"), ("index", "指数")]:
            try:
                instruments = tf.exchanges.get_instruments(exchange, inst_type)
                count = len(instruments)
                if count > 0:
                    symbols.extend([inst.symbol for inst in instruments])
                emit(
                    "phase",
                    phase="discovery",
                    message=f"{exchange} {label}: {count} 只",
                )
            except Exception as e:
                emit(
                    "error",
                    exchange=exchange,
                    type=inst_type,
                    message=str(e)[:200],
                    fatal=False,
                )

    unique = sorted(set(symbols))
    emit("phase", phase="discovery", message=f"共 {len(unique)} 个标的（去重后）")
    return unique


def resolve_symbols(args_symbols, tf):
    """Resolve symbol list from args or full discovery."""
    if args_symbols:
        raw = [s.strip() for s in args_symbols.split(",") if s.strip()]
        symbols = []
        for code in raw:
            if "." in code:
                symbols.append(code)
            elif code.startswith(("6", "5", "9")):
                symbols.append(f"{code}.SH")
            else:
                symbols.append(f"{code}.SZ")
        emit("phase", phase="init", message=f"指定标的: {len(symbols)} 个")
        return symbols
    else:
        return get_all_symbols(tf)


def dict_to_dataframe(data: dict) -> pd.DataFrame:
    """Convert TickFlow columnar batch response to DataFrame."""
    if not data:
        return pd.DataFrame()

    frames = []
    for symbol, kd in data.items():
        if not kd or "timestamp" not in kd:
            continue
        n = len(kd["timestamp"])
        if n == 0:
            continue
        df = pd.DataFrame(
            {
                "symbol": [symbol] * n,
                "trade_date": pd.to_datetime(kd["timestamp"], unit="ms"),
                "open": kd.get("open", [None] * n),
                "high": kd.get("high", [None] * n),
                "low": kd.get("low", [None] * n),
                "close": kd.get("close", [None] * n),
                "volume": kd.get("volume", [0] * n),
                "amount": kd.get("amount", [0] * n),
            }
        )
        frames.append(df)

    if not frames:
        return pd.DataFrame()
    return pd.concat(frames, ignore_index=True)


def fetch_with_retry(tf, symbols, period, count, start_time, end_time):
    """Fetch klines with exponential backoff retry. Returns DataFrame."""
    last_error = None
    for attempt in range(MAX_RETRIES):
        try:
            result = tf.klines.batch(
                symbols=symbols,
                period=period,
                count=count,
                start_time=start_time,
                end_time=end_time,
                adjust="forward_additive",
                show_progress=False,
                max_workers=5,
            )
            return dict_to_dataframe(result)
        except Exception as e:
            last_error = e
            msg = str(e)[:200]
            if attempt < MAX_RETRIES - 1:
                delay = RETRY_BASE_DELAY * (2**attempt)
                emit(
                    "retry",
                    attempt=attempt + 1,
                    maxRetries=MAX_RETRIES,
                    delay=delay,
                    message=msg,
                )
                time.sleep(delay)
            else:
                emit(
                    "error",
                    message=f"重试 {MAX_RETRIES} 次后失败: {msg}",
                    fatal=False,
                )

    return pd.DataFrame()


def compute_derived_fields(df):
    """Compute pre_close, change, change_pct, amplitude per symbol group."""
    if df.empty:
        return df

    df = df.copy()
    df["trade_date"] = pd.to_datetime(df["trade_date"]).dt.strftime("%Y-%m-%d")
    df = df.sort_values(["symbol", "trade_date"])

    # pre_close = previous bar's close within each symbol group
    df["pre_close"] = df.groupby("symbol")["close"].shift(1)

    # Derived fields
    mask = df["pre_close"].notna() & (df["pre_close"] != 0)
    df.loc[mask, "change"] = df.loc[mask, "close"] - df.loc[mask, "pre_close"]
    df.loc[mask, "change_pct"] = (
        df.loc[mask, "close"] / df.loc[mask, "pre_close"] - 1
    ) * 100
    df.loc[mask, "amplitude"] = (
        (df.loc[mask, "high"] - df.loc[mask, "low"]) / df.loc[mask, "pre_close"]
    ) * 100

    df["adj_factor"] = 1.0
    df["source"] = "tickflow"
    df["turnover"] = None

    columns = [
        "symbol",
        "trade_date",
        "open",
        "high",
        "low",
        "close",
        "pre_close",
        "volume",
        "amount",
        "turnover",
        "adj_factor",
        "change",
        "change_pct",
        "amplitude",
        "source",
    ]
    existing = [c for c in columns if c in df.columns]
    return df[existing]


def save_parquet(df, data_dir, period):
    """Save period data to Parquet."""
    out_dir = Path(data_dir) / period
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "data.parquet"
    df.to_parquet(out_path, index=False)
    return len(df)


def sync_period(tf, symbols, period, data_dir, mode, batch_size=100):
    """Sync a single period for all symbols."""
    count = 10000 if mode == "full" else 10
    all_dfs = []
    total_batches = (len(symbols) + batch_size - 1) // batch_size

    emit("phase", phase="sync", period=period, totalBatches=total_batches)

    for i in range(0, len(symbols), batch_size):
        batch_symbols = symbols[i : i + batch_size]
        batch_num = i // batch_size + 1

        emit(
            "progress",
            period=period,
            batch=batch_num,
            totalBatches=total_batches,
            percent=round(batch_num / total_batches * 100),
        )

        df = fetch_with_retry(tf, batch_symbols, period, count, None, None)

        if not df.empty:
            df = compute_derived_fields(df)
            all_dfs.append(df)

    if all_dfs:
        combined = pd.concat(all_dfs, ignore_index=True)
        rows = save_parquet(combined, data_dir, period)
        emit(
            "progress",
            period=period,
            batch=total_batches,
            totalBatches=total_batches,
            percent=100,
        )
        return rows
    return 0


def main():
    parser = argparse.ArgumentParser(description="TickFlow K-line sync")
    parser.add_argument(
        "--symbols",
        type=str,
        default=None,
        help="Stock codes, comma-separated (e.g. 600519,000001)",
    )
    parser.add_argument(
        "--periods",
        type=str,
        default="1d,1w,1M,1Q,1Y",
        help="Periods to sync, comma-separated",
    )
    parser.add_argument(
        "--mode",
        type=str,
        default="incremental",
        choices=["full", "incremental"],
        help="Sync mode",
    )
    parser.add_argument(
        "--data-dir",
        type=str,
        default="./data/klines",
        help="Output directory for Parquet files",
    )

    args = parser.parse_args()
    periods = [p.strip() for p in args.periods.split(",")]

    emit(
        "phase",
        phase="init",
        message=f"TickFlow K-line sync starting, mode={args.mode}",
    )

    try:
        tf = TickFlow.free()
    except Exception as e:
        emit("error", message=f"TickFlow 初始化失败: {e}", fatal=True)
        sys.exit(1)

    symbols = resolve_symbols(args.symbols, tf)
    if not symbols:
        emit("error", message="未找到任何标的", fatal=True)
        sys.exit(1)

    emit(
        "phase",
        phase="init",
        message=f"共 {len(symbols)} 个标的，周期: {periods}",
    )

    period_results = {}
    total_bars = 0
    for period in periods:
        rows = sync_period(tf, symbols, period, args.data_dir, args.mode)
        period_results[period] = rows
        total_bars += rows

    emit(
        "complete",
        periods=period_results,
        totalBars=total_bars,
        totalSymbols=len(symbols),
    )

    return 0


if __name__ == "__main__":
    sys.exit(main())
