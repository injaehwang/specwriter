mod types;
mod scanner;
mod parser;
mod detect;

use std::path::PathBuf;
use std::time::Instant;
use clap::Parser as ClapParser;
use rayon::prelude::*;

use types::*;
use scanner::scan_files;
use parser::parse_file;
use detect::{detect_framework, extract_routes};

#[derive(ClapParser)]
#[command(name = "specwriter-core", about = "Fast project analyzer")]
struct Args {
    /// Project root path
    #[arg(default_value = ".")]
    path: String,

    /// Output format: json (default), summary
    #[arg(short, long, default_value = "json")]
    format: String,
}

fn main() {
    let args = Args::parse();
    let root = PathBuf::from(&args.path).canonicalize().unwrap_or_else(|_| PathBuf::from(&args.path));
    let start = Instant::now();

    // 1. Detect framework
    let framework = detect_framework(&root);

    // 2. Scan files
    let files = scan_files(&root);

    // 3. Parse all files in parallel using rayon
    let parse_results: Vec<(String, Vec<ComponentInfo>, bool)> = files
        .par_iter()
        .map(|file| {
            let full_path = root.join(&file.path);
            match std::fs::read_to_string(&full_path) {
                Ok(content) => {
                    let components = parse_file(&file.path, &content);
                    (file.path.clone(), components, false)
                }
                Err(_) => (file.path.clone(), vec![], true),
            }
        })
        .collect();

    let mut all_components: Vec<ComponentInfo> = Vec::new();
    let mut parse_errors = 0;
    for (path, components, is_error) in parse_results {
        if is_error {
            parse_errors += 1;
        }
        for mut comp in components {
            comp.file_path = path.clone();
            all_components.push(comp);
        }
    }

    // 4. Extract routes
    let routes = extract_routes(&root, &framework.id);

    // 5. Build directory info
    let mut dir_map: std::collections::HashMap<String, (usize, usize)> = std::collections::HashMap::new();
    for comp in &all_components {
        let dir = comp.file_path.rsplitn(2, '/').nth(1).unwrap_or(".");
        let entry = dir_map.entry(dir.to_string()).or_insert((0, 0));
        entry.1 += 1;
    }
    for file in &files {
        let dir = file.path.rsplitn(2, '/').nth(1).unwrap_or(".");
        let entry = dir_map.entry(dir.to_string()).or_insert((0, 0));
        entry.0 += 1;
    }

    let directories: Vec<DirectoryInfo> = dir_map.into_iter()
        .map(|(path, (file_count, component_count))| DirectoryInfo {
            path,
            role: String::new(),
            file_count,
            component_count,
        })
        .collect();

    let duration = start.elapsed();

    let snapshot = Snapshot {
        root: root.to_string_lossy().to_string(),
        files,
        components: all_components,
        routes,
        directories,
        framework,
        stats: ScanStats {
            total_files: 0,
            scanned_files: 0,
            components_found: 0,
            parse_errors,
            duration_ms: duration.as_millis(),
        },
    };

    let stats = ScanStats {
        total_files: snapshot.files.len(),
        scanned_files: snapshot.files.len(),
        components_found: snapshot.components.len(),
        parse_errors,
        duration_ms: duration.as_millis(),
    };

    let mut snapshot = snapshot;
    snapshot.stats = stats;

    match args.format.as_str() {
        "summary" => {
            eprintln!("  Framework:  {} ({:.0}%)", snapshot.framework.id, snapshot.framework.confidence * 100.0);
            eprintln!("  Files:      {}", snapshot.stats.total_files);
            eprintln!("  Components: {}", snapshot.stats.components_found);
            eprintln!("  Routes:     {}", snapshot.routes.len());
            eprintln!("  Errors:     {}", snapshot.stats.parse_errors);
            eprintln!("  Duration:   {}ms", snapshot.stats.duration_ms);
            println!("{}", serde_json::to_string(&snapshot).unwrap());
        }
        _ => {
            println!("{}", serde_json::to_string(&snapshot).unwrap());
        }
    }
}
