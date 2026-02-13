---
name: youtube
description: This skill should be used when the user asks about "youtube", "my videos", "my channel", "youtube search", "video comments", "playlists", "list videos", "channel stats", "video details", "download video", "get transcript", "video subtitles", "summarize channel", "latest videos from channel", "video timestamp", "link to timestamp", or mentions YouTube operations. Provides YouTube Data API integration and yt-dlp for downloading videos, transcripts, and metadata from any channel. Includes workflow for comprehensive channel video summaries.
version: 0.5.0
---

# YouTube Skill

Search YouTube, list videos, channels, playlists, view comments, download videos, and extract transcripts.

## First-Time Setup

For API commands (your channel data): Run `npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/gmail/scripts/gmail.ts auth` to authenticate with Google. Tokens are stored per-project in `.claude/google-skill.local.json`.

For yt-dlp commands (any public content): Install yt-dlp with `brew install yt-dlp` (no auth needed).

## Using Your Own Credentials (Optional)

By default, this skill uses embedded OAuth credentials. To use your own Google Cloud project instead, save your credentials to `~/.config/google-skill/credentials.json`.

## API Commands (Requires OAuth)

```bash
# List your YouTube channels
npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/youtube/scripts/youtube.ts channels

# Get channel details
npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/youtube/scripts/youtube.ts channel <channelId>

# List your videos
npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/youtube/scripts/youtube.ts videos
npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/youtube/scripts/youtube.ts videos --max=20
npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/youtube/scripts/youtube.ts videos --channel=UC...

# Get video details
npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/youtube/scripts/youtube.ts video <videoId>

# List your playlists
npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/youtube/scripts/youtube.ts playlists

# Get playlist items
npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/youtube/scripts/youtube.ts playlist <playlistId>

# Search YouTube
npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/youtube/scripts/youtube.ts search --query="typescript tutorial"
npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/youtube/scripts/youtube.ts search --query="coding" --type=video --max=5

# Get video comments
npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/youtube/scripts/youtube.ts comments <videoId> --max=50
```

## yt-dlp Commands (No Auth Required)

These commands use yt-dlp to access any public YouTube content without OAuth.

### Get Video Metadata

```bash
# Get detailed info about any video
npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/youtube/scripts/youtube.ts dl-info dQw4w9WgXcQ
npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/youtube/scripts/youtube.ts dl-info "https://youtube.com/watch?v=..."
```

### List Channel Videos

```bash
# List videos from any public channel (by @handle, channel ID, or URL)
npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/youtube/scripts/youtube.ts dl-channel @mkbhd
npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/youtube/scripts/youtube.ts dl-channel UCXuqSBlHAE6Xw-yeJA0Tunw --max=50
npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/youtube/scripts/youtube.ts dl-channel "https://youtube.com/@channelname"
```

### Get Transcripts/Subtitles

```bash
# Get video transcript (auto-generated or manual subtitles)
npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/youtube/scripts/youtube.ts transcript dQw4w9WgXcQ
npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/youtube/scripts/youtube.ts transcript dQw4w9WgXcQ --lang=es
```

Returns both the full text and timestamped segments for analysis.

**Transcript Output Format:**
```json
{
  "success": true,
  "data": {
    "language": "en",
    "text": "Full transcript text joined together...",
    "segments": [
      { "start": 0.16, "text": "First segment text" },
      { "start": 4.55, "text": "Second segment text" },
      ...
    ],
    "segmentCount": 566
  }
}
```

### Creating Timestamped Links

Use segment timestamps to create deep links to specific moments in videos:

**URL Format:** `https://www.youtube.com/watch?v={videoId}&t={seconds}s`

**Examples:**
- Timestamp 120.5 seconds → `https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=120s`
- Timestamp 3661.2 seconds (1:01:01) → `https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3661s`

**Converting segment.start to link:**
```
segment.start = 289.12
videoId = "rHdMviAhDtE"
link = https://www.youtube.com/watch?v=rHdMviAhDtE&t=289s
```

**Markdown format for summaries:**
```markdown
[4:49](https://www.youtube.com/watch?v=rHdMviAhDtE&t=289s) - Eddie Bauer review starts
```

**Helper: Convert seconds to MM:SS or HH:MM:SS:**
- 289 seconds → `4:49` (Math.floor(289/60) + ":" + (289%60).toString().padStart(2,'0'))
- 3661 seconds → `1:01:01`

### Download Videos

```bash
# Download video (best quality)
npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/youtube/scripts/youtube.ts download dQw4w9WgXcQ

# Download to specific directory
npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/youtube/scripts/youtube.ts download dQw4w9WgXcQ --output=./videos

# Download specific quality
npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/youtube/scripts/youtube.ts download dQw4w9WgXcQ --format=720p
npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/youtube/scripts/youtube.ts download dQw4w9WgXcQ --format=mp4

# Extract audio only (MP3)
npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/youtube/scripts/youtube.ts download dQw4w9WgXcQ --audio-only

# Download with subtitles
npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/youtube/scripts/youtube.ts download dQw4w9WgXcQ --subtitles --sub-lang=en
```

### Download Playlists/Channels

```bash
# Download entire playlist
npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/youtube/scripts/youtube.ts dl-playlist "https://youtube.com/playlist?list=PL..."

# Download first 5 videos
npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/youtube/scripts/youtube.ts dl-playlist "https://youtube.com/playlist?list=..." --max=5

# Download videos 10-20
npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/youtube/scripts/youtube.ts dl-playlist "https://youtube.com/playlist?list=..." --start=10 --end=20

# Download as audio
npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/youtube/scripts/youtube.ts dl-playlist "https://youtube.com/playlist?list=..." --audio-only --output=./music
```

## Download Options

| Option | Description |
|--------|-------------|
| `--output=DIR` | Output directory (default: current) |
| `--format=FMT` | Format: `best`, `mp4`, `720p`, `480p`, `360p` |
| `--audio-only` | Extract audio as MP3 |
| `--subtitles` | Download subtitles with video |
| `--sub-lang=LANG` | Subtitle language code (default: en) |
| `--max=N` | Max videos for playlist download |
| `--start=N` | Start from video N in playlist |
| `--end=N` | End at video N in playlist |

## Video IDs

Video IDs are the 11-character code in YouTube URLs:
- `https://www.youtube.com/watch?v=dQw4w9WgXcQ` → ID is `dQw4w9WgXcQ`
- `https://youtu.be/dQw4w9WgXcQ` → ID is `dQw4w9WgXcQ`

## Channel References

Channels can be referenced by:
- Handle: `@mkbhd`
- Channel ID: `UCXuqSBlHAE6Xw-yeJA0Tunw`
- Full URL: `https://youtube.com/@mkbhd`

## Output

All commands return JSON with `success` and `data` fields.

## Help

```bash
npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/youtube/scripts/youtube.ts --help
```

## Channel Summary Workflow

For comprehensive summaries of a channel's recent videos (with transcripts, key points, and external links), see `CHANNEL-SUMMARY.md` in this skill directory.

**Quick workflow:**
1. List channel videos: `pnpm run youtube dl-channel "@channelname" --max=10`
2. Get transcripts for each video (run in parallel)
3. Create summaries with key points and insights
4. Research and add external links for people, companies, books mentioned
5. Export as markdown

This workflow is ideal for:
- Creating research summaries from tech channels
- Extracting insights from interview series
- Documenting book/product recommendations from creators
- Building knowledge bases from educational content
