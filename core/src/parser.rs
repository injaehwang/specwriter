use std::path::Path;
use tree_sitter::{Parser, Node, Tree};
use crate::types::{ComponentInfo, PropInfo, StateInfo, ImportInfo};

pub fn parse_file(file_path: &str, content: &str) -> Vec<ComponentInfo> {
    let ext = Path::new(file_path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");

    match ext {
        "tsx" | "jsx" => parse_jsx(file_path, content, true),
        "ts" => parse_jsx(file_path, content, false),
        "js" | "mjs" | "cjs" => {
            // JS files with JSX should use TSX parser
            if content.contains("<") && has_jsx_in_text(content) {
                parse_jsx(file_path, content, true)
            } else {
                parse_jsx(file_path, content, false)
            }
        }
        "vue" => parse_vue(file_path, content),
        _ => vec![],
    }
}

fn parse_jsx(file_path: &str, content: &str, is_jsx: bool) -> Vec<ComponentInfo> {
    let mut parser = Parser::new();
    let lang = if is_jsx {
        tree_sitter_typescript::LANGUAGE_TSX.into()
    } else {
        tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into()
    };
    parser.set_language(&lang).expect("Failed to set language");

    let tree = match parser.parse(content, None) {
        Some(t) => t,
        None => return vec![],
    };

    let is_client = content.contains("\"use client\"") || content.contains("'use client'");
    let is_server = !is_client && (file_path.contains("/app/") || file_path.contains("\\app\\"));
    let imports = extract_imports(&tree, content);
    let all_state = extract_state(content);

    let mut components = Vec::new();
    let root = tree.root_node();

    // Walk all top-level declarations
    let mut cursor = root.walk();
    for child in root.children(&mut cursor) {
        match child.kind() {
            // export default function Foo() { ... }
            "export_statement" => {
                if let Some(comp) = extract_from_export(&child, content, file_path) {
                    let mut comp = comp;
                    comp.is_client = is_client;
                    comp.is_server = is_server;
                    comp.imports = imports.clone();
                    comp.state = all_state.clone();
                    components.push(comp);
                }
            }
            // function Foo() { ... } (non-exported)
            "function_declaration" => {
                if let Some(name) = get_function_name(&child, content) {
                    if name.chars().next().map_or(false, |c| c.is_uppercase()) {
                        if has_jsx_return(&child, content) {
                            let mut comp = build_component(&child, &name, "none", file_path, content);
                            comp.is_client = is_client;
                            comp.is_server = is_server;
                            comp.imports = imports.clone();
                            comp.state = all_state.clone();
                            components.push(comp);
                        }
                    }
                }
            }
            // const Foo = () => { ... }
            "lexical_declaration" => {
                extract_from_variable_decl(&child, content, file_path, &imports, &all_state, is_client, is_server, &mut components);
            }
            _ => {}
        }
    }

    // Fallback: scan text for component patterns that tree-sitter missed
    if components.is_empty() || (components.len() < 2 && content.len() > 200) {
        let found_names: std::collections::HashSet<String> = components.iter().map(|c| c.name.clone()).collect();
        let text_components = extract_components_from_text(content, file_path, &imports, &all_state, is_client, is_server);
        for comp in text_components {
            if !found_names.contains(&comp.name) {
                components.push(comp);
            }
        }
    }

    // If no components found but file is page/layout, create one
    if components.is_empty() && is_page_or_layout(file_path) {
        let name = infer_name_from_path(file_path);
        let children = extract_jsx_children(content);
        components.push(ComponentInfo {
            name,
            file_path: file_path.to_string(),
            component_type: infer_component_type(file_path, ""),
            export_type: "default".to_string(),
            props: vec![],
            state: all_state,
            children,
            imports,
            is_client,
            is_server,
            line_start: 1,
            line_end: content.lines().count(),
            description: String::new(),
        });
    }

    components
}

fn parse_vue(file_path: &str, content: &str) -> Vec<ComponentInfo> {
    let name = infer_name_from_path(file_path);

    // Extract <script> block
    let script = extract_block(content, "script");
    let template = extract_block(content, "template");

    let imports = extract_imports_from_text(&script);
    let state = extract_vue_state(&script);
    let props = extract_vue_props(&script);
    let children = extract_jsx_children(&template);

    vec![ComponentInfo {
        name,
        file_path: file_path.to_string(),
        component_type: "component".to_string(),
        export_type: "default".to_string(),
        props,
        state,
        children,
        imports,
        is_client: true,
        is_server: false,
        line_start: 1,
        line_end: content.lines().count(),
        description: String::new(),
    }]
}

// ─── Export handling ───

fn extract_from_export(node: &Node, content: &str, file_path: &str) -> Option<ComponentInfo> {
    let text = node_text(node, content);
    let mut inner_cursor = node.walk();

    for child in node.children(&mut inner_cursor) {
        match child.kind() {
            "function_declaration" => {
                if let Some(name) = get_function_name(&child, content) {
                    if has_jsx_return(&child, content) {
                        let export_type = if text.starts_with("export default") { "default" } else { "named" };
                        return Some(build_component(&child, &name, export_type, file_path, content));
                    }
                }
            }
            "lexical_declaration" => {
                return extract_from_lexical_in_export(&child, content, file_path, &text);
            }
            _ => {}
        }
    }

    // export default function() { ... } (anonymous)
    if text.contains("export default") && has_jsx_in_text(&text) {
        let name = infer_name_from_path(file_path);
        return Some(build_component(node, &name, "default", file_path, content));
    }

    None
}

fn extract_from_lexical_in_export(node: &Node, content: &str, file_path: &str, parent_text: &str) -> Option<ComponentInfo> {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if child.kind() == "variable_declarator" {
            if let Some(name_node) = child.child_by_field_name("name") {
                let name = node_text(&name_node, content);
                if name.chars().next().map_or(false, |c| c.is_uppercase()) {
                    if let Some(init) = child.child_by_field_name("value") {
                        let init_text = node_text(&init, content);
                        if has_jsx_in_text(&init_text) {
                            let export_type = if parent_text.starts_with("export default") { "default" } else { "named" };
                            return Some(build_component(&child, &name, export_type, file_path, content));
                        }
                    }
                }
            }
        }
    }
    None
}

fn extract_from_variable_decl(
    node: &Node, content: &str, file_path: &str,
    imports: &[ImportInfo], state: &[StateInfo],
    is_client: bool, is_server: bool,
    out: &mut Vec<ComponentInfo>,
) {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if child.kind() == "variable_declarator" {
            if let Some(name_node) = child.child_by_field_name("name") {
                let name = node_text(&name_node, content);
                if name.chars().next().map_or(false, |c| c.is_uppercase()) {
                    if let Some(init) = child.child_by_field_name("value") {
                        let init_text = node_text(&init, content);
                        if has_jsx_in_text(&init_text) || init_text.contains("forwardRef") || init_text.contains("memo(") {
                            let mut comp = build_component(&child, &name, "none", file_path, content);
                            comp.is_client = is_client;
                            comp.is_server = is_server;
                            comp.imports = imports.to_vec();
                            comp.state = state.to_vec();
                            out.push(comp);
                        }
                    }
                }
            }
        }
    }
}

// ─── Component builder ───

fn build_component(node: &Node, name: &str, export_type: &str, file_path: &str, content: &str) -> ComponentInfo {
    let text = node_text(node, content);
    let props = extract_props_from_text(&text);
    let children = extract_jsx_children(&text);

    ComponentInfo {
        name: name.to_string(),
        file_path: file_path.to_string(),
        component_type: infer_component_type(file_path, name),
        export_type: export_type.to_string(),
        props,
        state: vec![],
        children,
        imports: vec![],
        is_client: false,
        is_server: false,
        line_start: node.start_position().row + 1,
        line_end: node.end_position().row + 1,
        description: String::new(),
    }
}

// ─── Props extraction ───

fn extract_props_from_text(text: &str) -> Vec<PropInfo> {
    let mut props = Vec::new();

    // Match destructured params: ({ prop1, prop2 = default }: Type)
    if let Some(start) = text.find("({") {
        if let Some(end) = text[start..].find("})") {
            let params = &text[start + 2..start + end];
            for param in params.split(',') {
                let param = param.trim();
                if param.is_empty() { continue; }

                if let Some(eq_pos) = param.find('=') {
                    let name = param[..eq_pos].trim().trim_end_matches('?');
                    let default = param[eq_pos + 1..].trim();
                    if is_valid_prop_name(name) {
                        props.push(PropInfo {
                            name: name.to_string(),
                            prop_type: "unknown".to_string(),
                            required: false,
                            default_value: Some(default.to_string()),
                        });
                    }
                } else {
                    // Could be "name: rename" (destructuring rename) or just "name"
                    let name = param.split(':').next().unwrap_or(param).trim().trim_end_matches('?');
                    if is_valid_prop_name(name) {
                        props.push(PropInfo {
                            name: name.to_string(),
                            prop_type: "unknown".to_string(),
                            required: !param.contains('?'),
                            default_value: None,
                        });
                    }
                }
            }
        }
    }

    props
}

fn is_valid_prop_name(name: &str) -> bool {
    !name.is_empty() && name.chars().all(|c| c.is_alphanumeric() || c == '_')
}

// ─── Vue-specific ───

fn extract_vue_props(script: &str) -> Vec<PropInfo> {
    let mut props = Vec::new();

    // defineProps<{ name: type }>()
    if let Some(start) = script.find("defineProps<{") {
        if let Some(end) = script[start..].find("}>") {
            let body = &script[start + 13..start + end];
            for line in body.split(';') {
                let line = line.trim();
                if let Some(colon) = line.find(':') {
                    let name = line[..colon].trim().trim_end_matches('?');
                    let ptype = line[colon + 1..].trim();
                    if is_valid_prop_name(name) {
                        props.push(PropInfo {
                            name: name.to_string(),
                            prop_type: ptype.to_string(),
                            required: !line[..colon].contains('?'),
                            default_value: None,
                        });
                    }
                }
            }
        }
    }

    props
}

fn extract_vue_state(script: &str) -> Vec<StateInfo> {
    let mut state = Vec::new();
    // ref()
    for cap in regex_find_all(script, r"const\s+(\w+)\s*=\s*ref\(([^)]*)\)") {
        state.push(StateInfo {
            name: cap[0].clone(),
            state_type: "unknown".to_string(),
            source: "ref".to_string(),
            setter: None,
            initial_value: Some(cap[1].clone()),
        });
    }
    // reactive()
    for cap in regex_find_all(script, r"const\s+(\w+)\s*=\s*reactive\(") {
        state.push(StateInfo {
            name: cap[0].clone(),
            state_type: "object".to_string(),
            source: "reactive".to_string(),
            setter: None,
            initial_value: None,
        });
    }
    state
}

// ─── State extraction ───

fn extract_state(content: &str) -> Vec<StateInfo> {
    let mut state = Vec::new();

    // useState
    for cap in regex_find_all(content, r"const\s+\[(\w+),\s*(\w+)\]\s*=\s*(?:React\.)?useState\(([^)]*)\)") {
        state.push(StateInfo {
            name: cap[0].clone(),
            state_type: "unknown".to_string(),
            source: "useState".to_string(),
            setter: Some(cap[1].clone()),
            initial_value: if cap[2].is_empty() { None } else { Some(cap[2].clone()) },
        });
    }

    // useReducer
    for cap in regex_find_all(content, r"const\s+\[(\w+),\s*(\w+)\]\s*=\s*(?:React\.)?useReducer") {
        state.push(StateInfo {
            name: cap[0].clone(),
            state_type: "unknown".to_string(),
            source: "useReducer".to_string(),
            setter: Some(cap[1].clone()),
            initial_value: None,
        });
    }

    // Zustand store
    for cap in regex_find_all(content, r"const\s+(use\w+)\s*=\s*create\(") {
        state.push(StateInfo {
            name: cap[0].clone(),
            state_type: "store".to_string(),
            source: "zustand".to_string(),
            setter: None,
            initial_value: None,
        });
    }

    state
}

// ─── Import extraction ───

fn extract_imports(tree: &Tree, content: &str) -> Vec<ImportInfo> {
    let mut imports = Vec::new();
    let root = tree.root_node();
    let mut cursor = root.walk();

    for child in root.children(&mut cursor) {
        if child.kind() == "import_statement" {
            if let Some(imp) = parse_import_node(&child, content) {
                imports.push(imp);
            }
        }
    }

    imports
}

fn parse_import_node(node: &Node, content: &str) -> Option<ImportInfo> {
    let text = node_text(node, content);
    let is_type = text.contains("import type");

    // Extract source
    let source = extract_string_literal(&text)?;

    let mut specifiers = Vec::new();
    let mut is_default = false;

    // Default import: import Foo from "..."
    let before_from = text.split("from").next().unwrap_or("");
    let clean = before_from.replace("import", "").replace("type", "").trim().to_string();

    if let Some(brace_start) = clean.find('{') {
        // Named imports
        if let Some(brace_end) = clean.find('}') {
            let named = &clean[brace_start + 1..brace_end];
            for name in named.split(',') {
                let name = name.split(" as ").next().unwrap_or(name).trim();
                if !name.is_empty() {
                    specifiers.push(name.to_string());
                }
            }
        }
        // Also check for default before braces
        let before_brace = clean[..brace_start].trim().trim_end_matches(',');
        if !before_brace.is_empty() && before_brace != "*" {
            specifiers.insert(0, before_brace.to_string());
            is_default = true;
        }
    } else if !clean.is_empty() && clean != "*" && !clean.starts_with('*') {
        // Pure default import
        let name = clean.trim_end_matches(',').trim();
        if !name.is_empty() {
            specifiers.push(name.to_string());
            is_default = true;
        }
    }

    Some(ImportInfo {
        source,
        specifiers,
        is_default,
        is_type,
    })
}

fn extract_imports_from_text(text: &str) -> Vec<ImportInfo> {
    let mut imports = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if !line.starts_with("import") { continue; }
        let is_type = line.contains("import type");
        if let Some(source) = extract_string_literal(line) {
            let mut specifiers = Vec::new();
            let before_from = line.split("from").next().unwrap_or("");
            let clean = before_from.replace("import", "").replace("type", "").trim().to_string();

            if let Some(brace_start) = clean.find('{') {
                if let Some(brace_end) = clean.find('}') {
                    for name in clean[brace_start + 1..brace_end].split(',') {
                        let name = name.split(" as ").next().unwrap_or(name).trim();
                        if !name.is_empty() {
                            specifiers.push(name.to_string());
                        }
                    }
                }
            }

            imports.push(ImportInfo { source, specifiers, is_default: false, is_type });
        }
    }
    imports
}

// ─── JSX children ───

fn extract_jsx_children(text: &str) -> Vec<String> {
    let mut children = std::collections::HashSet::new();

    // <ComponentName  or <ComponentName/>
    let bytes = text.as_bytes();
    let len = bytes.len();
    let mut i = 0;
    while i < len {
        if bytes[i] == b'<' && i + 1 < len && bytes[i + 1].is_ascii_uppercase() {
            let start = i + 1;
            let mut end = start;
            while end < len && (bytes[end].is_ascii_alphanumeric() || bytes[end] == b'.' || bytes[end] == b'_') {
                end += 1;
            }
            if end > start {
                let name = &text[start..end];
                // Filter React internals
                if !matches!(name, "Fragment" | "Suspense" | "StrictMode" | "Profiler" | "React" | "Component") {
                    children.insert(name.to_string());
                }
            }
            i = end;
        } else {
            i += 1;
        }
    }

    children.into_iter().collect()
}

// ─── Helpers ───

fn node_text<'a>(node: &Node, content: &'a str) -> String {
    let start = node.start_byte();
    let end = node.end_byte().min(content.len());
    content[start..end].to_string()
}

fn get_function_name(node: &Node, content: &str) -> Option<String> {
    node.child_by_field_name("name")
        .map(|n| node_text(&n, content))
}

fn has_jsx_return(node: &Node, content: &str) -> bool {
    let text = node_text(node, content);
    has_jsx_in_text(&text)
}

fn has_jsx_in_text(text: &str) -> bool {
    // Quick check for JSX patterns
    let bytes = text.as_bytes();
    for i in 0..bytes.len().saturating_sub(1) {
        if bytes[i] == b'<' && bytes[i + 1].is_ascii_uppercase() {
            return true;
        }
    }
    text.contains("<>") || text.contains("jsx(") || text.contains("createElement(")
}

fn is_page_or_layout(file_path: &str) -> bool {
    let lower = file_path.to_lowercase();
    lower.ends_with("/page.tsx") || lower.ends_with("/page.jsx") ||
    lower.ends_with("/page.ts") || lower.ends_with("/page.js") ||
    lower.ends_with("/layout.tsx") || lower.ends_with("/layout.jsx") ||
    lower.contains("/pages/")
}

fn infer_name_from_path(file_path: &str) -> String {
    let path = file_path.replace('\\', "/");
    let parts: Vec<&str> = path.split('/').collect();
    let file_name = parts.last().unwrap_or(&"Unknown");

    if file_name.starts_with("page.") || file_name.starts_with("index.") {
        let parent = if parts.len() >= 2 { parts[parts.len() - 2] } else { "Home" };
        if parent == "app" { return "HomePage".to_string(); }
        let mut chars = parent.chars();
        return match chars.next() {
            Some(c) => c.to_uppercase().collect::<String>() + chars.as_str(),
            None => "Page".to_string(),
        };
    }
    if file_name.starts_with("layout.") {
        let parent = if parts.len() >= 2 { parts[parts.len() - 2] } else { "Root" };
        return format!("{}Layout", parent);
    }

    file_name.split('.').next().unwrap_or("Unknown").to_string()
}

fn infer_component_type(file_path: &str, name: &str) -> String {
    let p = file_path.to_lowercase().replace('\\', "/");
    if p.contains("layout.") { return "layout".to_string(); }
    if p.contains("page.") || p.contains("/pages/") { return "page".to_string(); }
    if p.contains("/hooks/") || name.starts_with("use") { return "hook".to_string(); }
    if p.contains("/providers/") || name.ends_with("Provider") { return "provider".to_string(); }
    if p.contains("/utils/") || p.contains("/helpers/") { return "utility".to_string(); }
    "component".to_string()
}

fn extract_block(content: &str, tag: &str) -> String {
    let open = format!("<{}", tag);
    let close = format!("</{}>", tag);

    if let Some(start_pos) = content.find(&open) {
        // Find the end of the opening tag
        if let Some(tag_end) = content[start_pos..].find('>') {
            let content_start = start_pos + tag_end + 1;
            if let Some(end_pos) = content[content_start..].find(&close) {
                return content[content_start..content_start + end_pos].to_string();
            }
        }
    }
    String::new()
}

fn extract_string_literal(text: &str) -> Option<String> {
    // Find 'source' or "source"
    for quote in ['"', '\''] {
        let mut in_string = false;
        let mut start = 0;
        for (i, c) in text.char_indices() {
            if c == quote {
                if in_string {
                    return Some(text[start..i].to_string());
                } else {
                    in_string = true;
                    start = i + 1;
                }
            }
        }
    }
    None
}

// Simple regex-like matching (avoid regex crate dependency)
fn regex_find_all(text: &str, pattern: &str) -> Vec<Vec<String>> {
    // Simplified: only handles patterns like r"const\s+(\w+)\s*=\s*..."
    // We use string searching instead of regex for speed
    let mut results = Vec::new();

    // Parse the pattern to extract the literal prefix and capture positions
    // For our specific patterns, we hardcode the logic

    if pattern.contains("useState") {
        // const [name, setter] = useState(init)
        let mut pos = 0;
        while let Some(idx) = text[pos..].find("useState") {
            let start = pos + idx;
            // Walk backwards to find "const ["
            if let Some(const_pos) = text[..start].rfind("const [") {
                let bracket_content = &text[const_pos + 7..start];
                if let Some(close) = bracket_content.find(']') {
                    let names: Vec<&str> = bracket_content[..close].split(',').collect();
                    if names.len() >= 2 {
                        let name = names[0].trim().to_string();
                        let setter = names[1].trim().to_string();
                        // Find init value
                        let after = &text[start + 8..]; // after "useState"
                        let init = if let Some(paren_start) = after.find('(') {
                            if let Some(paren_end) = after[paren_start..].find(')') {
                                after[paren_start + 1..paren_start + paren_end].trim().to_string()
                            } else { String::new() }
                        } else { String::new() };
                        results.push(vec![name, setter, init]);
                    }
                }
            }
            pos = start + 8;
        }
    } else if pattern.contains("useReducer") {
        let mut pos = 0;
        while let Some(idx) = text[pos..].find("useReducer") {
            let start = pos + idx;
            if let Some(const_pos) = text[..start].rfind("const [") {
                let bracket_content = &text[const_pos + 7..start];
                if let Some(close) = bracket_content.find(']') {
                    let names: Vec<&str> = bracket_content[..close].split(',').collect();
                    if names.len() >= 2 {
                        results.push(vec![
                            names[0].trim().to_string(),
                            names[1].trim().to_string(),
                        ]);
                    }
                }
            }
            pos = start + 10;
        }
    } else if pattern.contains("create(") {
        // Zustand: const useSomething = create(
        let mut pos = 0;
        while let Some(idx) = text[pos..].find("= create(") {
            let start = pos + idx;
            if let Some(const_pos) = text[..start].rfind("const ") {
                let name = text[const_pos + 6..start].trim().to_string();
                if name.starts_with("use") {
                    results.push(vec![name]);
                }
            }
            pos = start + 9;
        }
    } else if pattern.contains("ref(") {
        let mut pos = 0;
        while let Some(idx) = text[pos..].find("= ref(") {
            let start = pos + idx;
            if let Some(const_pos) = text[..start].rfind("const ") {
                let name = text[const_pos + 6..start].trim().to_string();
                let after = &text[start + 6..];
                let init = if let Some(end) = after.find(')') {
                    after[..end].trim().to_string()
                } else { String::new() };
                results.push(vec![name, init]);
            }
            pos = start + 6;
        }
    } else if pattern.contains("reactive(") {
        let mut pos = 0;
        while let Some(idx) = text[pos..].find("= reactive(") {
            let start = pos + idx;
            if let Some(const_pos) = text[..start].rfind("const ") {
                let name = text[const_pos + 6..start].trim().to_string();
                results.push(vec![name]);
            }
            pos = start + 11;
        }
    }

    results
}

// ─── Text-based fallback extraction ───

fn extract_components_from_text(
    content: &str, file_path: &str,
    imports: &[ImportInfo], state: &[StateInfo],
    is_client: bool, is_server: bool,
) -> Vec<ComponentInfo> {
    let mut components = Vec::new();
    let mut found = std::collections::HashSet::new();

    // Pattern 1: export default function Name(
    // Pattern 2: export function Name(
    // Pattern 3: export const Name = (
    // Pattern 4: function Name(
    // Pattern 5: const Name = (
    // Pattern 6: class Name extends React.Component / Component

    let lines: Vec<&str> = content.lines().collect();
    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();

        // Function components
        let patterns = [
            ("export default function ", "default"),
            ("export function ", "named"),
            ("function ", "none"),
        ];

        for (pattern, export_type) in &patterns {
            if trimmed.starts_with(pattern) {
                let rest = &trimmed[pattern.len()..];
                if let Some(name) = extract_component_name(rest) {
                    if !found.contains(&name) {
                        // Verify it returns JSX by scanning ahead
                        let block = get_block_text(&lines, i);
                        if has_jsx_in_text(&block) {
                            found.insert(name.clone());
                            components.push(ComponentInfo {
                                name: name.clone(),
                                file_path: file_path.to_string(),
                                component_type: infer_component_type(file_path, &name),
                                export_type: export_type.to_string(),
                                props: extract_props_from_text(&block),
                                state: state.to_vec(),
                                children: extract_jsx_children(&block),
                                imports: imports.to_vec(),
                                is_client, is_server,
                                line_start: i + 1,
                                line_end: (i + block.lines().count()).min(lines.len()),
                                description: String::new(),
                            });
                        }
                    }
                }
            }
        }

        // Arrow function components: export const Name = or const Name =
        let arrow_patterns = [
            ("export default const ", "default"),
            ("export const ", "named"),
            ("const ", "none"),
        ];
        for (pattern, export_type) in &arrow_patterns {
            if trimmed.starts_with(pattern) {
                let rest = &trimmed[pattern.len()..];
                if let Some(eq_pos) = rest.find('=') {
                    let name = rest[..eq_pos].trim().to_string();
                    if name.chars().next().map_or(false, |c| c.is_uppercase()) && !found.contains(&name) {
                        let block = get_block_text(&lines, i);
                        if has_jsx_in_text(&block) {
                            found.insert(name.clone());
                            components.push(ComponentInfo {
                                name: name.clone(),
                                file_path: file_path.to_string(),
                                component_type: infer_component_type(file_path, &name),
                                export_type: export_type.to_string(),
                                props: extract_props_from_text(&block),
                                state: state.to_vec(),
                                children: extract_jsx_children(&block),
                                imports: imports.to_vec(),
                                is_client, is_server,
                                line_start: i + 1,
                                line_end: (i + block.lines().count()).min(lines.len()),
                                description: String::new(),
                            });
                        }
                    }
                }
            }
        }

        // Class components: class Name extends Component/React.Component
        if (trimmed.starts_with("export class ") || trimmed.starts_with("class ")) {
            let is_export = trimmed.starts_with("export");
            let rest = if is_export {
                trimmed.trim_start_matches("export").trim_start_matches(" default").trim().trim_start_matches("class ")
            } else {
                trimmed.trim_start_matches("class ")
            };
            if let Some(name) = extract_component_name(rest) {
                if trimmed.contains("extends") && (trimmed.contains("Component") || trimmed.contains("PureComponent")) {
                    if !found.contains(&name) {
                        found.insert(name.clone());
                        let block = get_block_text(&lines, i);
                        components.push(ComponentInfo {
                            name: name.clone(),
                            file_path: file_path.to_string(),
                            component_type: infer_component_type(file_path, &name),
                            export_type: if is_export { "named" } else { "none" }.to_string(),
                            props: vec![],
                            state: state.to_vec(),
                            children: extract_jsx_children(&block),
                            imports: imports.to_vec(),
                            is_client, is_server,
                            line_start: i + 1,
                            line_end: (i + block.lines().count()).min(lines.len()),
                            description: String::new(),
                        });
                    }
                }
            }
        }
    }

    components
}

fn extract_component_name(text: &str) -> Option<String> {
    let name: String = text.chars().take_while(|c| c.is_alphanumeric() || *c == '_').collect();
    if name.is_empty() || !name.chars().next().unwrap().is_uppercase() {
        None
    } else {
        Some(name)
    }
}

fn get_block_text(lines: &[&str], start: usize) -> String {
    // Get approximately the function body (up to 100 lines or matching braces)
    let mut depth = 0;
    let mut end = start;
    let mut found_open = false;

    for i in start..lines.len().min(start + 150) {
        for c in lines[i].chars() {
            if c == '{' { depth += 1; found_open = true; }
            if c == '}' { depth -= 1; }
        }
        end = i;
        if found_open && depth <= 0 { break; }
    }

    lines[start..=end].join("\n")
}
