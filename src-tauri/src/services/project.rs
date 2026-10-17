use crate::database::Database;
use crate::error::AppError;
use crate::models::{CreateProjectInput, Project, UpdateProjectInput};

/// 项目服务（薄包装；业务逻辑就两条：列出 + CRUD）。
pub struct ProjectService;

impl ProjectService {
    pub fn list(db: &Database, include_archived: bool) -> Result<Vec<Project>, AppError> {
        db.list_projects(include_archived)
    }

    pub fn get(db: &Database, id: i64) -> Result<Option<Project>, AppError> {
        db.get_project(id)
    }

    pub fn create(db: &Database, input: CreateProjectInput) -> Result<i64, AppError> {
        db.create_project(input)
    }

    pub fn update(
        db: &Database,
        id: i64,
        input: UpdateProjectInput,
    ) -> Result<(), AppError> {
        let ok = db.update_project(id, input)?;
        if !ok {
            return Err(AppError::NotFound(format!("项目 {} 不存在或无变更", id)));
        }
        Ok(())
    }

    pub fn delete(db: &Database, id: i64) -> Result<(), AppError> {
        let ok = db.delete_project(id)?;
        if !ok {
            return Err(AppError::NotFound(format!("项目 {} 不存在", id)));
        }
        Ok(())
    }
}
