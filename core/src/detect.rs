use std::path::Path;
use std::fs;
use crate::types::{FrameworkDetection, RouteInfo};

pub fn detect_framework(root: &Path) -> FrameworkDetection {
    let mut best = FrameworkDetection {
        id: "generic".to_string(),
        confidence: 0.0,
        evidence: vec!["No specific framework detected".to_string()],
    };

    // Read package.json
    let pkg = read_package_json(root);

    // Check dependencies
    let checks: Vec<(&str, &str, f64)> = vec![
        ("next", "nextjs", 0.9),
        ("nuxt", "nuxt", 0.9),
        ("nuxt3", "nuxt", 0.9),
        ("@sveltejs/kit", "sveltekit", 0.9),
        ("@angular/core", "angular", 0.9),
        ("vue", "vue", 0.6),
        ("@vitejs/plugin-vue", "vue", 0.8),
        ("vue-router", "vue", 0.7),
        ("@vue/cli-service", "vue", 0.8),
        ("react", "react", 0.6),
        ("react-dom", "react", 0.6),
        ("@vitejs/plugin-react", "react", 0.75),
        ("svelte", "svelte", 0.6),
    ];

    for (dep, fw, conf) in &checks {
        if pkg.contains(&format!("\"{}\"", dep)) {
            if *conf > best.confidence || (*conf == best.confidence && *fw != "generic") {
                best = FrameworkDetection {
                    id: fw.to_string(),
                    confidence: *conf,
                    evidence: vec![format!("Found \"{}\" in package.json", dep)],
                };
            }
        }
    }

    // Config file detection (higher confidence)
    let config_checks: Vec<(&[&str], &str, f64)> = vec![
        (&["next.config.js", "next.config.ts", "next.config.mjs"][..], "nextjs", 0.95),
        (&["nuxt.config.ts", "nuxt.config.js"][..], "nuxt", 0.95),
        (&["svelte.config.js", "svelte.config.ts"][..], "sveltekit", 0.85),
        (&["angular.json"][..], "angular", 0.95),
        (&["vue.config.js", "vue.config.ts"][..], "vue", 0.8),
    ];

    for (files, fw, conf) in config_checks {
        for file in files {
            if root.join(file).exists() && conf > best.confidence {
                best = FrameworkDetection {
                    id: fw.to_string(),
                    confidence: conf,
                    evidence: vec![format!("Found config file: {}", file)],
                };
                break;
            }
        }
    }

    // Check vite.config for Vue/React plugin
    for vite_config in &["vite.config.ts", "vite.config.js", "vite.config.mts"] {
        if let Ok(content) = fs::read_to_string(root.join(vite_config)) {
            if content.contains("plugin-vue") || content.contains("vue(") {
                if 0.85 > best.confidence {
                    best = FrameworkDetection {
                        id: "vue".to_string(),
                        confidence: 0.85,
                        evidence: vec![format!("Found Vue plugin in {}", vite_config)],
                    };
                }
            }
        }
    }

    // File pattern detection
    if root.join("app/page.tsx").exists() || root.join("app/page.jsx").exists() {
        if 0.85 > best.confidence {
            best = FrameworkDetection {
                id: "nextjs".to_string(),
                confidence: 0.85,
                evidence: vec!["Found Next.js App Router (app/page.tsx)".to_string()],
            };
        }
    }
    if root.join("src/App.vue").exists() || root.join("src/app.vue").exists() {
        if 0.75 > best.confidence {
            best = FrameworkDetection {
                id: "vue".to_string(),
                confidence: 0.75,
                evidence: vec!["Found src/App.vue".to_string()],
            };
        }
    }

    best
}

pub fn extract_routes(root: &Path, framework: &str) -> Vec<RouteInfo> {
    match framework {
        "nextjs" => extract_nextjs_routes(root),
        "nuxt" => extract_nuxt_routes(root),
        "vue" => extract_vue_routes(root),
        _ => vec![],
    }
}

fn extract_nextjs_routes(root: &Path) -> Vec<RouteInfo> {
    let mut routes = Vec::new();
    let app_dir = root.join("app");
    let src_app_dir = root.join("src/app");

    let dir = if app_dir.exists() { &app_dir } else if src_app_dir.exists() { &src_app_dir } else { return routes };

    walk_nextjs_pages(dir, dir, &mut routes);

    routes.sort_by(|a, b| a.path.cmp(&b.path));
    routes
}

fn walk_nextjs_pages(dir: &Path, root_dir: &Path, routes: &mut Vec<RouteInfo>) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk_nextjs_pages(&path, root_dir, routes);
        } else {
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            let is_page = name.starts_with("page.");
            let is_route = name.starts_with("route.");

            if !is_page && !is_route { continue; }

            let relative = path.strip_prefix(root_dir).unwrap_or(&path);
            let segments: Vec<&str> = relative.parent()
                .map(|p| p.components().map(|c| c.as_os_str().to_str().unwrap_or("")).collect())
                .unwrap_or_default();

            let route_path = format!("/{}", segments.iter()
                .filter(|s| !s.starts_with('('))
                .map(|s| {
                    if s.starts_with("[...") && s.ends_with(']') { "*".to_string() }
                    else if s.starts_with('[') && s.ends_with(']') { format!(":{}", &s[1..s.len()-1]) }
                    else { s.to_string() }
                })
                .collect::<Vec<_>>()
                .join("/"));

            let params: Vec<String> = segments.iter()
                .filter(|s| s.starts_with('[') && s.ends_with(']'))
                .map(|s| s.trim_start_matches('[').trim_start_matches("...").trim_end_matches(']').to_string())
                .collect();

            let route_name = infer_route_name(&route_path);
            routes.push(RouteInfo {
                path: if route_path == "/" { "/".to_string() } else { route_path },
                file_path: relative.to_string_lossy().replace('\\', "/"),
                name: route_name,
                is_api: is_route,
                is_dynamic: !params.is_empty(),
                params,
            });
        }
    }
}

fn extract_nuxt_routes(root: &Path) -> Vec<RouteInfo> {
    let pages_dir = root.join("pages");
    if !pages_dir.exists() { return vec![]; }

    let mut routes = Vec::new();
    walk_vue_pages(&pages_dir, &pages_dir, &mut routes);
    routes
}

fn extract_vue_routes(root: &Path) -> Vec<RouteInfo> {
    // Try to find route definitions in router files
    let mut routes = Vec::new();
    let router_dir = root.join("src/router");

    if router_dir.exists() {
        if let Ok(entries) = fs::read_dir(&router_dir) {
            for entry in entries.flatten() {
                if let Ok(content) = fs::read_to_string(entry.path()) {
                    // Simple extraction of path: "..." patterns
                    let mut pos = 0;
                    while let Some(idx) = content[pos..].find("path:") {
                        let start = pos + idx + 5;
                        let trimmed = content[start..].trim_start();
                        if let Some(source) = extract_quoted(trimmed) {
                            if source != "**" {
                                routes.push(RouteInfo {
                                    path: if source.starts_with('/') { source.clone() } else { format!("/{}", source) },
                                    file_path: entry.path().strip_prefix(root).unwrap_or(entry.path().as_path()).to_string_lossy().replace('\\', "/"),
                                    name: infer_route_name(&source),
                                    is_api: false,
                                    is_dynamic: source.contains(':'),
                                    params: vec![],
                                });
                            }
                        }
                        pos = start + 1;
                    }
                }
            }
        }
    }

    routes
}

fn walk_vue_pages(dir: &Path, root_dir: &Path, routes: &mut Vec<RouteInfo>) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk_vue_pages(&path, root_dir, routes);
        } else if path.extension().and_then(|e| e.to_str()) == Some("vue") {
            let relative = path.strip_prefix(root_dir).unwrap_or(&path);
            let mut segments: Vec<String> = relative.components()
                .map(|c| c.as_os_str().to_string_lossy().to_string())
                .collect();

            // Remove file extension from last segment
            if let Some(last) = segments.last_mut() {
                *last = last.trim_end_matches(".vue").to_string();
                if *last == "index" { segments.pop(); }
            }

            let route_path = format!("/{}", segments.join("/"));

            routes.push(RouteInfo {
                path: if route_path == "/" { "/".to_string() } else { route_path.clone() },
                file_path: format!("pages/{}", relative.to_string_lossy().replace('\\', "/")),
                name: infer_route_name(&route_path),
                is_api: false,
                is_dynamic: route_path.contains('['),
                params: vec![],
            });
        }
    }
}

fn infer_route_name(path: &str) -> String {
    if path == "/" || path.is_empty() { return "Home".to_string(); }
    let parts: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    let last = parts.last().unwrap_or(&"Home");
    if last.starts_with(':') {
        return parts.get(parts.len().saturating_sub(2)).unwrap_or(&"Dynamic").to_string();
    }
    let mut chars = last.chars();
    match chars.next() {
        Some(c) => c.to_uppercase().collect::<String>() + chars.as_str(),
        None => "Page".to_string(),
    }
}

fn read_package_json(root: &Path) -> String {
    fs::read_to_string(root.join("package.json")).unwrap_or_default()
}

fn extract_quoted(text: &str) -> Option<String> {
    for quote in ['"', '\''] {
        if text.starts_with(quote) {
            if let Some(end) = text[1..].find(quote) {
                return Some(text[1..1 + end].to_string());
            }
        }
    }
    None
}
