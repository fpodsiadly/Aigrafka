from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


extension_dir = Path(__file__).resolve().parents[1]
dist_dir = extension_dir / "dist"
release_dir = extension_dir.parent / "releases"
archive_path = release_dir / "aigrafka-extension-latest.zip"

if not dist_dir.is_dir():
    raise SystemExit(f"Build directory does not exist: {dist_dir}")

release_dir.mkdir(parents=True, exist_ok=True)

with ZipFile(archive_path, "w", compression=ZIP_DEFLATED) as archive:
    for path in sorted(dist_dir.rglob("*")):
        if path.is_file() and path.name != ".DS_Store":
            archive.write(path, path.relative_to(dist_dir))

print(f"Created {archive_path}")
