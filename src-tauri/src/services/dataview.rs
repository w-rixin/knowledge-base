//! Dataview Service（v0.1 最简）：5 个固定模板的薄包装。

use crate::database::Database;
use crate::error::AppError;
use crate::models::DataviewRow;

pub struct DataviewService;

impl DataviewService {
    pub fn recent_notes(db: &Database, limit: Option<i64>) -> Result<Vec<DataviewRow>, AppError> {
        db.dataview_recent_notes(limit)
    }

    pub fn notes_by_tag(
        db: &Database,
        tag: &str,
        limit: Option<i64>,
    ) -> Result<Vec<DataviewRow>, AppError> {
        let trimmed = tag.trim();
        if trimmed.is_empty() {
            return Err(AppError::InvalidInput("标签名不能为空".into()));
        }
        db.dataview_notes_by_tag(trimmed, limit)
    }

    pub fn notes_by_folder(
        db: &Database,
        folder_id: i64,
        limit: Option<i64>,
    ) -> Result<Vec<DataviewRow>, AppError> {
        db.dataview_notes_by_folder(folder_id, limit)
    }

    pub fn pending_tasks(db: &Database, limit: Option<i64>) -> Result<Vec<DataviewRow>, AppError> {
        db.dataview_pending_tasks(limit)
    }

    pub fn tasks_by_project(
        db: &Database,
        project_id: i64,
        limit: Option<i64>,
    ) -> Result<Vec<DataviewRow>, AppError> {
        db.dataview_tasks_by_project(project_id, limit)
    }
}
