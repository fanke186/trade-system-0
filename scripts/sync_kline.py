#!/usr/bin/env python3
"""
TickFlow K-line synchronizer.

The Tauri app only launches this script and imports the generated Parquet files.
Progress is emitted as JSON lines on stdout so the frontend can show a live
non-blocking sync state.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Iterable

import pandas as pd
from tickflow import TickFlow

PERIODS = ("1d", "1w", "1M", "1Q", "1Y")
ADJ_MODES = ("none", "forward", "backward")
EXCHANGES = ("SH", "SZ", "BJ")
MAX_RETRIES = 5
RETRY_BASE_DELAY = 2


def emit(event_type: str, **kwargs) -> None:
    payload = {
        "type": event_type,
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        **kwargs,
    }
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, default=str) + "\n")
    sys.stdout.flush()


def chunks(items: list[str], size: int) -> Iterable[list[str]]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


def normalize_symbol(raw: str) -> str:
    raw = raw.strip().upper()
    if not raw:
        return raw
    if "." in raw:
        code, exchange = raw.split(".", 1)
        return f"{code}.{exchange}"
    if raw.startswith(("6", "5")):
        return f"{raw}.SH"
    if raw.startswith(("8", "4", "9")):
        return f"{raw}.BJ"
    return f"{raw}.SZ"


def board_for(code: str, exchange: str, stock_type: str) -> str | None:
    if stock_type == "index":
        return "指数"
    if exchange == "BJ" or code.startswith(("8", "4", "9")):
        return "北交所"
    if code.startswith("688"):
        return "科创板"
    if code.startswith(("300", "301")):
        return "创业板"
    return "主板"


def instrument_to_row(item: dict) -> dict:
    ext = item.get("ext") or {}
    symbol = item.get("symbol") or normalize_symbol(item.get("code", ""))
    code = item.get("code") or symbol.split(".")[0]
    exchange = item.get("exchange") or symbol.split(".")[-1]
    stock_type = item.get("type") or "stock"
    board = board_for(code, exchange, stock_type)
    return {
        "symbol": symbol,
        "code": code,
        "name": item.get("name") or code,
        "exchange": exchange,
        "board": board,
        "list_date": ext.get("listing_date"),
        "status": "active",
        "industry": None,
        "sub_industry": None,
        "area": None,
        "market_type": board,
        "stock_type": stock_type,
        "total_shares": ext.get("total_shares"),
        "float_shares": ext.get("float_shares"),
        "tick_size": ext.get("tick_size"),
        "limit_up": ext.get("limit_up"),
        "limit_down": ext.get("limit_down"),
    }


def discover_instruments(tf: TickFlow) -> pd.DataFrame:
    emit("phase", phase="metadata", message="获取 TickFlow 全 A 股与指数标的...")
    rows: list[dict] = []
    seen: set[str] = set()
    for exchange in EXCHANGES:
        for instrument_type in ("stock", "index"):
            try:
                items = tf.exchanges.get_instruments(exchange, instrument_type)
            except Exception as exc:
                emit(
                    "error",
                    fatal=False,
                    phase="metadata",
                    message=f"{exchange} {instrument_type} 元数据获取失败: {str(exc)[:200]}",
                )
                continue
            for item in items:
                row = instrument_to_row(item)
                if row["symbol"] in seen:
                    continue
                seen.add(row["symbol"])
                rows.append(row)
            emit(
                "phase",
                phase="metadata",
                message=f"{exchange} {instrument_type}: {len(items)}",
            )
    df = pd.DataFrame(rows)
    emit("phase", phase="metadata", message=f"元数据标的数: {len(df)}")
    return df


def save_securities(df: pd.DataFrame, data_dir: Path) -> None:
    out_dir = data_dir / "securities"
    out_dir.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out_dir / "securities.parquet", index=False)


def resolve_symbols(args_symbols: str | None, metadata: pd.DataFrame, scope: str, manifest: dict) -> list[str]:
    if args_symbols:
        return sorted({normalize_symbol(s) for s in args_symbols.split(",") if s.strip()})
    all_symbols = sorted(metadata["symbol"].dropna().astype(str).unique().tolist())
    if scope == "all":
        return all_symbols
    if scope == "incomplete":
        latest_by_symbol = manifest.get("latest_by_symbol", {})
        if not latest_by_symbol:
            return all_symbols
        latest_dates = [value for value in latest_by_symbol.values() if value]
        if not latest_dates:
            return all_symbols
        target_date = max(latest_dates)
        return [symbol for symbol in all_symbols if latest_by_symbol.get(symbol) != target_date]
    return []


def load_manifest(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_manifest(path: Path, manifest: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")


def fetch_batch(tf: TickFlow, symbols: list[str], period: str, adj: str, count: int) -> dict:
    last_error: Exception | None = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            return tf.klines.batch(
                symbols,
                period=period,
                count=count,
                adjust=adj,
                as_dataframe=True,
                show_progress=False,
                max_workers=5,
                batch_size=min(100, max(1, len(symbols))),
            )
        except Exception as exc:
            last_error = exc
            if attempt >= MAX_RETRIES:
                raise
            delay = RETRY_BASE_DELAY * (2 ** (attempt - 1))
            emit(
                "retry",
                period=period,
                adj=adj,
                attempt=attempt,
                maxRetries=MAX_RETRIES,
                delay=delay,
                message=str(exc)[:200],
            )
            time.sleep(delay)
    raise last_error or RuntimeError("TickFlow batch failed")


def normalize_batch_result(result: dict | pd.DataFrame) -> pd.DataFrame:
    if isinstance(result, pd.DataFrame):
        return result
    frames = [df for df in result.values() if isinstance(df, pd.DataFrame) and not df.empty]
    if not frames:
        return pd.DataFrame()
    return pd.concat(frames, ignore_index=True)


def enrich_bars(df: pd.DataFrame, period: str, adj: str, float_shares: dict[str, float]) -> pd.DataFrame:
    if df.empty:
        return df
    df = df.copy()
    df["symbol"] = df["symbol"].astype(str)
    df["trade_date"] = pd.to_datetime(df["trade_date"]).dt.strftime("%Y-%m-%d")
    df = df.sort_values(["symbol", "trade_date"])
    df["period"] = period
    df["adj_mode"] = adj
    df["pre_close"] = df.groupby("symbol")["close"].shift(1)
    has_prev = df["pre_close"].notna() & (df["pre_close"] != 0)
    df["change"] = None
    df["change_pct"] = None
    df["amplitude"] = None
    df.loc[has_prev, "change"] = df.loc[has_prev, "close"] - df.loc[has_prev, "pre_close"]
    df.loc[has_prev, "change_pct"] = (df.loc[has_prev, "close"] / df.loc[has_prev, "pre_close"] - 1) * 100
    df.loc[has_prev, "amplitude"] = (df.loc[has_prev, "high"] - df.loc[has_prev, "low"]) / df.loc[has_prev, "pre_close"] * 100
    df["turnover_rate"] = df.apply(
        lambda row: (row["volume"] * 100 / float_shares[row["symbol"]] * 100)
        if row["symbol"] in float_shares and float_shares[row["symbol"]]
        else None,
        axis=1,
    )
    df["source"] = "tickflow"
    return df[
        [
            "symbol",
            "period",
            "adj_mode",
            "trade_date",
            "open",
            "high",
            "low",
            "close",
            "pre_close",
            "volume",
            "amount",
            "change",
            "change_pct",
            "amplitude",
            "turnover_rate",
            "source",
        ]
    ]


def write_bars(df: pd.DataFrame, data_dir: Path, period: str, adj: str, part: int) -> int:
    if df.empty:
        return 0
    out_dir = data_dir / period / adj
    out_dir.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out_dir / f"part-{part:05d}.parquet", index=False)
    return len(df)


def sync_klines(
    tf: TickFlow,
    symbols: list[str],
    metadata: pd.DataFrame,
    data_dir: Path,
    periods: list[str],
    adjs: list[str],
    mode: str,
    batch_size: int,
) -> tuple[int, dict]:
    count = 10000 if mode == "full" else 40
    total_jobs = max(1, len(list(chunks(symbols, batch_size))) * len(periods) * len(adjs))
    completed_jobs = 0
    total_rows = 0
    manifest: dict = {"updated_at": datetime.now().isoformat(timespec="seconds"), "partitions": {}}
    float_shares = (
        metadata.dropna(subset=["float_shares"])
        .set_index("symbol")["float_shares"]
        .astype(float)
        .to_dict()
        if "float_shares" in metadata.columns
        else {}
    )

    for period in periods:
        for adj in adjs:
            part = 0
            for batch_symbols in chunks(symbols, batch_size):
                part += 1
                completed_jobs += 1
                emit(
                    "progress",
                    period=period,
                    adj=adj,
                    batch=part,
                    totalBatches=(len(symbols) + batch_size - 1) // batch_size,
                    percent=round(completed_jobs / total_jobs * 100),
                )
                try:
                    raw = fetch_batch(tf, batch_symbols, period, adj, count)
                except Exception as exc:
                    emit(
                        "error",
                        fatal=False,
                        period=period,
                        adj=adj,
                        batch=part,
                        message=f"批次失败: {str(exc)[:240]}",
                    )
                    continue
                bars = enrich_bars(normalize_batch_result(raw), period, adj, float_shares)
                rows = write_bars(bars, data_dir, period, adj, part)
                total_rows += rows
                if rows:
                    manifest["partitions"][f"{period}:{adj}:part-{part:05d}"] = {
                        "rows": rows,
                        "max_trade_date": bars["trade_date"].max(),
                    }
                    if period == "1d" and adj == "none":
                        latest = bars.groupby("symbol")["trade_date"].max().to_dict()
                        manifest.setdefault("latest_by_symbol", {}).update(latest)
    return total_rows, manifest


def parse_csv(value: str, allowed: tuple[str, ...], label: str) -> list[str]:
    values = [v.strip() for v in value.split(",") if v.strip()]
    invalid = [v for v in values if v not in allowed]
    if invalid:
        raise SystemExit(f"{label} 包含不支持的值: {','.join(invalid)}")
    return values


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync TickFlow K-line data to Parquet")
    parser.add_argument("--scope", choices=["all", "incomplete", "symbols"], default="symbols")
    parser.add_argument("--symbols", default=None, help="Comma-separated symbols/codes")
    parser.add_argument("--periods", default="1d,1w,1M,1Q,1Y")
    parser.add_argument("--adj", default="none,forward,backward")
    parser.add_argument("--mode", choices=["full", "incremental"], default="incremental")
    parser.add_argument("--data-dir", default=".data/klines/current")
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    periods = parse_csv(args.periods, PERIODS, "periods")
    adjs = parse_csv(args.adj, ADJ_MODES, "adj")
    data_dir = Path(args.data_dir)
    manifest_path = data_dir.parent / "manifest.json"
    old_manifest = load_manifest(manifest_path)

    if data_dir.exists():
        shutil.rmtree(data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)

    emit("phase", phase="init", message=f"TickFlow sync start: scope={args.scope}, mode={args.mode}")
    try:
        tf = TickFlow.free(cache_dir=str(data_dir.parent / "tickflow-cache"))
    except Exception as exc:
        emit("error", fatal=True, message=f"TickFlow 初始化失败: {exc}")
        return 1

    metadata = discover_instruments(tf)
    save_securities(metadata, data_dir)
    symbols = resolve_symbols(args.symbols, metadata, args.scope, old_manifest)
    if not symbols:
        emit("complete", totalSymbols=0, totalBars=0, periods={}, message="没有需要同步的标的")
        return 0

    total_batches = (len(symbols) + args.batch_size - 1) // args.batch_size
    emit(
        "phase",
        phase="plan",
        message=f"标的 {len(symbols)} 个，周期 {periods}，复权 {adjs}，批次/分区 {total_batches}",
        symbols=len(symbols),
        periods=periods,
        adjModes=adjs,
        totalBatches=total_batches,
    )

    if args.dry_run:
        emit("complete", dryRun=True, totalSymbols=len(symbols), totalBars=0, periods={})
        return 0

    total_rows, manifest = sync_klines(
        tf=tf,
        symbols=symbols,
        metadata=metadata,
        data_dir=data_dir,
        periods=periods,
        adjs=adjs,
        mode=args.mode,
        batch_size=args.batch_size,
    )
    manifest["symbols"] = len(symbols)
    manifest["periods"] = periods
    manifest["adj_modes"] = adjs
    save_manifest(manifest_path, manifest)
    emit("complete", totalSymbols=len(symbols), totalBars=total_rows, periods=manifest["partitions"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
