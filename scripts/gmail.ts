#!/usr/bin/env npx tsx

import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import http from "node:http";
import { google, gmail_v1, calendar_v3 } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import open from "open";

// ============================================================================
// Configuration
// ============================================================================

// Global config for OAuth client credentials (same across all projects)
function getGlobalConfigDir(): string {
  const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(xdgConfig, "gmail-skill");
}

const GLOBAL_CONFIG_DIR = getGlobalConfigDir();
const CREDENTIALS_PATH = path.join(GLOBAL_CONFIG_DIR, "credentials.json");

// Project-local token storage (different Google account per project)
const PROJECT_TOKEN_DIR = ".claude";
const PROJECT_TOKEN_FILE = "gmail-skill.local.json";

function getProjectTokenPath(): string {
  return path.join(process.cwd(), PROJECT_TOKEN_DIR, PROJECT_TOKEN_FILE);
}

// Legacy global token path (for backwards compatibility)
function getGlobalTokenPath(): string {
  return path.join(GLOBAL_CONFIG_DIR, "token.json");
}

// All scopes we need
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
];

// ============================================================================
// Output helpers
// ============================================================================

interface CommandResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

function output(result: CommandResult): void {
  console.log(JSON.stringify(result, null, 2));
}

function fail(error: string): never {
  output({ success: false, error });
  process.exit(1);
}

// ============================================================================
// Setup Instructions
// ============================================================================

const SETUP_INSTRUCTIONS = `
═══════════════════════════════════════════════════════════════════════════════
                         GMAIL SKILL - FIRST TIME SETUP
═══════════════════════════════════════════════════════════════════════════════

This skill needs Google OAuth credentials to access Gmail and Calendar.

CREDENTIALS (one-time setup, shared across all projects):
  ${CREDENTIALS_PATH}

TOKENS (per-project, stores which Google account to use):
  .claude/gmail-skill.local.json (in your project directory)

STEP 1: Create a Google Cloud Project
──────────────────────────────────────
1. Go to: https://console.cloud.google.com/
2. Click the project dropdown (top left) → "New Project"
3. Name it anything (e.g., "Gmail Skill") → Create
4. Wait for it to be created, then select it

STEP 2: Enable the APIs
───────────────────────
1. Go to: https://console.cloud.google.com/apis/library
2. Search "Gmail API" → Click it → Enable
3. Search "Google Calendar API" → Click it → Enable

STEP 3: Configure OAuth Consent Screen
──────────────────────────────────────
1. Go to: https://console.cloud.google.com/apis/credentials/consent
2. Select "External" → Create
3. Fill in:
   - App name: Gmail Skill (or anything)
   - User support email: your email
   - Developer contact: your email
4. Click "Save and Continue"
5. Click "Add or Remove Scopes" → Add these scopes:
   - https://www.googleapis.com/auth/gmail.readonly
   - https://www.googleapis.com/auth/gmail.send
   - https://www.googleapis.com/auth/gmail.modify
   - https://www.googleapis.com/auth/calendar.readonly
   - https://www.googleapis.com/auth/calendar.events
6. Click "Update" → "Save and Continue"
7. Add your email as a test user → "Save and Continue"
8. Click "Back to Dashboard"

STEP 4: Create OAuth Credentials
────────────────────────────────
1. Go to: https://console.cloud.google.com/apis/credentials
2. Click "Create Credentials" → "OAuth client ID"
3. Application type: "Desktop app"
4. Name: anything (e.g., "Gmail Skill CLI")
5. Click "Create"
6. Click "Download JSON"
7. Save the file to: ${CREDENTIALS_PATH}

   Or copy the values and create the file manually:
   {
     "installed": {
       "client_id": "YOUR_CLIENT_ID.apps.googleusercontent.com",
       "client_secret": "YOUR_CLIENT_SECRET"
     }
   }

STEP 5: Run auth again
──────────────────────
Once credentials.json is in place, run:
  npx tsx scripts/gmail.ts auth

This will open a browser to authenticate with Google. The token will be saved
to your project's .claude/ directory, allowing different projects to use
different Google accounts.

═══════════════════════════════════════════════════════════════════════════════
`;

// ============================================================================
// Authentication
// ============================================================================

interface Credentials {
  client_id: string;
  client_secret: string;
}

async function loadCredentials(): Promise<Credentials> {
  try {
    const content = await fs.readFile(CREDENTIALS_PATH, "utf-8");
    const data = JSON.parse(content);

    // Handle both formats: {installed: {client_id, client_secret}} or {client_id, client_secret}
    const creds = data.installed || data.web || data;

    if (!creds.client_id || !creds.client_secret) {
      throw new Error("Missing client_id or client_secret");
    }

    return {
      client_id: creds.client_id,
      client_secret: creds.client_secret,
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      console.error(SETUP_INSTRUCTIONS);
      fail(`Credentials not found at ${CREDENTIALS_PATH}`);
    }
    throw err;
  }
}

async function findTokenPath(): Promise<string | null> {
  // Check project-local first
  const projectPath = getProjectTokenPath();
  try {
    await fs.access(projectPath);
    return projectPath;
  } catch {
    // Not found in project
  }

  // Fall back to global (legacy location)
  const globalPath = getGlobalTokenPath();
  try {
    await fs.access(globalPath);
    return globalPath;
  } catch {
    // Not found anywhere
  }

  return null;
}

async function loadToken(): Promise<OAuth2Client> {
  const credentials = await loadCredentials();
  const tokenPath = await findTokenPath();

  if (!tokenPath) {
    fail(
      `Token not found. Run: npx tsx scripts/gmail.ts auth\n` +
      `Token will be saved to: ${getProjectTokenPath()}`
    );
  }

  try {
    const content = await fs.readFile(tokenPath, "utf-8");
    const tokenData = JSON.parse(content);

    const oauth2Client = new google.auth.OAuth2(
      credentials.client_id,
      credentials.client_secret,
      "http://localhost:3000/callback"
    );

    oauth2Client.setCredentials({
      refresh_token: tokenData.refresh_token,
    });

    return oauth2Client;
  } catch (err) {
    fail(`Failed to load token from ${tokenPath}: ${(err as Error).message}`);
  }
}

async function ensureGitignore(): Promise<void> {
  const gitignorePath = path.join(process.cwd(), ".gitignore");
  const pattern = ".claude/*.local.*";

  try {
    const content = await fs.readFile(gitignorePath, "utf-8");
    if (content.includes(pattern)) {
      return; // Already configured
    }
    // Append the pattern
    const newContent = content.endsWith("\n")
      ? content + `\n# Gmail skill tokens (per-project auth)\n${pattern}\n`
      : content + `\n\n# Gmail skill tokens (per-project auth)\n${pattern}\n`;
    await fs.writeFile(gitignorePath, newContent);
    console.error(`✓ Added ${pattern} to .gitignore`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      // No .gitignore, create one
      await fs.writeFile(gitignorePath, `# Gmail skill tokens (per-project auth)\n${pattern}\n`);
      console.error(`✓ Created .gitignore with ${pattern}`);
    } else {
      throw err;
    }
  }
}

async function performAuth(): Promise<void> {
  const credentials = await loadCredentials();
  const tokenPath = getProjectTokenPath();
  const tokenDir = path.dirname(tokenPath);

  // Ensure .claude directory exists
  await fs.mkdir(tokenDir, { recursive: true });

  // Ensure .gitignore is configured to exclude tokens
  await ensureGitignore();

  const oauth2Client = new google.auth.OAuth2(
    credentials.client_id,
    credentials.client_secret,
    "http://localhost:3000/callback"
  );

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });

  console.error("\nOpening browser for authentication...");
  console.error("If browser doesn't open, visit:\n", authUrl, "\n");

  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url!, `http://localhost:3000`);
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      if (error) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(`<h1>Error: ${error}</h1><p>You can close this window.</p>`);
        server.close();
        reject(new Error(error));
        return;
      }

      if (code) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <html>
            <body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;">
              <div style="text-align: center;">
                <h1 style="color: #22c55e;">✓ Authentication Successful!</h1>
                <p>You can close this window and return to the terminal.</p>
              </div>
            </body>
          </html>
        `);
        server.close();
        resolve(code);
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.listen(3000, () => {
      open(authUrl).catch(() => {
        console.error("Could not open browser automatically.");
      });
    });

    setTimeout(() => {
      server.close();
      reject(new Error("Authentication timeout (5 minutes)"));
    }, 300000);
  });

  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.refresh_token) {
    fail(
      "No refresh token received.\n" +
      "This can happen if you've already authorized this app.\n" +
      "Fix: Go to https://myaccount.google.com/permissions\n" +
      "     Remove access for this app, then run auth again."
    );
  }

  const tokenData = {
    refresh_token: tokens.refresh_token,
    scope: tokens.scope,
    token_type: tokens.token_type,
  };

  await fs.writeFile(tokenPath, JSON.stringify(tokenData, null, 2));
  console.error(`\n✓ Token saved to ${tokenPath}`);
}

// ============================================================================
// Gmail Operations
// ============================================================================

async function getGmailClient(): Promise<gmail_v1.Gmail> {
  const auth = await loadToken();
  return google.gmail({ version: "v1", auth });
}

interface MessageSummary {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  snippet: string;
  labelIds: string[];
}

async function listMessages(
  gmail: gmail_v1.Gmail,
  query: string = "",
  maxResults: number = 10
): Promise<MessageSummary[]> {
  const res = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults,
  });

  const messages = res.data.messages || [];
  const summaries: MessageSummary[] = [];

  for (const msg of messages) {
    const detail = await gmail.users.messages.get({
      userId: "me",
      id: msg.id!,
      format: "metadata",
      metadataHeaders: ["Subject", "From", "To", "Date"],
    });

    const headers = detail.data.payload?.headers || [];
    const getHeader = (name: string) =>
      headers.find((h) => h.name === name)?.value || "";

    summaries.push({
      id: msg.id!,
      threadId: msg.threadId!,
      subject: getHeader("Subject"),
      from: getHeader("From"),
      to: getHeader("To"),
      date: getHeader("Date"),
      snippet: detail.data.snippet || "",
      labelIds: detail.data.labelIds || [],
    });
  }

  return summaries;
}

interface FullMessage extends MessageSummary {
  body: string;
  htmlBody?: string;
}

function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf-8");
}

function extractBody(
  payload: gmail_v1.Schema$MessagePart | undefined
): { text: string; html?: string } {
  if (!payload) return { text: "" };

  if (payload.body?.data) {
    const content = decodeBase64Url(payload.body.data);
    if (payload.mimeType === "text/html") {
      return { text: "", html: content };
    }
    return { text: content };
  }

  if (payload.parts) {
    let text = "";
    let html: string | undefined;

    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        text = decodeBase64Url(part.body.data);
      } else if (part.mimeType === "text/html" && part.body?.data) {
        html = decodeBase64Url(part.body.data);
      } else if (part.parts) {
        const nested = extractBody(part);
        if (nested.text) text = nested.text;
        if (nested.html) html = nested.html;
      }
    }

    return { text, html };
  }

  return { text: "" };
}

async function readMessage(
  gmail: gmail_v1.Gmail,
  messageId: string
): Promise<FullMessage> {
  const res = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });

  const headers = res.data.payload?.headers || [];
  const getHeader = (name: string) =>
    headers.find((h) => h.name === name)?.value || "";

  const { text, html } = extractBody(res.data.payload);

  return {
    id: res.data.id!,
    threadId: res.data.threadId!,
    subject: getHeader("Subject"),
    from: getHeader("From"),
    to: getHeader("To"),
    date: getHeader("Date"),
    snippet: res.data.snippet || "",
    labelIds: res.data.labelIds || [],
    body: text,
    htmlBody: html,
  };
}

interface Attachment {
  filename: string;
  content: Buffer;
  mimeType: string;
  isInline?: boolean;
  contentId?: string;
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.txt': 'text/plain',
    '.html': 'text/html',
    '.csv': 'text/csv',
    '.json': 'application/json',
    '.zip': 'application/zip',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

async function loadAttachment(filePath: string): Promise<Attachment> {
  const content = await fs.readFile(filePath);
  const filename = path.basename(filePath);
  const mimeType = getMimeType(filePath);
  return { filename, content, mimeType };
}

async function loadInlineImage(filePath: string, contentId: string): Promise<Attachment> {
  const content = await fs.readFile(filePath);
  const filename = path.basename(filePath);
  const mimeType = getMimeType(filePath);
  return { filename, content, mimeType, isInline: true, contentId };
}

function createRawMessage(
  to: string,
  subject: string,
  body: string,
  from?: string,
  html?: string,
  attachments?: Attachment[],
  inlineImages?: Attachment[]
): string {
  const nl = "\r\n";
  const ts = Date.now();
  const mixedBoundary = `____mixed_${ts}____`;
  const altBoundary = `____alt_${ts}____`;
  const relatedBoundary = `____related_${ts}____`;

  const hasAttachments = attachments && attachments.length > 0;
  const hasInlineImages = inlineImages && inlineImages.length > 0;
  const hasHtml = !!html;

  let message: string;

  if (hasAttachments && hasHtml && hasInlineImages) {
    // HTML with inline images AND file attachments
    const headers = [
      `MIME-Version: 1.0`,
      `To: ${to}`,
      from ? `From: ${from}` : null,
      `Subject: ${subject}`,
      `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    ].filter(Boolean).join(nl);

    // multipart/related for HTML + inline images
    const relatedHeader = [
      `--${mixedBoundary}`,
      `Content-Type: multipart/related; boundary="${relatedBoundary}"`,
    ].join(nl);

    const htmlPart = [
      `--${relatedBoundary}`,
      `Content-Type: text/html; charset="UTF-8"`,
      ``,
      html,
    ].join(nl);

    const inlineParts = inlineImages!.map(img => {
      const base64Content = img.content.toString("base64").match(/.{1,76}/g)?.join(nl) || "";
      return [
        `--${relatedBoundary}`,
        `Content-Type: ${img.mimeType}; name="${img.filename}"`,
        `Content-Transfer-Encoding: base64`,
        `Content-Disposition: inline; filename="${img.filename}"`,
        `Content-ID: <${img.contentId}>`,
        ``,
        base64Content,
      ].join(nl);
    }).join(nl);

    const attachmentParts = attachments!.map(att => {
      const base64Content = att.content.toString("base64").match(/.{1,76}/g)?.join(nl) || "";
      return [
        `--${mixedBoundary}`,
        `Content-Type: ${att.mimeType}; name="${att.filename}"`,
        `Content-Disposition: attachment; filename="${att.filename}"`,
        `Content-Transfer-Encoding: base64`,
        ``,
        base64Content,
      ].join(nl);
    }).join(nl);

    message = headers + nl + nl + relatedHeader + nl + nl + htmlPart + nl + inlineParts + nl + `--${relatedBoundary}--` + nl + attachmentParts + nl + `--${mixedBoundary}--`;

  } else if (hasAttachments && hasHtml) {
    // HTML + attachments, no inline images
    const headers = [
      `MIME-Version: 1.0`,
      `To: ${to}`,
      from ? `From: ${from}` : null,
      `Subject: ${subject}`,
      `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    ].filter(Boolean).join(nl);

    const altHeader = [
      `--${mixedBoundary}`,
      `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    ].join(nl);

    const textPart = [
      `--${altBoundary}`,
      `Content-Type: text/plain; charset="UTF-8"`,
      ``,
      body,
    ].join(nl);

    const htmlPart = [
      `--${altBoundary}`,
      `Content-Type: text/html; charset="UTF-8"`,
      ``,
      html,
    ].join(nl);

    const attachmentParts = attachments!.map(att => {
      const base64Content = att.content.toString("base64").match(/.{1,76}/g)?.join(nl) || "";
      return [
        `--${mixedBoundary}`,
        `Content-Type: ${att.mimeType}; name="${att.filename}"`,
        `Content-Disposition: attachment; filename="${att.filename}"`,
        `Content-Transfer-Encoding: base64`,
        ``,
        base64Content,
      ].join(nl);
    }).join(nl);

    message = headers + nl + nl + altHeader + nl + nl + textPart + nl + htmlPart + nl + `--${altBoundary}--` + nl + attachmentParts + nl + `--${mixedBoundary}--`;

  } else if (hasAttachments) {
    // Attachments only, no HTML
    const headers = [
      `MIME-Version: 1.0`,
      `To: ${to}`,
      from ? `From: ${from}` : null,
      `Subject: ${subject}`,
      `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    ].filter(Boolean).join(nl);

    const textPart = [
      `--${mixedBoundary}`,
      `Content-Type: text/plain; charset="UTF-8"`,
      ``,
      body,
    ].join(nl);

    const attachmentParts = attachments!.map(att => {
      const base64Content = att.content.toString("base64").match(/.{1,76}/g)?.join(nl) || "";
      return [
        `--${mixedBoundary}`,
        `Content-Type: ${att.mimeType}; name="${att.filename}"`,
        `Content-Disposition: attachment; filename="${att.filename}"`,
        `Content-Transfer-Encoding: base64`,
        ``,
        base64Content,
      ].join(nl);
    }).join(nl);

    message = headers + nl + nl + textPart + nl + attachmentParts + nl + `--${mixedBoundary}--`;

  } else if (hasHtml && hasInlineImages) {
    // HTML with inline images, no file attachments
    const headers = [
      `MIME-Version: 1.0`,
      `To: ${to}`,
      from ? `From: ${from}` : null,
      `Subject: ${subject}`,
      `Content-Type: multipart/related; boundary="${relatedBoundary}"`,
    ].filter(Boolean).join(nl);

    const htmlPart = [
      `--${relatedBoundary}`,
      `Content-Type: text/html; charset="UTF-8"`,
      ``,
      html,
    ].join(nl);

    const inlineParts = inlineImages!.map(img => {
      const base64Content = img.content.toString("base64").match(/.{1,76}/g)?.join(nl) || "";
      return [
        `--${relatedBoundary}`,
        `Content-Type: ${img.mimeType}; name="${img.filename}"`,
        `Content-Transfer-Encoding: base64`,
        `Content-Disposition: inline; filename="${img.filename}"`,
        `Content-ID: <${img.contentId}>`,
        ``,
        base64Content,
      ].join(nl);
    }).join(nl);

    message = headers + nl + nl + htmlPart + nl + inlineParts + nl + `--${relatedBoundary}--`;

  } else if (hasHtml) {
    // HTML only
    const headers = [
      `MIME-Version: 1.0`,
      `To: ${to}`,
      from ? `From: ${from}` : null,
      `Subject: ${subject}`,
      `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    ].filter(Boolean).join(nl);

    const textPart = [
      `--${altBoundary}`,
      `Content-Type: text/plain; charset="UTF-8"`,
      ``,
      body,
    ].join(nl);

    const htmlPart = [
      `--${altBoundary}`,
      `Content-Type: text/html; charset="UTF-8"`,
      ``,
      html,
    ].join(nl);

    message = headers + nl + nl + textPart + nl + htmlPart + nl + `--${altBoundary}--`;

  } else {
    // Plain text only
    message = [
      `MIME-Version: 1.0`,
      `To: ${to}`,
      from ? `From: ${from}` : null,
      `Subject: ${subject}`,
      `Content-Type: text/plain; charset="UTF-8"`,
      ``,
      body,
    ].filter(Boolean).join(nl);
  }

  return Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function sendMessage(
  gmail: gmail_v1.Gmail,
  to: string,
  subject: string,
  body: string,
  html?: string,
  attachmentPaths?: string[],
  inlineImagePaths?: { path: string; cid: string }[]
): Promise<{ id: string; threadId: string }> {
  let attachments: Attachment[] | undefined;
  let inlineImages: Attachment[] | undefined;

  if (attachmentPaths && attachmentPaths.length > 0) {
    attachments = await Promise.all(attachmentPaths.map(loadAttachment));
  }

  if (inlineImagePaths && inlineImagePaths.length > 0) {
    inlineImages = await Promise.all(
      inlineImagePaths.map(img => loadInlineImage(img.path, img.cid))
    );
  }

  const raw = createRawMessage(to, subject, body, undefined, html, attachments, inlineImages);

  const res = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw },
  });

  return {
    id: res.data.id!,
    threadId: res.data.threadId!,
  };
}

async function listLabels(
  gmail: gmail_v1.Gmail
): Promise<{ id: string; name: string; type: string }[]> {
  const res = await gmail.users.labels.list({ userId: "me" });
  return (res.data.labels || []).map((l) => ({
    id: l.id!,
    name: l.name!,
    type: l.type || "user",
  }));
}

async function modifyLabels(
  gmail: gmail_v1.Gmail,
  messageId: string,
  addLabelIds: string[],
  removeLabelIds: string[]
): Promise<void> {
  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: {
      addLabelIds,
      removeLabelIds,
    },
  });
}

async function getProfile(gmail: gmail_v1.Gmail): Promise<{
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
}> {
  const res = await gmail.users.getProfile({ userId: "me" });
  return {
    emailAddress: res.data.emailAddress!,
    messagesTotal: res.data.messagesTotal || 0,
    threadsTotal: res.data.threadsTotal || 0,
  };
}

async function downloadMessageAsEml(
  gmail: gmail_v1.Gmail,
  messageId: string,
  outputPath?: string
): Promise<{ path: string; size: number }> {
  // Fetch the raw RFC 2822 formatted message
  const res = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "raw",
  });

  if (!res.data.raw) {
    throw new Error("No raw message data returned from Gmail API");
  }

  // Decode from base64url to binary
  const rawMessage = Buffer.from(res.data.raw, "base64url");

  // Determine output path
  let finalPath: string;
  if (outputPath) {
    finalPath = outputPath;
  } else {
    // Generate filename from message ID
    finalPath = `${messageId}.eml`;
  }

  // Write the EML file
  await fs.writeFile(finalPath, rawMessage);

  return {
    path: finalPath,
    size: rawMessage.length,
  };
}

// ============================================================================
// Calendar Operations
// ============================================================================

async function getCalendarClient(): Promise<calendar_v3.Calendar> {
  const auth = await loadToken();
  return google.calendar({ version: "v3", auth });
}

interface CalendarSummary {
  id: string;
  summary: string;
  description?: string;
  primary?: boolean;
  backgroundColor?: string;
}

async function listCalendars(
  calendar: calendar_v3.Calendar
): Promise<CalendarSummary[]> {
  const res = await calendar.calendarList.list();
  return (res.data.items || []).map((c) => ({
    id: c.id!,
    summary: c.summary || "",
    description: c.description,
    primary: c.primary,
    backgroundColor: c.backgroundColor,
  }));
}

interface EventSummary {
  id: string;
  summary: string;
  description?: string;
  start: string;
  end: string;
  location?: string;
  attendees?: string[];
  htmlLink?: string;
}

async function listEvents(
  calendar: calendar_v3.Calendar,
  calendarId: string = "primary",
  maxResults: number = 10,
  timeMin?: string,
  timeMax?: string
): Promise<EventSummary[]> {
  const params: calendar_v3.Params$Resource$Events$List = {
    calendarId,
    maxResults,
    singleEvents: true,
    orderBy: "startTime",
  };

  if (timeMin) params.timeMin = timeMin;
  else params.timeMin = new Date().toISOString();

  if (timeMax) params.timeMax = timeMax;

  const res = await calendar.events.list(params);
  return (res.data.items || []).map((e) => ({
    id: e.id!,
    summary: e.summary || "(No title)",
    description: e.description,
    start: e.start?.dateTime || e.start?.date || "",
    end: e.end?.dateTime || e.end?.date || "",
    location: e.location,
    attendees: e.attendees?.map((a) => a.email || "").filter(Boolean),
    htmlLink: e.htmlLink,
  }));
}

async function getEvent(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  eventId: string
): Promise<EventSummary> {
  const res = await calendar.events.get({ calendarId, eventId });
  const e = res.data;
  return {
    id: e.id!,
    summary: e.summary || "(No title)",
    description: e.description,
    start: e.start?.dateTime || e.start?.date || "",
    end: e.end?.dateTime || e.end?.date || "",
    location: e.location,
    attendees: e.attendees?.map((a) => a.email || "").filter(Boolean),
    htmlLink: e.htmlLink,
  };
}

async function createEvent(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  summary: string,
  start: string,
  end: string,
  description?: string,
  location?: string,
  attendees?: string[]
): Promise<EventSummary> {
  const event: calendar_v3.Schema$Event = {
    summary,
    description,
    location,
    start: start.includes("T")
      ? { dateTime: start, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }
      : { date: start },
    end: end.includes("T")
      ? { dateTime: end, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }
      : { date: end },
  };

  if (attendees?.length) {
    event.attendees = attendees.map((email) => ({ email }));
  }

  const res = await calendar.events.insert({
    calendarId,
    requestBody: event,
  });

  const e = res.data;
  return {
    id: e.id!,
    summary: e.summary || "",
    description: e.description,
    start: e.start?.dateTime || e.start?.date || "",
    end: e.end?.dateTime || e.end?.date || "",
    location: e.location,
    attendees: e.attendees?.map((a) => a.email || "").filter(Boolean),
    htmlLink: e.htmlLink,
  };
}

async function deleteEvent(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  eventId: string
): Promise<void> {
  await calendar.events.delete({ calendarId, eventId });
}

// ============================================================================
// CLI
// ============================================================================

function parseArgs(args: string[]): { flags: Record<string, string>; positional: string[] } {
  const flags: Record<string, string> = {};
  const positional: string[] = [];

  for (const arg of args) {
    if (arg.startsWith("--")) {
      const [key, ...valueParts] = arg.slice(2).split("=");
      flags[key] = valueParts.join("=") || "true";
    } else {
      positional.push(arg);
    }
  }

  return { flags, positional };
}

function printUsage(): void {
  console.log(`
Gmail & Calendar CLI

SETUP:
  auth                    Authenticate with Google (opens browser)

GMAIL:
  list                    List messages
    --query=QUERY         Search query (Gmail syntax)
    --max=N               Max results (default: 10)
  read ID                 Read a message by ID
  send                    Send an email
    --to=EMAIL            Recipient (required)
    --subject=TEXT        Subject (required)
    --body=TEXT           Body (required)
    --html=HTML           HTML body (optional)
    --attachment=PATH     File to attach (optional, comma-separated for multiple)
  labels                  List all labels
  label ID                Modify labels on a message
    --add=LABEL           Add label
    --remove=LABEL        Remove label
  download ID             Download message as EML file
    --output=PATH         Output file path (default: <id>.eml)

CALENDAR:
  calendars               List all calendars
  events                  List upcoming events
    --calendar=ID         Calendar ID (default: primary)
    --max=N               Max results (default: 10)
    --from=ISO_DATE       Start time (default: now)
    --to=ISO_DATE         End time
  event ID                Get event details
    --calendar=ID         Calendar ID (default: primary)
  create                  Create an event
    --calendar=ID         Calendar ID (default: primary)
    --summary=TEXT        Event title (required)
    --start=ISO_DATE      Start time (required)
    --end=ISO_DATE        End time (required)
    --description=TEXT    Description
    --location=TEXT       Location
    --attendees=A,B,C     Comma-separated emails
  delete ID               Delete an event
    --calendar=ID         Calendar ID (default: primary)

OTHER:
  check                   Verify authentication
  profile                 Show Gmail profile

Credentials: ${CREDENTIALS_PATH}
Token:       .claude/gmail-skill.local.json (per-project)
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
    switch (command) {
      // ── Auth ──────────────────────────────────────────────────────────────
      case "auth": {
        await performAuth();
        output({ success: true, data: { message: "Authentication successful", tokenPath: getProjectTokenPath() } });
        break;
      }

      case "check": {
        const gmail = await getGmailClient();
        const profile = await getProfile(gmail);
        const tokenPath = await findTokenPath();
        output({
          success: true,
          data: {
            message: "Authenticated",
            email: profile.emailAddress,
            tokenPath: tokenPath,
            credentialsPath: CREDENTIALS_PATH,
          },
        });
        break;
      }

      case "profile": {
        const gmail = await getGmailClient();
        const profile = await getProfile(gmail);
        output({ success: true, data: profile });
        break;
      }

      // ── Gmail ─────────────────────────────────────────────────────────────
      case "list": {
        const gmail = await getGmailClient();
        const query = flags.query || "";
        const max = parseInt(flags.max || "10", 10);
        const messages = await listMessages(gmail, query, max);
        output({ success: true, data: { messages, count: messages.length } });
        break;
      }

      case "read": {
        const messageId = positional[0];
        if (!messageId) fail("Message ID required. Usage: gmail.ts read <message-id>");
        const gmail = await getGmailClient();
        const message = await readMessage(gmail, messageId);
        output({ success: true, data: message });
        break;
      }

      case "send": {
        const { to, subject, body, html, attachment } = flags;
        const inlineFlag = flags["inline"];
        if (!to || !subject || !body) fail("Required: --to, --subject, --body [--html=<html-content>] [--attachment=<path>] [--inline=<path>:<cid>,...]");
        const gmail = await getGmailClient();
        const attachmentPaths = attachment ? attachment.split(",").map(p => p.trim()) : undefined;
        // Parse inline images: --inline="/path/to/img.png:myimage,/path/to/other.jpg:otherimg"
        let inlineImages: { path: string; cid: string }[] | undefined;
        if (inlineFlag) {
          inlineImages = inlineFlag.split(",").map((item: string) => {
            const [imgPath, cid] = item.trim().split(":");
            return { path: imgPath, cid };
          });
        }
        const result = await sendMessage(gmail, to, subject, body, html, attachmentPaths, inlineImages);
        const hasAttachment = attachmentPaths && attachmentPaths.length > 0;
        const hasInline = inlineImages && inlineImages.length > 0;
        output({ success: true, data: { ...result, message: hasAttachment || hasInline ? "Email sent with attachment(s)" : (html ? "HTML email sent" : "Email sent") } });
        break;
      }

      case "labels": {
        const gmail = await getGmailClient();
        const labels = await listLabels(gmail);
        output({ success: true, data: { labels } });
        break;
      }

      case "label": {
        const messageId = positional[0];
        if (!messageId) fail("Message ID required");
        const gmail = await getGmailClient();
        const addLabels = flags.add ? flags.add.split(",") : [];
        const removeLabels = flags.remove ? flags.remove.split(",") : [];
        await modifyLabels(gmail, messageId, addLabels, removeLabels);
        output({ success: true, data: { message: "Labels updated" } });
        break;
      }

      case "download": {
        const messageId = positional[0];
        if (!messageId) fail("Message ID required. Usage: gmail.ts download <message-id> [--output=path.eml]");
        const gmail = await getGmailClient();
        const result = await downloadMessageAsEml(gmail, messageId, flags.output);
        output({ success: true, data: { ...result, message: "Message downloaded as EML" } });
        break;
      }

      // ── Calendar ──────────────────────────────────────────────────────────
      case "calendars": {
        const cal = await getCalendarClient();
        const calendars = await listCalendars(cal);
        output({ success: true, data: { calendars } });
        break;
      }

      case "events": {
        const cal = await getCalendarClient();
        const calendarId = flags.calendar || "primary";
        const max = parseInt(flags.max || "10", 10);
        const events = await listEvents(cal, calendarId, max, flags.from, flags.to);
        output({ success: true, data: { events, count: events.length } });
        break;
      }

      case "event": {
        const eventId = positional[0];
        if (!eventId) fail("Event ID required");
        const cal = await getCalendarClient();
        const calendarId = flags.calendar || "primary";
        const event = await getEvent(cal, calendarId, eventId);
        output({ success: true, data: event });
        break;
      }

      case "create": {
        const { summary, start, end, description, location, attendees } = flags;
        if (!summary || !start || !end) fail("Required: --summary, --start, --end");
        const cal = await getCalendarClient();
        const calendarId = flags.calendar || "primary";
        const attendeeList = attendees ? attendees.split(",").map((e) => e.trim()) : undefined;
        const event = await createEvent(cal, calendarId, summary, start, end, description, location, attendeeList);
        output({ success: true, data: { ...event, message: "Event created" } });
        break;
      }

      case "delete": {
        const eventId = positional[0];
        if (!eventId) fail("Event ID required");
        const cal = await getCalendarClient();
        const calendarId = flags.calendar || "primary";
        await deleteEvent(cal, calendarId, eventId);
        output({ success: true, data: { message: "Event deleted" } });
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
