use ignore::WalkBuilder;
use std::path::Path;
use crate::types::FileInfo;

const SOURCE_EXTENSIONS: &[&str] = &[
    "tsx", "jsx", "ts", "js", "mjs", "cjs", "vue", "svelte",
];

const IGNORE_DIRS: &[&str] = &[
    "node_modules", "dist", "build", "out", ".next", ".nuxt",
    ".svelte-kit", ".output", ".vercel", ".cache", ".turbo",
    "coverage", "__tests__", "__mocks__", ".git",
];

pub fn scan_files(root: &Path) -> Vec<FileInfo> {
    let mut files = Vec::new();

    let walker = WalkBuilder::new(root)
        .hidden(false)
        .git_ignore(true)
        .filter_entry(|entry| {
            let name = entry.file_name().to_string_lossy();
            if entry.file_type().map_or(false, |ft| ft.is_dir()) {
                return !IGNORE_DIRS.contains(&name.as_ref());
            }
            true
        })
        .build();

    for entry in walker.flatten() {
        if !entry.file_type().map_or(false, |ft| ft.is_file()) {
            continue;
        }

        let path = entry.path();
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");

        if !SOURCE_EXTENSIONS.contains(&ext) {
            continue;
        }

        // Skip test/story files
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if name.contains(".test.") || name.contains(".spec.") || name.contains(".stories.") {
            continue;
        }
        if name.ends_with(".d.ts") || name.ends_with(".min.js") {
            continue;
        }

        let relative = path.strip_prefix(root).unwrap_or(path);
        let size = entry.metadata().map(|m| m.len()).unwrap_or(0);

        files.push(FileInfo {
            path: relative.to_string_lossy().replace('\\', "/"),
            extension: ext.to_string(),
            size,
        });
    }

    files
}
