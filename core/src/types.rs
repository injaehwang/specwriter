use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct Snapshot {
    pub root: String,
    pub files: Vec<FileInfo>,
    pub components: Vec<ComponentInfo>,
    pub routes: Vec<RouteInfo>,
    pub directories: Vec<DirectoryInfo>,
    pub framework: FrameworkDetection,
    pub stats: ScanStats,
}

#[derive(Debug, Serialize)]
pub struct ScanStats {
    pub total_files: usize,
    pub scanned_files: usize,
    pub components_found: usize,
    pub parse_errors: usize,
    pub duration_ms: u128,
}

#[derive(Debug, Serialize)]
pub struct FrameworkDetection {
    pub id: String,
    pub confidence: f64,
    pub evidence: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct FileInfo {
    pub path: String,
    pub extension: String,
    pub size: u64,
}

#[derive(Debug, Serialize)]
pub struct ComponentInfo {
    pub name: String,
    pub file_path: String,
    pub component_type: String,
    pub export_type: String,
    pub props: Vec<PropInfo>,
    pub state: Vec<StateInfo>,
    pub children: Vec<String>,
    pub imports: Vec<ImportInfo>,
    pub is_client: bool,
    pub is_server: bool,
    pub line_start: usize,
    pub line_end: usize,
    pub description: String,
}

#[derive(Debug, Serialize)]
pub struct PropInfo {
    pub name: String,
    pub prop_type: String,
    pub required: bool,
    pub default_value: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct StateInfo {
    pub name: String,
    pub state_type: String,
    pub source: String,
    pub setter: Option<String>,
    pub initial_value: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct ImportInfo {
    pub source: String,
    pub specifiers: Vec<String>,
    pub is_default: bool,
    pub is_type: bool,
}

#[derive(Debug, Serialize)]
pub struct RouteInfo {
    pub path: String,
    pub file_path: String,
    pub name: String,
    pub is_api: bool,
    pub is_dynamic: bool,
    pub params: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct DirectoryInfo {
    pub path: String,
    pub role: String,
    pub file_count: usize,
    pub component_count: usize,
}
