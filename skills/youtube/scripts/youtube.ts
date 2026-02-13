#!/usr/bin/env npx tsx

/**
 * YouTube CLI - Search, list videos, channels, and playlists
 */

import { google, youtube_v3 } from "googleapis";
import { loadToken, CREDENTIALS_PATH } from "../../../scripts/lib/auth.js";
import { output, fail, parseArgs } from "../../../scripts/lib/output.js";
import { execSync, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";

// ============================================================================
// YouTube Client
// ============================================================================

async function getYouTubeClient(): Promise<youtube_v3.Youtube> {
  const auth = await loadToken();
  return google.youtube({ version: "v3", auth });
}

// ============================================================================
// YouTube Operations
// ============================================================================

interface ChannelInfo {
  id: string;
  title: string;
  description: string;
  customUrl?: string;
  subscriberCount?: number;
  videoCount?: number;
  viewCount?: number;
  thumbnailUrl?: string;
}

async function listMyChannels(
  youtube: youtube_v3.Youtube
): Promise<ChannelInfo[]> {
  const res = await youtube.channels.list({
    part: ["snippet", "statistics", "contentDetails"],
    mine: true,
  });

  return (res.data.items || []).map((c) => ({
    id: c.id!,
    title: c.snippet?.title || "",
    description: c.snippet?.description || "",
    customUrl: c.snippet?.customUrl,
    subscriberCount: c.statistics?.subscriberCount
      ? parseInt(c.statistics.subscriberCount)
      : undefined,
    videoCount: c.statistics?.videoCount
      ? parseInt(c.statistics.videoCount)
      : undefined,
    viewCount: c.statistics?.viewCount
      ? parseInt(c.statistics.viewCount)
      : undefined,
    thumbnailUrl: c.snippet?.thumbnails?.default?.url,
  }));
}

async function getChannel(
  youtube: youtube_v3.Youtube,
  channelId: string
): Promise<ChannelInfo> {
  const res = await youtube.channels.list({
    part: ["snippet", "statistics", "contentDetails"],
    id: [channelId],
  });

  const c = res.data.items?.[0];
  if (!c) {
    throw new Error(`Channel not found: ${channelId}`);
  }

  return {
    id: c.id!,
    title: c.snippet?.title || "",
    description: c.snippet?.description || "",
    customUrl: c.snippet?.customUrl,
    subscriberCount: c.statistics?.subscriberCount
      ? parseInt(c.statistics.subscriberCount)
      : undefined,
    videoCount: c.statistics?.videoCount
      ? parseInt(c.statistics.videoCount)
      : undefined,
    viewCount: c.statistics?.viewCount
      ? parseInt(c.statistics.viewCount)
      : undefined,
    thumbnailUrl: c.snippet?.thumbnails?.default?.url,
  };
}

interface VideoInfo {
  id: string;
  title: string;
  description: string;
  publishedAt: string;
  channelId: string;
  channelTitle: string;
  thumbnailUrl?: string;
  viewCount?: number;
  likeCount?: number;
  commentCount?: number;
  duration?: string;
}

async function listMyVideos(
  youtube: youtube_v3.Youtube,
  maxResults: number = 10,
  channelId?: string
): Promise<VideoInfo[]> {
  // If no channel specified, get user's channel first
  let targetChannelId = channelId;
  if (!targetChannelId) {
    const channels = await listMyChannels(youtube);
    if (channels.length === 0) {
      throw new Error("No YouTube channel found for this account");
    }
    targetChannelId = channels[0].id;
  }

  // Search for videos in the channel
  const searchRes = await youtube.search.list({
    part: ["snippet"],
    channelId: targetChannelId,
    type: ["video"],
    order: "date",
    maxResults,
  });

  const videoIds = (searchRes.data.items || [])
    .map((item) => item.id?.videoId)
    .filter(Boolean) as string[];

  if (videoIds.length === 0) {
    return [];
  }

  // Get detailed video info
  const videosRes = await youtube.videos.list({
    part: ["snippet", "statistics", "contentDetails"],
    id: videoIds,
  });

  return (videosRes.data.items || []).map((v) => ({
    id: v.id!,
    title: v.snippet?.title || "",
    description: v.snippet?.description || "",
    publishedAt: v.snippet?.publishedAt || "",
    channelId: v.snippet?.channelId || "",
    channelTitle: v.snippet?.channelTitle || "",
    thumbnailUrl: v.snippet?.thumbnails?.medium?.url,
    viewCount: v.statistics?.viewCount
      ? parseInt(v.statistics.viewCount)
      : undefined,
    likeCount: v.statistics?.likeCount
      ? parseInt(v.statistics.likeCount)
      : undefined,
    commentCount: v.statistics?.commentCount
      ? parseInt(v.statistics.commentCount)
      : undefined,
    duration: v.contentDetails?.duration,
  }));
}

async function getVideo(
  youtube: youtube_v3.Youtube,
  videoId: string
): Promise<VideoInfo> {
  const res = await youtube.videos.list({
    part: ["snippet", "statistics", "contentDetails"],
    id: [videoId],
  });

  const v = res.data.items?.[0];
  if (!v) {
    throw new Error(`Video not found: ${videoId}`);
  }

  return {
    id: v.id!,
    title: v.snippet?.title || "",
    description: v.snippet?.description || "",
    publishedAt: v.snippet?.publishedAt || "",
    channelId: v.snippet?.channelId || "",
    channelTitle: v.snippet?.channelTitle || "",
    thumbnailUrl: v.snippet?.thumbnails?.medium?.url,
    viewCount: v.statistics?.viewCount
      ? parseInt(v.statistics.viewCount)
      : undefined,
    likeCount: v.statistics?.likeCount
      ? parseInt(v.statistics.likeCount)
      : undefined,
    commentCount: v.statistics?.commentCount
      ? parseInt(v.statistics.commentCount)
      : undefined,
    duration: v.contentDetails?.duration,
  };
}

interface PlaylistInfo {
  id: string;
  title: string;
  description: string;
  itemCount: number;
  thumbnailUrl?: string;
  publishedAt: string;
}

async function listMyPlaylists(
  youtube: youtube_v3.Youtube,
  maxResults: number = 20
): Promise<PlaylistInfo[]> {
  const res = await youtube.playlists.list({
    part: ["snippet", "contentDetails"],
    mine: true,
    maxResults,
  });

  return (res.data.items || []).map((p) => ({
    id: p.id!,
    title: p.snippet?.title || "",
    description: p.snippet?.description || "",
    itemCount: p.contentDetails?.itemCount || 0,
    thumbnailUrl: p.snippet?.thumbnails?.medium?.url,
    publishedAt: p.snippet?.publishedAt || "",
  }));
}

interface PlaylistItem {
  id: string;
  videoId: string;
  title: string;
  description: string;
  thumbnailUrl?: string;
  position: number;
  channelTitle: string;
}

async function getPlaylistItems(
  youtube: youtube_v3.Youtube,
  playlistId: string,
  maxResults: number = 50
): Promise<PlaylistItem[]> {
  const res = await youtube.playlistItems.list({
    part: ["snippet", "contentDetails"],
    playlistId,
    maxResults,
  });

  return (res.data.items || []).map((item) => ({
    id: item.id!,
    videoId: item.contentDetails?.videoId || "",
    title: item.snippet?.title || "",
    description: item.snippet?.description || "",
    thumbnailUrl: item.snippet?.thumbnails?.medium?.url,
    position: item.snippet?.position || 0,
    channelTitle: item.snippet?.channelTitle || "",
  }));
}

interface SearchResult {
  id: string;
  kind: "video" | "channel" | "playlist";
  title: string;
  description: string;
  channelTitle: string;
  publishedAt: string;
  thumbnailUrl?: string;
}

async function searchYouTube(
  youtube: youtube_v3.Youtube,
  query: string,
  maxResults: number = 10,
  type?: "video" | "channel" | "playlist"
): Promise<SearchResult[]> {
  const params: youtube_v3.Params$Resource$Search$List = {
    part: ["snippet"],
    q: query,
    maxResults,
    order: "relevance",
  };

  if (type) {
    params.type = [type];
  }

  const res = await youtube.search.list(params);

  return (res.data.items || []).map((item) => {
    let id = "";
    let kind: "video" | "channel" | "playlist" = "video";

    if (item.id?.videoId) {
      id = item.id.videoId;
      kind = "video";
    } else if (item.id?.channelId) {
      id = item.id.channelId;
      kind = "channel";
    } else if (item.id?.playlistId) {
      id = item.id.playlistId;
      kind = "playlist";
    }

    return {
      id,
      kind,
      title: item.snippet?.title || "",
      description: item.snippet?.description || "",
      channelTitle: item.snippet?.channelTitle || "",
      publishedAt: item.snippet?.publishedAt || "",
      thumbnailUrl: item.snippet?.thumbnails?.medium?.url,
    };
  });
}

interface CommentInfo {
  id: string;
  authorDisplayName: string;
  authorChannelId?: string;
  textDisplay: string;
  textOriginal: string;
  likeCount: number;
  publishedAt: string;
  updatedAt: string;
}

// ============================================================================
// yt-dlp Operations (No Auth Required)
// ============================================================================

function checkYtDlp(): void {
  try {
    execSync("which yt-dlp", { stdio: "pipe" });
  } catch {
    throw new Error(
      "yt-dlp is not installed. Install with: brew install yt-dlp"
    );
  }
}

interface YtDlpVideoInfo {
  id: string;
  title: string;
  description?: string;
  upload_date?: string;
  duration?: number;
  view_count?: number;
  like_count?: number;
  comment_count?: number;
  channel?: string;
  channel_id?: string;
  channel_url?: string;
  uploader?: string;
  thumbnail?: string;
  webpage_url?: string;
  categories?: string[];
  tags?: string[];
}

interface YtDlpChannelInfo {
  id: string;
  title: string;
  description?: string;
  channel_url?: string;
  entries?: YtDlpVideoInfo[];
}

/**
 * Get video metadata using yt-dlp (no auth required)
 */
function ytdlpGetVideoInfo(videoIdOrUrl: string): YtDlpVideoInfo {
  checkYtDlp();
  const url = videoIdOrUrl.startsWith("http")
    ? videoIdOrUrl
    : `https://www.youtube.com/watch?v=${videoIdOrUrl}`;

  const result = execSync(
    `yt-dlp --dump-json --no-download "${url}"`,
    { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 }
  );

  return JSON.parse(result);
}

/**
 * List videos from any channel using yt-dlp (no auth required)
 */
function ytdlpListChannelVideos(
  channelUrl: string,
  maxResults: number = 20
): YtDlpVideoInfo[] {
  checkYtDlp();

  // Normalize channel URL
  let url = channelUrl;
  if (!url.startsWith("http")) {
    // Could be @handle or channel ID
    if (url.startsWith("@")) {
      url = `https://www.youtube.com/${url}/videos`;
    } else if (url.startsWith("UC")) {
      url = `https://www.youtube.com/channel/${url}/videos`;
    } else {
      url = `https://www.youtube.com/@${url}/videos`;
    }
  }

  // Get playlist info (channel videos are treated as a playlist)
  const result = execSync(
    `yt-dlp --flat-playlist --dump-json --playlist-end ${maxResults} "${url}"`,
    { encoding: "utf-8", maxBuffer: 50 * 1024 * 1024 }
  );

  // Each line is a JSON object
  const videos: YtDlpVideoInfo[] = [];
  for (const line of result.trim().split("\n")) {
    if (line) {
      try {
        videos.push(JSON.parse(line));
      } catch {
        // Skip invalid lines
      }
    }
  }

  return videos;
}

/**
 * Get video transcript/subtitles using yt-dlp
 */
function ytdlpGetTranscript(
  videoIdOrUrl: string,
  lang: string = "en"
): { text: string; segments?: Array<{ start: number; text: string }> } {
  checkYtDlp();
  const url = videoIdOrUrl.startsWith("http")
    ? videoIdOrUrl
    : `https://www.youtube.com/watch?v=${videoIdOrUrl}`;

  const tmpDir = fs.mkdtempSync("/tmp/yt-transcript-");
  const outputTemplate = path.join(tmpDir, "subtitle");

  try {
    // Try auto-generated subtitles first, then manual
    execSync(
      `yt-dlp --write-auto-sub --write-sub --sub-lang "${lang}" --sub-format vtt --skip-download -o "${outputTemplate}" "${url}"`,
      { encoding: "utf-8", stdio: "pipe" }
    );

    // Find the subtitle file
    const files = fs.readdirSync(tmpDir);
    const subFile = files.find((f) => f.endsWith(".vtt"));

    if (!subFile) {
      throw new Error(`No subtitles available for language: ${lang}`);
    }

    const vttContent = fs.readFileSync(path.join(tmpDir, subFile), "utf-8");

    // Parse VTT to extract text and timestamps
    // YouTube auto-generated VTT has a "karaoke" format where each cue shows
    // the current line plus the next line being typed. We need to extract
    // only the unique text from the first line of each cue.
    const segments: Array<{ start: number; text: string }> = [];
    const lines = vttContent.split("\n");
    let currentStart: number | null = null;
    let isFirstLineOfCue = true;
    let currentText = "";

    for (const line of lines) {
      // Match timestamp line: 00:00:00.000 --> 00:00:05.000
      const timestampMatch = line.match(
        /(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->/
      );
      if (timestampMatch) {
        // Save previous segment
        if (currentStart !== null && currentText.trim()) {
          segments.push({ start: currentStart, text: currentText.trim() });
        }
        // Parse start time
        const hours = parseInt(timestampMatch[1]);
        const minutes = parseInt(timestampMatch[2]);
        const seconds = parseInt(timestampMatch[3]);
        const ms = parseInt(timestampMatch[4]);
        currentStart = hours * 3600 + minutes * 60 + seconds + ms / 1000;
        currentText = "";
        isFirstLineOfCue = true;
      } else if (
        line.trim() &&
        !line.startsWith("WEBVTT") &&
        !line.startsWith("Kind:") &&
        !line.startsWith("Language:") &&
        !line.match(/^\d+$/) &&
        !line.includes("-->")
      ) {
        // Text line (skip WEBVTT header, metadata, and cue numbers)
        // Only take the first line of each cue (YouTube shows 2 lines per cue)
        if (isFirstLineOfCue) {
          // Remove VTT formatting tags like <00:00:00.000><c>word</c>
          const cleanLine = line.replace(/<[^>]+>/g, "").trim();
          if (cleanLine) {
            currentText = cleanLine;
          }
          isFirstLineOfCue = false;
        }
      }
    }

    // Add final segment
    if (currentStart !== null && currentText.trim()) {
      segments.push({ start: currentStart, text: currentText.trim() });
    }

    // Deduplicate consecutive identical segments (common in auto-generated subs)
    const deduped: typeof segments = [];
    for (const seg of segments) {
      if (deduped.length === 0 || deduped[deduped.length - 1].text !== seg.text) {
        deduped.push(seg);
      }
    }

    const fullText = deduped.map((s) => s.text).join(" ");

    return { text: fullText, segments: deduped };
  } finally {
    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

interface DownloadProgress {
  status: "downloading" | "complete" | "error";
  percent?: number;
  speed?: string;
  eta?: string;
  filename?: string;
  error?: string;
}

/**
 * Download a video using yt-dlp
 */
function ytdlpDownload(
  videoIdOrUrl: string,
  outputDir: string = ".",
  options: {
    format?: string; // e.g., "best", "bestvideo+bestaudio", "mp4", "720p"
    audioOnly?: boolean;
    subtitles?: boolean;
    subLang?: string;
    filenameTemplate?: string;
  } = {}
): { filename: string; filepath: string } {
  checkYtDlp();

  const url = videoIdOrUrl.startsWith("http")
    ? videoIdOrUrl
    : `https://www.youtube.com/watch?v=${videoIdOrUrl}`;

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const args: string[] = [];

  // Format selection
  if (options.audioOnly) {
    args.push("-x", "--audio-format", "mp3");
  } else if (options.format) {
    if (options.format === "mp4") {
      args.push("-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best");
    } else if (options.format.match(/^\d+p$/)) {
      const height = options.format.replace("p", "");
      args.push("-f", `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]/best`);
    } else {
      args.push("-f", options.format);
    }
  }

  // Subtitles
  if (options.subtitles) {
    args.push("--write-auto-sub", "--write-sub");
    if (options.subLang) {
      args.push("--sub-lang", options.subLang);
    }
  }

  // Output template
  const template = options.filenameTemplate || "%(title)s [%(id)s].%(ext)s";
  const outputPath = path.join(outputDir, template);
  args.push("-o", outputPath);

  // Add URL
  args.push(url);

  // Run yt-dlp and capture output to get filename
  args.push("--print", "filename");

  const result = execSync(`yt-dlp ${args.map(a => `"${a}"`).join(" ")}`, {
    encoding: "utf-8",
    cwd: outputDir,
    maxBuffer: 10 * 1024 * 1024,
  });

  // The last non-empty line should be the filename
  const lines = result.trim().split("\n").filter(Boolean);
  const filename = lines[lines.length - 1];
  const filepath = path.isAbsolute(filename) ? filename : path.join(outputDir, filename);

  return { filename: path.basename(filepath), filepath };
}

/**
 * Download multiple videos (playlist or channel)
 */
function ytdlpDownloadPlaylist(
  playlistUrl: string,
  outputDir: string = ".",
  options: {
    format?: string;
    audioOnly?: boolean;
    maxDownloads?: number;
    startIndex?: number;
    endIndex?: number;
  } = {}
): { count: number; outputDir: string } {
  checkYtDlp();

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const args: string[] = [];

  // Format selection
  if (options.audioOnly) {
    args.push("-x", "--audio-format", "mp3");
  } else if (options.format) {
    args.push("-f", options.format);
  }

  // Playlist range
  if (options.startIndex) {
    args.push("--playlist-start", options.startIndex.toString());
  }
  if (options.endIndex) {
    args.push("--playlist-end", options.endIndex.toString());
  }
  if (options.maxDownloads) {
    args.push("--max-downloads", options.maxDownloads.toString());
  }

  // Output template with index
  const template = "%(playlist_index)s - %(title)s [%(id)s].%(ext)s";
  args.push("-o", path.join(outputDir, template));

  // Add URL
  args.push(playlistUrl);

  execSync(`yt-dlp ${args.map(a => `"${a}"`).join(" ")}`, {
    encoding: "utf-8",
    stdio: "inherit",
    maxBuffer: 50 * 1024 * 1024,
  });

  // Count downloaded files
  const files = fs.readdirSync(outputDir);
  return { count: files.length, outputDir: path.resolve(outputDir) };
}

async function getVideoComments(
  youtube: youtube_v3.Youtube,
  videoId: string,
  maxResults: number = 20
): Promise<CommentInfo[]> {
  const res = await youtube.commentThreads.list({
    part: ["snippet"],
    videoId,
    maxResults,
    order: "relevance",
  });

  return (res.data.items || []).map((thread) => {
    const comment = thread.snippet?.topLevelComment?.snippet;
    return {
      id: thread.id!,
      authorDisplayName: comment?.authorDisplayName || "",
      authorChannelId: comment?.authorChannelId?.value,
      textDisplay: comment?.textDisplay || "",
      textOriginal: comment?.textOriginal || "",
      likeCount: comment?.likeCount || 0,
      publishedAt: comment?.publishedAt || "",
      updatedAt: comment?.updatedAt || "",
    };
  });
}

// ============================================================================
// CLI
// ============================================================================

function printUsage(): void {
  console.log(`
YouTube CLI

COMMANDS (API - requires OAuth):
  channels                List your YouTube channels
  channel <channelId>     Get channel details
  videos                  List your videos
    --channel=ID          Channel ID (default: your channel)
    --max=N               Max results (default: 10)
  video <videoId>         Get video details
  playlists               List your playlists
    --max=N               Max results (default: 20)
  playlist <playlistId>   Get playlist items
    --max=N               Max results (default: 50)
  search                  Search YouTube
    --query=QUERY         Search query (required)
    --max=N               Max results (default: 10)
    --type=TYPE           Filter by: video, channel, playlist
  comments <videoId>      Get video comments
    --max=N               Max results (default: 20)

COMMANDS (yt-dlp - no auth required):
  dl-info <url|id>        Get video metadata (no auth)

  dl-channel <channel>    List videos from any channel
    --max=N               Max results (default: 20)
    Channel can be: @handle, channel ID, or full URL

  transcript <url|id>     Get video transcript/subtitles
    --lang=LANG           Language code (default: en)

  download <url|id>       Download a video
    --output=DIR          Output directory (default: .)
    --format=FMT          Format: best, mp4, 720p, 480p, etc.
    --audio-only          Extract audio as MP3
    --subtitles           Download subtitles too
    --sub-lang=LANG       Subtitle language (default: en)

  dl-playlist <url>       Download playlist/channel videos
    --output=DIR          Output directory (default: .)
    --format=FMT          Format selection
    --audio-only          Extract audio as MP3
    --max=N               Max videos to download
    --start=N             Start from video N
    --end=N               End at video N

EXAMPLES:
  # API examples (requires auth)
  npx tsx scripts/youtube.ts channels
  npx tsx scripts/youtube.ts search --query="typescript tutorial"
  npx tsx scripts/youtube.ts video dQw4w9WgXcQ

  # yt-dlp examples (no auth required)
  npx tsx scripts/youtube.ts dl-info dQw4w9WgXcQ
  npx tsx scripts/youtube.ts dl-channel @mkbhd --max=10
  npx tsx scripts/youtube.ts dl-channel UCXuqSBlHAE6Xw-yeJA0Tunw
  npx tsx scripts/youtube.ts transcript dQw4w9WgXcQ
  npx tsx scripts/youtube.ts transcript dQw4w9WgXcQ --lang=es
  npx tsx scripts/youtube.ts download dQw4w9WgXcQ --output=./videos
  npx tsx scripts/youtube.ts download dQw4w9WgXcQ --format=720p
  npx tsx scripts/youtube.ts download dQw4w9WgXcQ --audio-only
  npx tsx scripts/youtube.ts dl-playlist "https://youtube.com/playlist?list=PL..." --max=5

Credentials: ${CREDENTIALS_PATH}
Token:       .claude/google-skill.local.json (per-project)
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const { flags, positional } = parseArgs(args.slice(1));

  if (!command || command === "help" || command === "--help") {
    printUsage();
    process.exit(0);
  }

  try {
    // yt-dlp commands don't need OAuth
    const ytdlpCommands = ["dl-info", "dl-channel", "transcript", "download", "dl-playlist"];
    const needsAuth = !ytdlpCommands.includes(command);

    let youtube: youtube_v3.Youtube | null = null;
    if (needsAuth) {
      youtube = await getYouTubeClient();
    }

    switch (command) {
      case "channels": {
        const channels = await listMyChannels(youtube!);
        output({ success: true, data: { channels, count: channels.length } });
        break;
      }

      case "channel": {
        const channelId = positional[0];
        if (!channelId) fail("Channel ID required. Usage: youtube.ts channel <channelId>");
        const channel = await getChannel(youtube!, channelId);
        output({ success: true, data: channel });
        break;
      }

      case "videos": {
        const max = parseInt(flags.max || "10", 10);
        const channelId = flags.channel;
        const videos = await listMyVideos(youtube!, max, channelId);
        output({ success: true, data: { videos, count: videos.length } });
        break;
      }

      case "video": {
        const videoId = positional[0];
        if (!videoId) fail("Video ID required. Usage: youtube.ts video <videoId>");
        const video = await getVideo(youtube!, videoId);
        output({ success: true, data: video });
        break;
      }

      case "playlists": {
        const max = parseInt(flags.max || "20", 10);
        const playlists = await listMyPlaylists(youtube!);
        output({ success: true, data: { playlists, count: playlists.length } });
        break;
      }

      case "playlist": {
        const playlistId = positional[0];
        if (!playlistId) fail("Playlist ID required. Usage: youtube.ts playlist <playlistId>");
        const max = parseInt(flags.max || "50", 10);
        const items = await getPlaylistItems(youtube!, playlistId, max);
        output({ success: true, data: { items, count: items.length } });
        break;
      }

      case "search": {
        const query = flags.query;
        if (!query) fail("Query required. Usage: youtube.ts search --query=QUERY");
        const max = parseInt(flags.max || "10", 10);
        const type = flags.type as "video" | "channel" | "playlist" | undefined;
        const results = await searchYouTube(youtube!, query, max, type);
        output({ success: true, data: { results, count: results.length } });
        break;
      }

      case "comments": {
        const videoId = positional[0];
        if (!videoId) fail("Video ID required. Usage: youtube.ts comments <videoId>");
        const max = parseInt(flags.max || "20", 10);
        const comments = await getVideoComments(youtube!, videoId, max);
        output({ success: true, data: { comments, count: comments.length } });
        break;
      }

      // yt-dlp commands (no auth required)
      case "dl-info": {
        const videoId = positional[0];
        if (!videoId) fail("Video ID or URL required. Usage: youtube.ts dl-info <url|id>");
        const info = ytdlpGetVideoInfo(videoId);
        output({
          success: true,
          data: {
            id: info.id,
            title: info.title,
            description: info.description,
            uploadDate: info.upload_date,
            duration: info.duration,
            viewCount: info.view_count,
            likeCount: info.like_count,
            channel: info.channel,
            channelId: info.channel_id,
            thumbnail: info.thumbnail,
            url: info.webpage_url,
            categories: info.categories,
            tags: info.tags,
          },
        });
        break;
      }

      case "dl-channel": {
        const channelRef = positional[0];
        if (!channelRef) fail("Channel handle, ID, or URL required. Usage: youtube.ts dl-channel <channel>");
        const max = parseInt(flags.max || "20", 10);
        const videos = ytdlpListChannelVideos(channelRef, max);
        output({
          success: true,
          data: {
            videos: videos.map((v) => ({
              id: v.id,
              title: v.title,
              duration: v.duration,
              viewCount: v.view_count,
              url: v.webpage_url || `https://www.youtube.com/watch?v=${v.id}`,
            })),
            count: videos.length,
          },
        });
        break;
      }

      case "transcript": {
        const videoId = positional[0];
        if (!videoId) fail("Video ID or URL required. Usage: youtube.ts transcript <url|id>");
        const lang = flags.lang || "en";
        const transcript = ytdlpGetTranscript(videoId, lang);
        output({
          success: true,
          data: {
            language: lang,
            text: transcript.text,
            segments: transcript.segments,
            segmentCount: transcript.segments?.length || 0,
          },
        });
        break;
      }

      case "download": {
        const videoId = positional[0];
        if (!videoId) fail("Video ID or URL required. Usage: youtube.ts download <url|id>");
        const result = ytdlpDownload(videoId, flags.output || ".", {
          format: flags.format,
          audioOnly: "audio-only" in flags,
          subtitles: "subtitles" in flags,
          subLang: flags["sub-lang"],
        });
        output({
          success: true,
          data: {
            filename: result.filename,
            filepath: result.filepath,
          },
        });
        break;
      }

      case "dl-playlist": {
        const playlistUrl = positional[0];
        if (!playlistUrl) fail("Playlist URL required. Usage: youtube.ts dl-playlist <url>");
        const result = ytdlpDownloadPlaylist(playlistUrl, flags.output || ".", {
          format: flags.format,
          audioOnly: "audio-only" in flags,
          maxDownloads: flags.max ? parseInt(flags.max, 10) : undefined,
          startIndex: flags.start ? parseInt(flags.start, 10) : undefined,
          endIndex: flags.end ? parseInt(flags.end, 10) : undefined,
        });
        output({
          success: true,
          data: {
            downloadedCount: result.count,
            outputDir: result.outputDir,
          },
        });
        break;
      }

      default:
        output({ success: false, error: `Unknown command: ${command}. Run with --help for usage.` });
        process.exit(1);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    fail(message);
  }
}

main();
