use crate::error::{AppError, AppResult};
use crate::models::{ChartAnnotation, OkResult, SaveChartAnnotationInput};
use crate::services::common::{new_id, now_iso};
use rusqlite::{params, Connection};

pub fn list_chart_annotations(
    conn: &Connection,
    stock_code: &str,
    trade_system_version_id: Option<String>,
) -> AppResult<Vec<ChartAnnotation>> {
    let mut values = Vec::new();
    if let Some(version_id) = trade_system_version_id {
        let mut stmt = conn.prepare(
            r#"
            select id, stock_code, trade_system_version_id, review_id, source, annotation_type,
                   payload_json, created_at, updated_at
              from chart_annotations
             where stock_code = ?1 and (trade_system_version_id is null or trade_system_version_id = ?2)
             order by created_at asc
            "#,
        )?;
        let rows = stmt.query_map(params![stock_code, version_id], annotation_from_row)?;
        for row in rows {
            values.push(row?);
        }
    } else {
        let mut stmt = conn.prepare(
            r#"
            select id, stock_code, trade_system_version_id, review_id, source, annotation_type,
                   payload_json, created_at, updated_at
              from chart_annotations
             where stock_code = ?1
             order by created_at asc
            "#,
        )?;
        let rows = stmt.query_map(params![stock_code], annotation_from_row)?;
        for row in rows {
            values.push(row?);
        }
    }
    Ok(values)
}

pub fn save_chart_annotation(
    conn: &Connection,
    input: SaveChartAnnotationInput,
) -> AppResult<ChartAnnotation> {
    if !matches!(input.annotation_type.as_str(), "horizontal_line" | "ray") {
        return Err(AppError::new(
            "invalid_annotation",
            "annotation_type 只允许 horizontal_line 或 ray",
            true,
        ));
    }
    let id = input.id.unwrap_or_else(|| new_id("ann"));
    let now = now_iso();
    let source = input.source.unwrap_or_else(|| "user".to_string());
    conn.execute(
        r#"
        insert into chart_annotations
          (id, stock_code, trade_system_version_id, review_id, source, annotation_type,
           payload_json, created_at, updated_at)
        values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
        on conflict(id) do update set
          stock_code = excluded.stock_code,
          trade_system_version_id = excluded.trade_system_version_id,
          review_id = excluded.review_id,
          source = excluded.source,
          annotation_type = excluded.annotation_type,
          payload_json = excluded.payload_json,
          updated_at = excluded.updated_at
        "#,
        params![
            id,
            input.stock_code,
            input.trade_system_version_id,
            input.review_id,
            source,
            input.annotation_type,
            serde_json::to_string(&input.payload)?,
            now
        ],
    )?;
    get_annotation(conn, &id)
}

pub fn delete_chart_annotation(conn: &Connection, annotation_id: &str) -> AppResult<OkResult> {
    conn.execute(
        "delete from chart_annotations where id = ?1",
        params![annotation_id],
    )?;
    Ok(OkResult { ok: true })
}

fn get_annotation(conn: &Connection, annotation_id: &str) -> AppResult<ChartAnnotation> {
    conn.query_row(
        r#"
        select id, stock_code, trade_system_version_id, review_id, source, annotation_type,
               payload_json, created_at, updated_at
          from chart_annotations
         where id = ?1
        "#,
        params![annotation_id],
        annotation_from_row,
    )
    .map_err(Into::into)
}

fn annotation_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ChartAnnotation> {
    let payload_json: String = row.get(6)?;
    Ok(ChartAnnotation {
        id: row.get(0)?,
        stock_code: row.get(1)?,
        trade_system_version_id: row.get(2)?,
        review_id: row.get(3)?,
        source: row.get(4)?,
        annotation_type: row.get(5)?,
        payload: serde_json::from_str(&payload_json).unwrap_or_else(|_| serde_json::json!({})),
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}
