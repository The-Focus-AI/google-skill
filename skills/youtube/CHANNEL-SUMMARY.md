---
name: channel-summary
description: This skill should be used when the user asks to "summarize a channel", "what are the latest videos from", "get recent videos and transcripts", "summarize youtube channel content", "create video summaries", "analyze channel videos", or wants a comprehensive summary of a YouTube channel's recent content with transcripts and key insights.
version: 0.1.0
---

# YouTube Channel Summary Workflow

Generate comprehensive summaries of a YouTube channel's recent videos, including transcripts, key points, and external links.

## Prerequisites

- yt-dlp installed: `brew install yt-dlp`
- No OAuth required (uses public YouTube data)

## Workflow

### Step 1: Get Channel's Recent Videos

First, list the recent videos from the channel:

```bash
pnpm run youtube dl-channel "<channel>" --max=10
```

Channel can be:
- Handle: `@TuringPost`, `@mkbhd`
- Channel ID: `UC5M-w62kRmrD3-Saf-qGTug`
- Full URL: `https://youtube.com/@channelname`

This returns a list of videos with:
- Video ID
- Title
- Duration
- View count
- URL

### Step 2: Get Transcripts for Each Video

For each video ID from step 1, fetch the transcript:

```bash
pnpm run youtube transcript <videoId>
```

This returns:
- Full text of the transcript
- Timestamped segments for reference

**Tip:** Run multiple transcript commands in parallel to speed up the process.

### Step 3: Create Summaries

For each video, analyze the transcript and create:

1. **Key Points** (3-6 bullets) - Main topics and takeaways
2. **Most Interesting Insight** - The single most notable or surprising element
3. **Overall Summary** - 2-3 sentence description of what the video covers

### Step 4: Add External Links

Research and add hyperlinks for:
- People mentioned (Twitter/X, LinkedIn, Wikipedia)
- Companies/startups (official websites, Crunchbase)
- Products/tools (official sites)
- Books (Amazon, publisher sites)
- Research papers (arXiv, academic sites)

Use web search to find authoritative links for each entity.

### Step 5: Export as Markdown

Create a markdown file with this structure:

```markdown
# [Channel Name] Video Summaries

A summary of the latest videos from [Channel Name](youtube-url).

---

## 1. [Video Title]

**URL:** https://www.youtube.com/watch?v=VIDEO_ID
**Duration:** X:XX

### Key Points
- Point 1 with [relevant links](url)
- Point 2
- Point 3

### Most Interesting Insight
The most notable finding or surprising element from this video.

### Overall Summary
A 2-3 sentence description of the video content.

---

[Repeat for each video]

---

*Generated from [Channel Name] YouTube channel transcripts*
```

## Example: Turing Post Channel

```bash
# 1. List recent videos
pnpm run youtube dl-channel "UC5M-w62kRmrD3-Saf-qGTug" --max=10

# 2. Get transcripts (run in parallel for speed)
pnpm run youtube transcript PAjb83HHLaU
pnpm run youtube transcript E0jSj8oRFqo
pnpm run youtube transcript qqvODjOezX4
# ... etc

# 3. Create summaries with key points and insights
# 4. Research external links for people, companies, books mentioned
# 5. Export to markdown file
```

## Output Quality Guidelines

### Key Points
- Focus on actionable or informative content
- Include specific names, numbers, and facts
- Link to external resources where relevant

### Most Interesting Insight
- Should be surprising, counterintuitive, or particularly valuable
- Not just a restatement of the topic
- The "aha moment" from the video

### External Links
- People: Official sites, Twitter/X, LinkedIn, Wikipedia
- Companies: Official website, Crunchbase for funding info
- Books: Amazon, Goodreads, publisher site
- Products: Official product page
- Research: arXiv, Google Scholar, university pages

## Tips for Efficiency

1. **Parallel Execution**: Fetch multiple transcripts simultaneously
2. **Batch Processing**: Group similar research tasks (e.g., all book lookups)
3. **Template Usage**: Use consistent markdown structure
4. **Link Verification**: Test links are valid and authoritative
5. **Context Preservation**: Note relationships between topics across videos

## Common Channel Formats

| Channel Type | Focus Areas |
|--------------|-------------|
| Tech News | Products, companies, people, funding rounds |
| Book Reviews | Book titles, authors, publishers |
| Interviews | Guest names, companies, social profiles |
| Tutorials | Tools, frameworks, documentation links |
| Research | Papers, institutions, researchers |
