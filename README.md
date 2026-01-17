# google-skill

Full Google services integration for Claude Code: Gmail, Calendar, Sheets, Docs, and YouTube.

## Features

- **Gmail**: Read, send, search emails. Manage labels. Download as EML. HTML emails with attachments.
- **Calendar**: List, create, delete events. Multiple calendar support.
- **Sheets**: Create spreadsheets, read/write cells, append rows.
- **Docs**: Create documents, read content, insert/append text, find/replace.
- **YouTube**: Search, list videos/channels/playlists, view comments.
- **YouTube (yt-dlp)**: Download videos, extract transcripts, list any channel's videos, create channel summaries.

All services share a single OAuth authentication. yt-dlp features work without OAuth.

## Installation

### Via Focus Marketplace (Recommended)

```bash
# Add the Focus marketplace (if not already added)
/plugin marketplace add The-Focus-AI/claude-marketplace

# Install the plugin
/plugin install google-skill@focus-marketplace
```

Then restart Claude Code.

### Direct Install

```bash
/plugin install https://github.com/The-Focus-AI/google-skill
```

### For yt-dlp Features

```bash
brew install yt-dlp
```

## First-Time Setup

After installation, run:

```bash
npx tsx scripts/gmail.ts auth
```

If this is your first time, you'll see setup instructions to create Google OAuth credentials. This is a one-time setup stored in `~/.config/google-skill/`.

### Required Google APIs

Enable these APIs in Google Cloud Console:
- Gmail API
- Google Calendar API
- Google Sheets API
- Google Docs API
- YouTube Data API v3
- Google Drive API

### OAuth Scopes

The skill requests these scopes:
- Gmail: read, send, modify
- Calendar: read, events
- Sheets: full access
- Docs: full access
- YouTube: read, upload
- Drive: read-only (for listing files)

### Token Storage

```
~/.config/google-skill/
└── credentials.json   # OAuth client (you create once, shared across projects)

.claude/
└── google-skill.local.json   # Per-project refresh token (auto-created)
```

## Usage

Once authenticated, Claude can:

- **Gmail**: "check my unread emails", "send an email to...", "search for emails from..."
- **Calendar**: "what's on my calendar today", "create a meeting for..."
- **Sheets**: "list my spreadsheets", "read cells A1:D10 from...", "create a spreadsheet"
- **Docs**: "list my documents", "read document...", "create a doc called..."
- **YouTube**: "list my videos", "search YouTube for...", "get comments on..."
- **YouTube (yt-dlp)**: "what are the latest videos from @channelname", "get transcript for this video", "summarize this channel's recent content"

### Manual Commands

```bash
# Gmail
pnpm run gmail list
pnpm run gmail list --query="is:unread"
pnpm run gmail read <message-id>
pnpm run gmail send --to=x@y.com --subject="Hi" --body="Hello"
pnpm run gmail --help

# Calendar
pnpm run gmail calendars
pnpm run gmail events
pnpm run gmail create --summary="Meeting" --start="2026-01-15T10:00:00" --end="2026-01-15T11:00:00"

# Sheets
pnpm run gsheets list
pnpm run gsheets read <spreadsheetId> "Sheet1!A1:D10"
pnpm run gsheets write <spreadsheetId> "Sheet1!A1" --values='[["Hello","World"]]'
pnpm run gsheets create --title="My Data"
pnpm run gsheets --help

# Docs
pnpm run gdocs list
pnpm run gdocs read <documentId>
pnpm run gdocs create --title="My Document"
pnpm run gdocs append <documentId> --text="New paragraph"
pnpm run gdocs --help

# YouTube (API - requires OAuth)
pnpm run youtube channels
pnpm run youtube videos
pnpm run youtube search --query="typescript tutorial"
pnpm run youtube comments <videoId>
pnpm run youtube --help

# YouTube (yt-dlp - no OAuth required)
pnpm run youtube dl-channel @mkbhd --max=10
pnpm run youtube dl-info <videoId>
pnpm run youtube transcript <videoId>
pnpm run youtube download <videoId> --output=./videos
pnpm run youtube download <videoId> --audio-only
```

## YouTube yt-dlp Features

These commands use yt-dlp and work without OAuth authentication on any public YouTube content.

### List Channel Videos

```bash
# By handle
pnpm run youtube dl-channel @mkbhd --max=20

# By channel ID
pnpm run youtube dl-channel UC5M-w62kRmrD3-Saf-qGTug --max=10

# By URL
pnpm run youtube dl-channel "https://youtube.com/@TuringPost" --max=15
```

### Get Video Transcripts

```bash
# Get transcript (auto-generated or manual subtitles)
pnpm run youtube transcript dQw4w9WgXcQ

# Specific language
pnpm run youtube transcript dQw4w9WgXcQ --lang=es
```

Returns full text and timestamped segments.

### Download Videos

```bash
# Best quality
pnpm run youtube download dQw4w9WgXcQ

# To specific directory
pnpm run youtube download dQw4w9WgXcQ --output=./videos

# Specific quality
pnpm run youtube download dQw4w9WgXcQ --format=720p

# Audio only (MP3)
pnpm run youtube download dQw4w9WgXcQ --audio-only

# With subtitles
pnpm run youtube download dQw4w9WgXcQ --subtitles --sub-lang=en
```

### Download Playlists

```bash
# Entire playlist
pnpm run youtube dl-playlist "https://youtube.com/playlist?list=PL..."

# First 5 videos
pnpm run youtube dl-playlist "https://youtube.com/playlist?list=..." --max=5

# As audio
pnpm run youtube dl-playlist "https://youtube.com/playlist?list=..." --audio-only
```

## Channel Summary Workflow

Create comprehensive summaries of a YouTube channel's recent videos with transcripts, key points, and external links.

### Quick Start

```bash
# 1. List recent videos
pnpm run youtube dl-channel "@TuringPost" --max=10

# 2. Get transcripts (run multiple in parallel for speed)
pnpm run youtube transcript VIDEO_ID_1
pnpm run youtube transcript VIDEO_ID_2
# ... etc

# 3. Create summaries with:
#    - Key points (3-6 bullets)
#    - Most interesting insight
#    - Overall summary

# 4. Research and add external links for:
#    - People mentioned (Twitter, LinkedIn, Wikipedia)
#    - Companies (official sites, funding info)
#    - Books (Amazon, publisher sites)
#    - Products/tools (official sites)

# 5. Export as markdown
```

### Example Output Structure

```markdown
# Channel Name Video Summaries

## 1. Video Title

**URL:** https://www.youtube.com/watch?v=VIDEO_ID
**Duration:** 10:30

### Key Points
- [Person Name](twitter-link) discussed topic X
- [Company](company-url) raised $50M for Y
- Book recommendation: [Book Title](amazon-link)

### Most Interesting Insight
The single most surprising or valuable takeaway.

### Overall Summary
2-3 sentences describing what the video covers.
```

### Use Cases

- Research summaries from tech news channels
- Extract insights from interview series
- Document book/product recommendations
- Build knowledge bases from educational content

See `.claude-plugin/skills/youtube/CHANNEL-SUMMARY.md` for the full workflow documentation.

## Project Structure

```
google-skill/
├── .claude-plugin/
│   ├── plugin.json
│   └── skills/
│       ├── gmail/SKILL.md
│       ├── gsheets/SKILL.md
│       ├── gdocs/SKILL.md
│       └── youtube/
│           ├── SKILL.md
│           └── CHANNEL-SUMMARY.md
├── scripts/
│   ├── lib/
│   │   ├── auth.ts        # Shared OAuth
│   │   └── output.ts      # Shared CLI helpers
│   ├── gmail.ts           # Gmail + Calendar
│   ├── gsheets.ts         # Google Sheets
│   ├── gdocs.ts           # Google Docs
│   └── youtube.ts         # YouTube (API + yt-dlp)
├── package.json
└── README.md
```

## Local Development

### Test Without Installing

```bash
git clone https://github.com/The-Focus-AI/google-skill
cd google-skill
pnpm install

# Test commands
pnpm run gmail --help
pnpm run gsheets --help
pnpm run gdocs --help
pnpm run youtube --help
```

### Test as Plugin

```bash
claude --plugin-dir /path/to/google-skill
```

## Troubleshooting

### "Credentials not found"

Run `pnpm run gmail auth` and follow the setup instructions.

### "Token expired" or "Invalid credentials"

```bash
rm .claude/google-skill.local.json
pnpm run gmail auth
```

### "No refresh token received"

The app was already authorized. Revoke access and retry:

1. Go to https://myaccount.google.com/permissions
2. Remove access for the app
3. Run auth again

### "Access blocked" during OAuth

Check:
- All required APIs are enabled
- Your email is added as a test user
- Scopes are configured in OAuth consent screen

### "yt-dlp is not installed"

```bash
brew install yt-dlp
```

### "No subtitles available"

Not all videos have transcripts. Try:
- Different language: `--lang=es`
- The video may not have auto-generated captions

### Upgrading from gmail-skill

The skill will automatically detect and use old token/credential locations:
- `~/.config/gmail-skill/credentials.json` → still works
- `.claude/gmail-skill.local.json` → still works

New auth will use the new locations.

## License

MIT
