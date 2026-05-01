use crate::error::AppResult;
use crate::models::MaterialRecord;
use crate::services::common::{new_id, now_iso};
use rusqlite::{params, Connection};
use std::path::{Path, PathBuf};

pub fn import_material(
    conn: &Connection,
    app_dir: &Path,
    trade_system_id: Option<String>,
    file_path: String,
) -> AppResult<MaterialRecord> {
    let source = PathBuf::from(&file_path);
    let file_name = source
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("material")
        .to_string();
    let material_id = new_id("mat");
    let extension = source
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_lowercase();
    let target = app_dir
        .join("materials")
        .join(format!("{}_{}", material_id, sanitize_file_name(&file_name)));
    std::fs::copy(&source, &target)?;

    let (mime_type, extracted_text, parse_status, parse_error) = match extension.as_str() {
        "md" | "markdown" => (
            Some("text/markdown".to_string()),
            std::fs::read_to_string(&target).ok(),
            "ok".to_string(),
            None,
        ),
        "txt" => (
            Some("text/plain".to_string()),
            std::fs::read_to_string(&target).ok(),
            "ok".to_string(),
            None,
        ),
        "pdf" => {
            let bytes = std::fs::read(&target)?;
            match pdf_extract::extract_text_from_mem(&bytes) {
                Ok(text) if !text.trim().is_empty() => {
                    (Some("application/pdf".to_string()), Some(text), "ok".to_string(), None)
                }
                Ok(_) => (
                    Some("application/pdf".to_string()),
                    None,
                    "failed".to_string(),
                    Some("PDF 没有可提取文本，扫描件 OCR 属于后续能力".to_string()),
                ),
                Err(error) => (
                    Some("application/pdf".to_string()),
                    None,
                    "failed".to_string(),
                    Some(error.to_string()),
                ),
            }
        }
        _ => (
            None,
            None,
            "failed".to_string(),
            Some("MVP 仅支持 .md、.txt 和可提取文本 PDF".to_string()),
        ),
    };

    let created_at = now_iso();
    conn.execute(
        r#"
        insert into materials
          (id, trade_system_id, file_name, file_path, mime_type, extracted_text, parse_status, parse_error, created_at)
        values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        "#,
        params![
            material_id,
            trade_system_id,
            file_name,
            target.to_string_lossy().to_string(),
            mime_type,
            extracted_text,
            parse_status,
            parse_error,
            created_at
        ],
    )?;

    Ok(MaterialRecord {
        id: material_id,
        trade_system_id,
        file_name,
        file_path: target.to_string_lossy().to_string(),
        mime_type,
        extracted_text,
        parse_status,
        parse_error,
        created_at,
    })
}

fn sanitize_file_name(name: &str) -> String {
    name.chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_') {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

