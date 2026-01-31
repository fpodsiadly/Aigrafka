#!/bin/bash

# Aigrafka Extension Build and Release Script
# Automates: version bump, build, ZIP creation, and cleanup
# Usage: ./scripts/build-and-release.sh [major|minor|patch]
# Default: patch

set -e

VERSION_TYPE="${1:-patch}"
EXTENSION_DIR="extension"
DIST_DIR="$EXTENSION_DIR/dist"
RELEASE_DIR="releases"
DATE=$(date +%Y%m%d_%H%M%S)

echo "🔨 Aigrafka Extension Build & Release"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 1. Read current version
echo "📖 Reading current version..."
CURRENT_VERSION=$(grep '"version"' "$EXTENSION_DIR/package.json" | head -1 | sed 's/.*"\([^"]*\)".*/\1/')
echo "   Current version: $CURRENT_VERSION"

# 2. Bump version using npm
echo "⬆️  Bumping version ($VERSION_TYPE)..."
cd "$EXTENSION_DIR"
npm version "$VERSION_TYPE" --no-git-tag-v > /dev/null 2>&1 || npm version "$VERSION_TYPE" > /dev/null 2>&1
NEW_VERSION=$(grep '"version"' package.json | head -1 | sed 's/.*"\([^"]*\)".*/\1/')
echo "   New version: $NEW_VERSION"

# 3. Update manifest.json version
echo "📝 Updating manifest.json version..."
sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$NEW_VERSION\"/" manifest.json
echo "   ✓ manifest.json version updated"

cd - > /dev/null

# 4. Build extension
echo "🏗️  Building extension..."
cd "$EXTENSION_DIR"
npm run build > /dev/null 2>&1
echo "   ✓ Build complete"
cd - > /dev/null

# 5. Create releases directory if not exists
mkdir -p "$RELEASE_DIR"

# 6. Create ZIP file
ZIP_FILENAME="aigrafka-extension-${NEW_VERSION}-${DATE}.zip"
ZIP_PATH="$RELEASE_DIR/$ZIP_FILENAME"
echo "📦 Creating ZIP archive..."
cd "$DIST_DIR"
zip -q -r "../../$ZIP_PATH" . -x "*.DS_Store"
cd - > /dev/null
echo "   ✓ Created: $ZIP_PATH"

# 7. Create latest symlink
LATEST_ZIP="$RELEASE_DIR/aigrafka-extension-latest.zip"
rm -f "$LATEST_ZIP"
ln -s "$ZIP_FILENAME" "$LATEST_ZIP"
echo "   ✓ Updated: $LATEST_ZIP → $ZIP_FILENAME"

# 8. Summary
echo ""
echo "✅ Release Complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📦 Version:       $NEW_VERSION"
echo "📁 Archive:       $ZIP_PATH"
echo "📋 Size:          $(du -h "$ZIP_PATH" | cut -f1)"
echo "🔗 Latest link:   $LATEST_ZIP"
echo ""
echo "📤 Next steps:"
echo "   1. Go to Chrome Web Store Developer Dashboard"
echo "   2. Upload: $ZIP_PATH"
echo "   3. Fill in description, screenshots, and privacy policy"
echo "   4. Submit for review"
echo ""
echo "💡 Tip: Keep releases/ folder in .gitignore"
