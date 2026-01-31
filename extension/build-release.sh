#!/bin/bash
set -e

echo "🚀 Building Aigrafka Extension Release Package"
echo "=============================================="

# Check if jq is installed (for JSON manipulation)
if ! command -v jq &> /dev/null; then
    echo "⚠️  jq not found. Installing via npm..."
    npm install -g json
fi

# Get current version from manifest.json
CURRENT_VERSION=$(cat manifest.json | grep '"version"' | head -1 | awk -F'"' '{print $4}')
echo "📦 Current version: $CURRENT_VERSION"

# Parse version parts
IFS='.' read -r -a VERSION_PARTS <<< "$CURRENT_VERSION"
MAJOR="${VERSION_PARTS[0]}"
MINOR="${VERSION_PARTS[1]}"
PATCH="${VERSION_PARTS[2]}"

# Increment patch version
NEW_PATCH=$((PATCH + 1))
NEW_VERSION="$MAJOR.$MINOR.$NEW_PATCH"

echo "🔼 Bumping version to: $NEW_VERSION"

# Update manifest.json
if command -v jq &> /dev/null; then
    jq ".version = \"$NEW_VERSION\"" manifest.json > manifest.tmp && mv manifest.tmp manifest.json
else
    sed -i.bak "s/\"version\": \"$CURRENT_VERSION\"/\"version\": \"$NEW_VERSION\"/" manifest.json
    rm -f manifest.json.bak
fi

# Update package.json
if command -v jq &> /dev/null; then
    jq ".version = \"$NEW_VERSION\"" package.json > package.tmp && mv package.tmp package.json
else
    sed -i.bak "s/\"version\": \"$CURRENT_VERSION\"/\"version\": \"$NEW_VERSION\"/" package.json
    rm -f package.json.bak
fi

echo "✅ Version files updated"

# Clean previous builds
echo "🧹 Cleaning previous builds..."
rm -rf dist
rm -f aigrafka-extension-*.zip

# Build extension
echo "🔨 Building extension..."
npm run build

# Copy LICENSE and PRIVACY_POLICY to dist
echo "📄 Copying LICENSE and PRIVACY_POLICY..."
cp ../LICENSE dist/
cp ../PRIVACY_POLICY.md dist/

# Create ZIP
ZIP_NAME="aigrafka-extension-v${NEW_VERSION}.zip"
echo "📦 Creating $ZIP_NAME..."
cd dist
zip -r "../$ZIP_NAME" . -x "*.DS_Store" -x "__MACOSX/*"
cd ..

# Calculate size
SIZE=$(du -h "$ZIP_NAME" | cut -f1)

echo ""
echo "=============================================="
echo "✅ Release package created successfully!"
echo "=============================================="
echo "📦 Package: $ZIP_NAME"
echo "📏 Size: $SIZE"
echo "🔢 Version: $NEW_VERSION"
echo ""
echo "Next steps:"
echo "1. Test the extension: Load 'dist/' folder in chrome://extensions"
echo "2. Upload '$ZIP_NAME' to Chrome Web Store"
echo "3. Commit version changes: git add . && git commit -m 'Release v$NEW_VERSION'"
echo ""
