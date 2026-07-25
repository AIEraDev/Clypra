#!/bin/bash

# GitHub Setup Script for VireoStudio v0.1.0
# Run this once to set up labels, milestone, and issues

REPO="AIEraDev/VireoStudio"

echo "Setting up GitHub repository: $REPO"
echo ""

# Check if gh CLI is installed
if ! command -v gh &> /dev/null; then
    echo "❌ GitHub CLI (gh) is not installed"
    echo "Install it: brew install gh"
    echo "Then run: gh auth login"
    exit 1
fi

# Check if authenticated
if ! gh auth status &> /dev/null; then
    echo "❌ Not authenticated with GitHub"
    echo "Run: gh auth login"
    exit 1
fi

echo "✅ GitHub CLI authenticated"
echo ""

# Create labels
echo "Creating labels..."

gh label create "type: bug" --color "d73a4a" --description "Something is broken" --repo $REPO 2>/dev/null || echo "  - type: bug already exists"
gh label create "type: feature" --color "0e8a16" --description "New functionality" --repo $REPO 2>/dev/null || echo "  - type: feature already exists"
gh label create "type: docs" --color "0075ca" --description "Documentation changes" --repo $REPO 2>/dev/null || echo "  - type: docs already exists"
gh label create "type: performance" --color "fbca04" --description "Performance improvements" --repo $REPO 2>/dev/null || echo "  - type: performance already exists"
gh label create "type: security" --color "d73a4a" --description "Security issues" --repo $REPO 2>/dev/null || echo "  - type: security already exists"

gh label create "priority: critical" --color "b60205" --description "Blocks release" --repo $REPO 2>/dev/null || echo "  - priority: critical already exists"
gh label create "priority: high" --color "d93f0b" --description "Important" --repo $REPO 2>/dev/null || echo "  - priority: high already exists"
gh label create "priority: medium" --color "fbca04" --description "Normal priority" --repo $REPO 2>/dev/null || echo "  - priority: medium already exists"
gh label create "priority: low" --color "0e8a16" --description "Nice to have" --repo $REPO 2>/dev/null || echo "  - priority: low already exists"

gh label create "platform: macOS" --color "5319e7" --description "macOS specific" --repo $REPO 2>/dev/null || echo "  - platform: macOS already exists"
gh label create "platform: Windows" --color "5319e7" --description "Windows specific" --repo $REPO 2>/dev/null || echo "  - platform: Windows already exists"
gh label create "platform: Linux" --color "5319e7" --description "Linux specific" --repo $REPO 2>/dev/null || echo "  - platform: Linux already exists"
gh label create "platform: all" --color "5319e7" --description "All platforms" --repo $REPO 2>/dev/null || echo "  - platform: all already exists"

gh label create "status: needs-repro" --color "d4c5f9" --description "Can't reproduce yet" --repo $REPO 2>/dev/null || echo "  - status: needs-repro already exists"
gh label create "status: confirmed" --color "c5def5" --description "Bug confirmed" --repo $REPO 2>/dev/null || echo "  - status: confirmed already exists"
gh label create "status: in-progress" --color "c5def5" --description "Being worked on" --repo $REPO 2>/dev/null || echo "  - status: in-progress already exists"
gh label create "status: blocked" --color "e99695" --description "Blocked by something" --repo $REPO 2>/dev/null || echo "  - status: blocked already exists"

gh label create "good first issue" --color "7057ff" --description "Good for newcomers" --repo $REPO 2>/dev/null || echo "  - good first issue already exists"
gh label create "help wanted" --color "008672" --description "We need help with this" --repo $REPO 2>/dev/null || echo "  - help wanted already exists"

echo "✅ Labels created"
echo ""

# Create milestone
echo "Creating v0.1.0 milestone..."
gh api repos/$REPO/milestones -f title="v0.1.0" -f description="First public release - MVP" -f due_on="2026-07-01T00:00:00Z" 2>/dev/null && echo "✅ Milestone created" || echo "  - Milestone already exists"
echo ""

# Get milestone number
MILESTONE=$(gh api repos/$REPO/milestones --jq '.[] | select(.title=="v0.1.0") | .number')

if [ -z "$MILESTONE" ]; then
    echo "❌ Could not find v0.1.0 milestone"
    exit 1
fi

echo "Milestone number: $MILESTONE"
echo ""

# Create issues
echo "Creating v0.1.0 issues..."

# Core features
gh issue create --repo $REPO --title "Import video/audio/image files" --body "Support MP4, MOV, AVI, MKV, WebM, MP3, WAV, PNG, JPG" --label "type: feature,priority: critical" --milestone $MILESTONE 2>/dev/null && echo "  ✓ #1 Import" || echo "  - Issue already exists"

gh issue create --repo $REPO --title "Source preview (HTML5 video)" --body "Preview media files before adding to timeline" --label "type: feature,priority: high" --milestone $MILESTONE 2>/dev/null && echo "  ✓ #2 Source preview" || echo "  - Issue already exists"

gh issue create --repo $REPO --title "Program preview (canvas compositor)" --body "Real-time canvas-based preview of timeline" --label "type: feature,priority: critical" --milestone $MILESTONE 2>/dev/null && echo "  ✓ #3 Program preview" || echo "  - Issue already exists"

gh issue create --repo $REPO --title "AudioContext master clock" --body "Implement imperative playback clock for A/V sync" --label "type: feature,priority: critical" --milestone $MILESTONE 2>/dev/null && echo "  ✓ #4 AudioContext clock" || echo "  - Issue already exists"

gh issue create --repo $REPO --title "Trim clips (left/right handles)" --body "Drag clip edges to trim in/out points" --label "type: feature,priority: critical" --milestone $MILESTONE 2>/dev/null && echo "  ✓ #5 Trim clips" || echo "  - Issue already exists"

gh issue create --repo $REPO --title "Split clip at playhead" --body "Press S to split clip at current time" --label "type: feature,priority: critical" --milestone $MILESTONE 2>/dev/null && echo "  ✓ #6 Split clip" || echo "  - Issue already exists"

gh issue create --repo $REPO --title "Delete clip" --body "Delete selected clips from timeline" --label "type: feature,priority: high" --milestone $MILESTONE 2>/dev/null && echo "  ✓ #7 Delete clip" || echo "  - Issue already exists"

gh issue create --repo $REPO --title "Move clips on timeline" --body "Drag clips to reposition on timeline" --label "type: feature,priority: critical" --milestone $MILESTONE 2>/dev/null && echo "  ✓ #8 Move clips" || echo "  - Issue already exists"

gh issue create --repo $REPO --title "Export MP4 (FFmpeg)" --body "Export timeline to MP4 with quality presets" --label "type: feature,priority: critical" --milestone $MILESTONE 2>/dev/null && echo "  ✓ #9 Export MP4" || echo "  - Issue already exists"

gh issue create --repo $REPO --title "Audio mixing in export" --body "Mix multiple audio tracks in export" --label "type: feature,priority: high" --milestone $MILESTONE 2>/dev/null && echo "  ✓ #10 Audio mixing" || echo "  - Issue already exists"

gh issue create --repo $REPO --title "Project save" --body "Save project to disk" --label "type: feature,priority: critical" --milestone $MILESTONE 2>/dev/null && echo "  ✓ #11 Project save" || echo "  - Issue already exists"

gh issue create --repo $REPO --title "Project load" --body "Load project from disk" --label "type: feature,priority: critical" --milestone $MILESTONE 2>/dev/null && echo "  ✓ #12 Project load" || echo "  - Issue already exists"

gh issue create --repo $REPO --title "Recent projects on launch screen" --body "Show recent projects with thumbnails" --label "type: feature,priority: medium" --milestone $MILESTONE 2>/dev/null && echo "  ✓ #13 Recent projects" || echo "  - Issue already exists"

gh issue create --repo $REPO --title "Undo/redo (100 levels)" --body "Command-based undo/redo system" --label "type: feature,priority: critical" --milestone $MILESTONE 2>/dev/null && echo "  ✓ #14 Undo/redo" || echo "  - Issue already exists"

# Polish
gh issue create --repo $REPO --title "Filmstrip thumbnails" --body "Multi-density thumbnail system for clips" --label "type: feature,priority: high" --milestone $MILESTONE 2>/dev/null && echo "  ✓ #15 Filmstrip" || echo "  - Issue already exists"

gh issue create --repo $REPO --title "Waveform on audio clips" --body "Canvas-based audio waveform visualization" --label "type: feature,priority: medium" --milestone $MILESTONE 2>/dev/null && echo "  ✓ #16 Waveform" || echo "  - Issue already exists"

gh issue create --repo $REPO --title "Playhead scrubbing" --body "Click timeline ruler to jump playhead" --label "type: feature,priority: high" --milestone $MILESTONE 2>/dev/null && echo "  ✓ #17 Scrubbing" || echo "  - Issue already exists"

gh issue create --repo $REPO --title "Timeline zoom" --body "Zoom in/out on timeline" --label "type: feature,priority: high" --milestone $MILESTONE 2>/dev/null && echo "  ✓ #18 Timeline zoom" || echo "  - Issue already exists"

gh issue create --repo $REPO --title "Keyboard shortcuts" --body "Space, S, Cmd+Z, Cmd+Shift+Z, etc." --label "type: feature,priority: high" --milestone $MILESTONE 2>/dev/null && echo "  ✓ #19 Shortcuts" || echo "  - Issue already exists"

gh issue create --repo $REPO --title "Drag and drop import" --body "Drag files onto timeline to import" --label "type: feature,priority: medium" --milestone $MILESTONE 2>/dev/null && echo "  ✓ #20 Drag & drop" || echo "  - Issue already exists"

# Release
gh issue create --repo $REPO --title "macOS DMG build + code signing" --body "Build universal DMG with Apple code signing" --label "type: feature,priority: critical,platform: macOS" --milestone $MILESTONE 2>/dev/null && echo "  ✓ #21 macOS build" || echo "  - Issue already exists"

gh issue create --repo $REPO --title "Windows MSI build" --body "Build Windows installer" --label "type: feature,priority: critical,platform: Windows" --milestone $MILESTONE 2>/dev/null && echo "  ✓ #22 Windows build" || echo "  - Issue already exists"

gh issue create --repo $REPO --title "Linux AppImage build" --body "Build Linux AppImage" --label "type: feature,priority: critical,platform: Linux" --milestone $MILESTONE 2>/dev/null && echo "  ✓ #23 Linux build" || echo "  - Issue already exists"

gh issue create --repo $REPO --title "GitHub Actions CI/CD" --body "Automated testing and release builds" --label "type: feature,priority: critical" --milestone $MILESTONE 2>/dev/null && echo "  ✓ #24 CI/CD" || echo "  - Issue already exists"

gh issue create --repo $REPO --title "Auto-updater" --body "Tauri updater plugin integration" --label "type: feature,priority: medium" --milestone $MILESTONE 2>/dev/null && echo "  ✓ #25 Auto-updater" || echo "  - Issue already exists"

gh issue create --repo $REPO --title "Website" --body "Landing page with downloads and docs" --label "type: docs,priority: high" --milestone $MILESTONE 2>/dev/null && echo "  ✓ #26 Website" || echo "  - Issue already exists"

gh issue create --repo $REPO --title "Documentation" --body "Getting started, keyboard shortcuts, FAQ" --label "type: docs,priority: high" --milestone $MILESTONE 2>/dev/null && echo "  ✓ #27 Documentation" || echo "  - Issue already exists"

gh issue create --repo $REPO --title "GitHub Sponsors setup" --body "Set up GitHub Sponsors with tiers" --label "type: docs,priority: low" --milestone $MILESTONE 2>/dev/null && echo "  ✓ #28 Sponsors" || echo "  - Issue already exists"

echo ""
echo "✅ All issues created"
echo ""
echo "🎉 GitHub setup complete!"
echo ""
echo "Next steps:"
echo "1. Go to https://github.com/$REPO/settings/branches"
echo "2. Add branch protection rules for 'master' and 'develop'"
echo "3. Go to https://github.com/$REPO/projects"
echo "4. Create a new project board with columns: Backlog, Ready, In Progress, In Review, Done"
echo "5. Add all v0.1.0 issues to the project board"
echo ""
