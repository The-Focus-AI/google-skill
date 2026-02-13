#!/usr/bin/env npx tsx

import path from "node:path";
import fs from "node:fs/promises";
import { readdirSync } from "node:fs";
import { google, gmail_v1, calendar_v3 } from "googleapis";

import {
  loadToken,
  performAuth,
  findTokenPath,
  getProjectTokenPath,
  CREDENTIALS_PATH,
  getGlobalConfigDir,
} from "../../../scripts/lib/auth.js";

import { output, fail, parseArgs } from "../../../scripts/lib/output.js";

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

async function createDraft(
  gmail: gmail_v1.Gmail,
  to: string,
  subject: string,
  body: string,
  html?: string,
  attachmentPaths?: string[],
  inlineImagePaths?: { path: string; cid: string }[]
): Promise<{ id: string; messageId: string }> {
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

  const res = await gmail.users.drafts.create({
    userId: "me",
    requestBody: {
      message: { raw },
    },
  });

  return {
    id: res.data.id!,
    messageId: res.data.message?.id!,
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
// Markdown to HTML Email (Focus.AI Brand)
// ============================================================================

function getLatestBrandVersion(): string {
  const brandBase = path.join(
    process.env.HOME || "",
    ".claude/plugins/cache/focus-marketplace/focus-ai-brand"
  );

  // List version directories and sort semver descending
  let versions: string[];
  try {
    versions = readdirSync(brandBase)
      .filter((v) => /^\d+\.\d+\.\d+$/.test(v))
      .sort((a, b) => {
        const [aMaj, aMin, aPat] = a.split(".").map(Number);
        const [bMaj, bMin, bPat] = b.split(".").map(Number);
        return bMaj - aMaj || bMin - aMin || bPat - aPat;
      });
  } catch {
    throw new Error("focus-ai-brand plugin not found");
  }

  if (versions.length === 0) {
    throw new Error("focus-ai-brand plugin not found");
  }

  return path.join(brandBase, versions[0], "templates");
}

function markdownToHtml(md: string): { html: string; title: string } {
  let html = md;
  let title = "Report";

  // Extract title from first H1
  const titleMatch = html.match(/^# (.+)$/m);
  if (titleMatch) title = titleMatch[1];

  // Handle code blocks first (before inline code)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, _lang, code) => {
    return `<pre><code>${code.trim()}</code></pre>`;
  });

  // Handle tables - find consecutive lines starting with |
  html = html.replace(/(^\|.+\|$\n?)+/gm, (tableBlock) => {
    const rows = tableBlock.trim().split("\n").filter((r) => r.trim());
    if (rows.length < 2) return tableBlock;

    const parseRow = (row: string): string[] => {
      return row
        .split("|")
        .slice(1, -1) // Remove empty first/last from | borders
        .map((cell) => cell.trim());
    };

    const headerCells = parseRow(rows[0]);
    // Skip separator row (row with dashes like |---|---|)
    const isSeparator = (row: string) => /^\|[\s:-]+\|$/.test(row.replace(/\|/g, "|"));
    const dataRows = rows.slice(1).filter((r) => !isSeparator(r));

    let tableHtml = "<table>\n<thead>\n<tr>\n";
    for (const cell of headerCells) {
      tableHtml += `<th>${cell}</th>\n`;
    }
    tableHtml += "</tr>\n</thead>\n<tbody>\n";

    for (const row of dataRows) {
      const cells = parseRow(row);
      tableHtml += "<tr>\n";
      for (const cell of cells) {
        tableHtml += `<td>${cell}</td>\n`;
      }
      tableHtml += "</tr>\n";
    }
    tableHtml += "</tbody>\n</table>";
    return tableHtml;
  });

  // Convert markdown syntax to HTML
  html = html
    .replace(/^#### (.+)$/gm, "<h4>$1</h4>")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+?)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/^> (.+)$/gm, "<blockquote><p>$1</p></blockquote>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/^---$/gm, "<hr>");

  // Handle unordered lists
  html = html.replace(/(^- .+$\n?)+/gm, (match) => {
    const items = match
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => `<li>${line.replace(/^- /, "")}</li>`)
      .join("\n");
    return `<ul>\n${items}\n</ul>`;
  });

  // Handle ordered lists
  html = html.replace(/(^\d+\. .+$\n?)+/gm, (match) => {
    const items = match
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => `<li>${line.replace(/^\d+\. /, "")}</li>`)
      .join("\n");
    return `<ol>\n${items}\n</ol>`;
  });

  // Merge consecutive blockquotes
  html = html.replace(/<\/blockquote>\n<blockquote>/g, "\n");

  // Wrap loose text in paragraphs (lines not already wrapped)
  const lines = html.split("\n");
  const processedLines: string[] = [];
  let inParagraph = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const isBlockElement =
      /^<(h[1-6]|ul|ol|li|blockquote|pre|hr|p|table|thead|tbody|tr|th|td)/.test(trimmed) ||
      /^<\/(h[1-6]|ul|ol|li|blockquote|pre|p|table|thead|tbody|tr|th|td)>/.test(trimmed);

    if (!trimmed) {
      if (inParagraph) {
        processedLines.push("</p>");
        inParagraph = false;
      }
      processedLines.push(line);
    } else if (isBlockElement) {
      if (inParagraph) {
        processedLines.push("</p>");
        inParagraph = false;
      }
      processedLines.push(line);
    } else if (!inParagraph) {
      processedLines.push("<p>" + line);
      inParagraph = true;
    } else {
      processedLines.push(line);
    }
  }

  if (inParagraph) {
    processedLines.push("</p>");
  }

  html = processedLines.join("\n");

  return { html, title };
}

function getEmailTemplate(style: "client" | "labs"): string {
  // Email-optimized templates with inline styles (email clients don't support CSS variables, clamp, etc.)
  const clientTemplate = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{TITLE}}</title>
</head>
<body style="margin: 0; padding: 20px; background-color: #e8e6df; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 680px; margin: 0 auto;">
    <tr>
      <td style="background: #faf9f6; padding: 40px; border: 1px solid #d4d3cf; border-radius: 8px;">
        {{CONTENT}}
      </td>
    </tr>
  </table>
</body>
</html>`;

  const labsTemplate = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{TITLE}}</title>
</head>
<body style="margin: 0; padding: 20px; background-color: #e8e6df; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #000000;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 680px; margin: 0 auto;">
    <tr>
      <td style="background: #f3f2ea; padding: 40px; border: 1px solid #000000; box-shadow: 8px 8px 0px 0px rgba(0,0,0,0.1); color: #000000;">
        {{CONTENT}}
      </td>
    </tr>
  </table>
</body>
</html>`;

  return style === "labs" ? labsTemplate : clientTemplate;
}

function markdownToEmailHtml(md: string, style: "client" | "labs"): { html: string; title: string } {
  let title = "Report";

  // Extract title from first H1
  const titleMatch = md.match(/^# (.+)$/m);
  if (titleMatch) title = titleMatch[1];

  // Style definitions based on brand
  const isLabs = style === "labs";
  const styles = {
    h1: isLabs
      ? 'style="font-size: 36px; font-weight: 900; letter-spacing: -0.02em; line-height: 1.0; color: #000000; margin: 0 0 20px 0; padding-bottom: 20px; border-bottom: 2px solid #000000;"'
      : 'style="font-size: 32px; font-weight: 700; letter-spacing: -0.045em; line-height: 1.1; color: #000000; margin: 0 0 20px 0; padding-bottom: 20px; border-bottom: 2px solid #0e3b46;"',
    h2: isLabs
      ? 'style="font-size: 22px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.05em; line-height: 1.2; color: #000000; margin: 32px 0 16px 0; padding-bottom: 8px; border-bottom: 1px solid #000000;"'
      : 'style="font-size: 24px; font-weight: 700; letter-spacing: -0.03em; line-height: 1.2; color: #000000; margin: 32px 0 16px 0; padding-bottom: 8px; border-bottom: 1px solid #d4d3cf;"',
    h3: isLabs
      ? 'style="font-size: 18px; font-weight: 700; line-height: 1.3; color: #000000; margin: 24px 0 12px 0;"'
      : 'style="font-size: 18px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.3; color: #000000; margin: 24px 0 12px 0;"',
    h4: 'style="font-size: 16px; font-weight: 700; color: #000000; margin: 20px 0 8px 0;"',
    p: 'style="font-size: 16px; line-height: 1.6; color: #000000; margin: 0 0 16px 0;"',
    a: isLabs
      ? 'style="color: #0055aa; text-decoration: underline;"'
      : 'style="color: #0e3b46; text-decoration: none; border-bottom: 1px solid #0e3b46;"',
    blockquote: isLabs
      ? 'style="margin: 20px 0; padding: 16px; background: white; border: 1px solid #000000; border-left: 4px solid #0055aa; color: #000000;"'
      : 'style="margin: 20px 0; padding: 16px 20px; border-left: 3px solid #0e3b46; background: rgba(14, 59, 70, 0.03); font-style: italic; color: #000000;"',
    code: isLabs
      ? 'style="font-family: \'Courier New\', monospace; font-size: 14px; background: #e6e4dc; padding: 2px 6px; border: 1px solid rgba(0, 0, 0, 0.2); color: #000000;"'
      : 'style="font-family: \'Courier New\', monospace; font-size: 14px; background: rgba(14, 59, 70, 0.06); padding: 2px 6px; border-radius: 3px; color: #000000;"',
    pre: 'style="margin: 20px 0; padding: 20px; background: #f4f4f4; color: #1a1a1a; overflow-x: auto; font-family: \'Courier New\', monospace; font-size: 14px; line-height: 1.5; border-radius: 6px; border: 1px solid #d0d0d0;"',
    hr: isLabs
      ? 'style="margin: 32px 0; border: none; border-top: 2px solid #000000;"'
      : 'style="margin: 32px 0; border: none; height: 1px; background: #d4d3cf;"',
    ul: 'style="margin: 0 0 16px 0; padding-left: 24px;"',
    ol: 'style="margin: 0 0 16px 0; padding-left: 24px;"',
    li: 'style="font-size: 16px; line-height: 1.6; color: #000000; margin-bottom: 8px;"',
    table: 'style="width: 100%; margin: 20px 0; border-collapse: collapse; font-size: 15px;"',
    th: isLabs
      ? 'style="padding: 10px 12px; text-align: left; border: 1px solid #000000; font-family: \'Courier New\', monospace; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; background: #000000; color: #ffffff;"'
      : 'style="padding: 10px 12px; text-align: left; border-bottom: 1px solid #d4d3cf; font-family: \'Courier New\', monospace; font-size: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.12em; color: #000000; background: rgba(14, 59, 70, 0.03);"',
    td: isLabs
      ? 'style="padding: 10px 12px; text-align: left; border: 1px solid #000000; font-size: 15px; color: #000000;"'
      : 'style="padding: 10px 12px; text-align: left; border-bottom: 1px solid #d4d3cf; font-size: 15px; color: #000000;"',
    strong: 'style="font-weight: 700;"',
    em: 'style="font-style: italic;"',
  };

  let html = md;

  // Handle code blocks first (before inline code)
  // HTML-escape the code content to prevent markdown conversion inside code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, _lang, code) => {
    const escaped = code.trim()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
    return `<pre ${styles.pre}><code>${escaped}</code></pre>`;
  });

  // Handle tables
  html = html.replace(/(^\|.+\|$\n?)+/gm, (tableBlock) => {
    const rows = tableBlock.trim().split("\n").filter((r) => r.trim());
    if (rows.length < 2) return tableBlock;

    const parseRow = (row: string): string[] => {
      return row.split("|").slice(1, -1).map((cell) => cell.trim());
    };

    const headerCells = parseRow(rows[0]);
    const isSeparator = (row: string) => /^\|[\s:-]+\|$/.test(row.replace(/\|/g, "|"));
    const dataRows = rows.slice(1).filter((r) => !isSeparator(r));

    let tableHtml = `<table ${styles.table}><thead><tr>`;
    for (const cell of headerCells) {
      tableHtml += `<th ${styles.th}>${cell}</th>`;
    }
    tableHtml += "</tr></thead><tbody>";

    for (const row of dataRows) {
      const cells = parseRow(row);
      tableHtml += "<tr>";
      for (const cell of cells) {
        tableHtml += `<td ${styles.td}>${cell}</td>`;
      }
      tableHtml += "</tr>";
    }
    tableHtml += "</tbody></table>";
    return tableHtml;
  });

  // Convert headers
  html = html
    .replace(/^#### (.+)$/gm, `<h4 ${styles.h4}>$1</h4>`)
    .replace(/^### (.+)$/gm, `<h3 ${styles.h3}>$1</h3>`)
    .replace(/^## (.+)$/gm, `<h2 ${styles.h2}>$1</h2>`)
    .replace(/^# (.+)$/gm, `<h1 ${styles.h1}>$1</h1>`);

  // Inline formatting
  html = html
    .replace(/\*\*(.+?)\*\*/g, `<strong ${styles.strong}>$1</strong>`)
    .replace(/\*([^*]+?)\*/g, `<em ${styles.em}>$1</em>`)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, `<a href="$2" ${styles.a}>$1</a>`)
    .replace(/`([^`]+)`/g, `<code ${styles.code}>$1</code>`)
    .replace(/^---$/gm, `<hr ${styles.hr}>`);

  // Blockquotes - handle multi-line blockquotes as a group
  // First, find all consecutive blockquote lines (including empty > lines)
  html = html.replace(/(^>.*$\n?)+/gm, (match) => {
    // Extract content from each line, removing the > prefix
    const lines = match
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => line.replace(/^>\s?/, "").trim())
      .filter((line) => line); // Remove empty lines

    if (lines.length === 0) return "";

    // Join all lines into paragraphs (split on empty content would create new <p>)
    const content = lines.join("<br>");
    return `<blockquote ${styles.blockquote}><p ${styles.p}>${content}</p></blockquote>`;
  });

  // Unordered lists
  html = html.replace(/(^- .+$\n?)+/gm, (match) => {
    const items = match
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => `<li ${styles.li}>${line.replace(/^- /, "")}</li>`)
      .join("\n");
    return `<ul ${styles.ul}>\n${items}\n</ul>`;
  });

  // Ordered lists
  html = html.replace(/(^\d+\. .+$\n?)+/gm, (match) => {
    const items = match
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => `<li ${styles.li}>${line.replace(/^\d+\. /, "")}</li>`)
      .join("\n");
    return `<ol ${styles.ol}>\n${items}\n</ol>`;
  });

  // Note: consecutive blockquotes are now handled in the blockquote regex above

  // Wrap loose text in paragraphs
  const lines = html.split("\n");
  const processedLines: string[] = [];
  let inParagraph = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const isBlockElement =
      /^<(h[1-6]|ul|ol|li|blockquote|pre|hr|p|table|thead|tbody|tr|th|td)/.test(trimmed) ||
      /^<\/(h[1-6]|ul|ol|li|blockquote|pre|p|table|thead|tbody|tr|th|td)>/.test(trimmed);

    if (!trimmed) {
      if (inParagraph) {
        processedLines.push("</p>");
        inParagraph = false;
      }
      processedLines.push(line);
    } else if (isBlockElement) {
      if (inParagraph) {
        processedLines.push("</p>");
        inParagraph = false;
      }
      processedLines.push(line);
    } else if (!inParagraph) {
      processedLines.push(`<p ${styles.p}>` + line);
      inParagraph = true;
    } else {
      processedLines.push(line);
    }
  }

  if (inParagraph) {
    processedLines.push("</p>");
  }

  html = processedLines.join("\n");

  return { html, title };
}

function applyTemplate(
  template: string,
  title: string,
  content: string
): string {
  return template
    .replace("{{TITLE}}", title)
    .replace("{{CONTENT}}", content);
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
  send-md                 Send markdown as styled HTML email
    --to=EMAIL            Recipient (required)
    --file=PATH           Markdown file to send (required)
    --style=client|labs   Focus.AI brand style (default: client)
    --subject=TEXT        Subject (default: first H1 in markdown)
    --draft               Create as draft instead of sending
  draft                   Create a draft email
    --to=EMAIL            Recipient (required)
    --subject=TEXT        Subject (required)
    --body=TEXT           Body (required)
    --html=HTML           HTML body (optional)
    --attachment=PATH     File to attach (optional, comma-separated for multiple)

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

      case "send-md": {
        const { to, file, style, subject } = flags;
        const isDraft = flags.draft !== undefined;
        if (!to || !file) fail("Required: --to, --file [--style=client|labs] [--subject=TEXT] [--draft]");

        // Read markdown file
        const mdPath = path.isAbsolute(file) ? file : path.resolve(process.cwd(), file);
        const markdown = await fs.readFile(mdPath, "utf-8");

        // Convert markdown to email-optimized HTML with inline styles
        const templateStyle = (style === "labs" ? "labs" : "client") as "client" | "labs";
        const { html: contentHtml, title } = markdownToEmailHtml(markdown, templateStyle);

        // Apply email template wrapper
        const template = getEmailTemplate(templateStyle);
        const finalSubject = subject || title;
        const finalHtml = applyTemplate(template, finalSubject, contentHtml);

        // Send or create draft
        const gmail = await getGmailClient();
        const plainText = markdown; // Use original markdown as plain text fallback

        if (isDraft) {
          const result = await createDraft(gmail, to, finalSubject, plainText, finalHtml);
          output({
            success: true,
            data: {
              ...result,
              message: `Styled draft created with Focus.AI ${templateStyle} template`,
              subject: finalSubject,
              style: templateStyle,
            },
          });
        } else {
          const result = await sendMessage(gmail, to, finalSubject, plainText, finalHtml);
          output({
            success: true,
            data: {
              ...result,
              message: `Styled email sent with Focus.AI ${templateStyle} template`,
              subject: finalSubject,
              style: templateStyle,
            },
          });
        }
        break;
      }

      case "draft": {
        const { to, subject, body, html, attachment } = flags;
        const inlineFlag = flags["inline"];
        if (!to || !subject || !body) fail("Required: --to, --subject, --body [--html=<html-content>] [--attachment=<path>] [--inline=<path>:<cid>,...]");
        const gmail = await getGmailClient();
        const attachmentPaths = attachment ? attachment.split(",").map((p: string) => p.trim()) : undefined;
        let inlineImages: { path: string; cid: string }[] | undefined;
        if (inlineFlag) {
          inlineImages = inlineFlag.split(",").map((item: string) => {
            const [imgPath, cid] = item.trim().split(":");
            return { path: imgPath, cid };
          });
        }
        const result = await createDraft(gmail, to, subject, body, html, attachmentPaths, inlineImages);
        const hasAttachment = attachmentPaths && attachmentPaths.length > 0;
        const hasInline = inlineImages && inlineImages.length > 0;
        output({ success: true, data: { ...result, message: hasAttachment || hasInline ? "Draft created with attachment(s)" : (html ? "HTML draft created" : "Draft created") } });
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
