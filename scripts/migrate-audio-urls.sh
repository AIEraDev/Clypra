#!/bin/bash

#####################################################################
# R2 Audio URL Migration Script
# 
# This script updates all JSON files in your R2 bucket to use
# Cloudflare URLs instead of GitHub URLs
#####################################################################

set -e

BUCKET="clypra-assets"
TEMP_DIR="./r2-migration-temp"
GITHUB_BASE="https://raw.githubusercontent.com/AIEraDev/clypra-api/main/data/"
CLOUDFLARE_BASE="https://clypra-worker-api.abdulkabirmusa.com/files/"

echo "🚀 Starting R2 Audio URL Migration..."
echo "📦 Bucket: $BUCKET"
echo ""

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo "❌ Error: wrangler is not installed"
    echo "Install it with: npm install -g wrangler"
    exit 1
fi

# Create temp directory
mkdir -p "$TEMP_DIR"
echo "📁 Created temp directory: $TEMP_DIR"

# Get list of all JSON files in audio directory
echo "📋 Fetching list of JSON files from R2..."
JSON_FILES=$(wrangler r2 object list "$BUCKET" --prefix "audio/" | grep "\.json" | awk '{print $1}' || echo "")

if [ -z "$JSON_FILES" ]; then
    echo "❌ No JSON files found in audio/ directory"
    exit 1
fi

echo "✅ Found JSON files to migrate:"
echo "$JSON_FILES"
echo ""

# Counter for progress
TOTAL=$(echo "$JSON_FILES" | wc -l | xargs)
CURRENT=0

# Process each JSON file
echo "$JSON_FILES" | while read -r file; do
    CURRENT=$((CURRENT + 1))
    echo "[$CURRENT/$TOTAL] Processing: $file"
    
    # Download the JSON file
    LOCAL_FILE="$TEMP_DIR/$(basename "$file")"
    wrangler r2 object get "$BUCKET/$file" --file "$LOCAL_FILE" 2>/dev/null
    
    if [ ! -f "$LOCAL_FILE" ]; then
        echo "  ⚠️  Failed to download, skipping..."
        continue
    fi
    
    # Check if file contains GitHub URLs
    if grep -q "raw.githubusercontent.com" "$LOCAL_FILE"; then
        echo "  🔄 Migrating URLs..."
        
        # Replace GitHub URLs with Cloudflare URLs
        # Using perl for in-place replacement (works on macOS and Linux)
        perl -i -pe "s|$GITHUB_BASE|$CLOUDFLARE_BASE|g" "$LOCAL_FILE"
        
        # Upload the updated file back to R2
        wrangler r2 object put "$BUCKET/$file" --file "$LOCAL_FILE" 2>/dev/null
        echo "  ✅ Updated and uploaded"
    else
        echo "  ⏭️  Already migrated, skipping..."
    fi
    
    # Clean up local file
    rm -f "$LOCAL_FILE"
done

# Clean up temp directory
rm -rf "$TEMP_DIR"

echo ""
echo "✨ Migration complete!"
echo ""
echo "🔍 Verification:"
echo "Run this command to check a sample file:"
echo "wrangler r2 object get $BUCKET/audio/music/333524-lekhalekha-music-school-india.json --file test.json"
echo "cat test.json | grep audioUrl"
echo ""
echo "✅ Your audio URLs are now using Cloudflare!"
