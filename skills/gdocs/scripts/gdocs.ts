#!/usr/bin/env npx tsx

/**
 * Google Docs CLI - Create, read, and edit documents
 */

import { google, docs_v1, drive_v3 } from "googleapis";
import { loadToken, CREDENTIALS_PATH } from "../../../scripts/lib/auth.js";
import { output, fail, parseArgs } from "../../../scripts/lib/output.js";
import * as fs from "fs/promises";
import * as path from "path";

// ============================================================================
// Docs Client
// ============================================================================

async function getDocsClient(): Promise<docs_v1.Docs> {
  const auth = await loadToken();
  return google.docs({ version: "v1", auth });
}

async function getDriveClient(): Promise<drive_v3.Drive> {
  const auth = await loadToken();
  return google.drive({ version: "v3", auth });
}

// ============================================================================
// Docs Operations
// ============================================================================

interface DocumentInfo {
  id: string;
  name: string;
  createdTime?: string;
  modifiedTime?: string;
  webViewLink?: string;
}

async function listDocuments(
  maxResults: number = 20
): Promise<DocumentInfo[]> {
  const drive = await getDriveClient();
  const res = await drive.files.list({
    q: "mimeType='application/vnd.google-apps.document'",
    pageSize: maxResults,
    fields: "files(id, name, createdTime, modifiedTime, webViewLink)",
    orderBy: "modifiedTime desc",
  });

  return (res.data.files || []).map((f) => ({
    id: f.id!,
    name: f.name!,
    createdTime: f.createdTime || undefined,
    modifiedTime: f.modifiedTime || undefined,
    webViewLink: f.webViewLink || undefined,
  }));
}

interface DocumentMetadata {
  documentId: string;
  title: string;
  revisionId: string;
  suggestionsViewMode: string;
}

async function getDocument(
  docs: docs_v1.Docs,
  documentId: string
): Promise<DocumentMetadata> {
  const res = await docs.documents.get({
    documentId,
  });

  return {
    documentId: res.data.documentId!,
    title: res.data.title || "",
    revisionId: res.data.revisionId || "",
    suggestionsViewMode: res.data.suggestionsViewMode || "",
  };
}

/**
 * Extract plain text from document content
 */
function extractPlainText(body: docs_v1.Schema$Body | undefined): string {
  if (!body?.content) return "";

  const textParts: string[] = [];

  for (const element of body.content) {
    if (element.paragraph) {
      const paragraphText = element.paragraph.elements
        ?.map((e) => e.textRun?.content || "")
        .join("") || "";
      textParts.push(paragraphText);
    } else if (element.table) {
      // Extract text from table cells
      for (const row of element.table.tableRows || []) {
        const rowText = (row.tableCells || [])
          .map((cell) => extractPlainText(cell as unknown as docs_v1.Schema$Body))
          .join("\t");
        textParts.push(rowText);
      }
    }
  }

  return textParts.join("");
}

interface DocumentContent {
  documentId: string;
  title: string;
  text: string;
  endIndex: number;
}

async function readDocument(
  docs: docs_v1.Docs,
  documentId: string
): Promise<DocumentContent> {
  const res = await docs.documents.get({
    documentId,
  });

  const text = extractPlainText(res.data.body);
  const endIndex = res.data.body?.content?.at(-1)?.endIndex || 1;

  return {
    documentId: res.data.documentId!,
    title: res.data.title || "",
    text,
    endIndex,
  };
}

interface CreateDocumentResult {
  documentId: string;
  title: string;
  revisionId: string;
}

async function createDocument(
  docs: docs_v1.Docs,
  title: string
): Promise<CreateDocumentResult> {
  const res = await docs.documents.create({
    requestBody: {
      title,
    },
  });

  return {
    documentId: res.data.documentId!,
    title: res.data.title || title,
    revisionId: res.data.revisionId || "",
  };
}

interface InsertTextResult {
  documentId: string;
  message: string;
}

async function insertText(
  docs: docs_v1.Docs,
  documentId: string,
  text: string,
  index?: number
): Promise<InsertTextResult> {
  // Get the document to find the end index if not specified
  let insertIndex = index;
  if (insertIndex === undefined) {
    const doc = await docs.documents.get({ documentId });
    // Insert at beginning (after the first structural element)
    insertIndex = 1;
  }

  await docs.documents.batchUpdate({
    documentId,
    requestBody: {
      requests: [
        {
          insertText: {
            location: { index: insertIndex },
            text,
          },
        },
      ],
    },
  });

  return {
    documentId,
    message: `Text inserted at index ${insertIndex}`,
  };
}

interface AppendTextResult {
  documentId: string;
  message: string;
}

async function appendText(
  docs: docs_v1.Docs,
  documentId: string,
  text: string
): Promise<AppendTextResult> {
  // Get the document to find the end index
  const doc = await docs.documents.get({ documentId });
  const endIndex = doc.data.body?.content?.at(-1)?.endIndex || 1;

  // Insert at end (before the final newline)
  const insertIndex = Math.max(1, endIndex - 1);

  await docs.documents.batchUpdate({
    documentId,
    requestBody: {
      requests: [
        {
          insertText: {
            location: { index: insertIndex },
            text,
          },
        },
      ],
    },
  });

  return {
    documentId,
    message: `Text appended at index ${insertIndex}`,
  };
}

interface ReplaceTextResult {
  documentId: string;
  occurrencesChanged: number;
}

async function replaceText(
  docs: docs_v1.Docs,
  documentId: string,
  findText: string,
  replaceWithText: string,
  matchCase: boolean = false
): Promise<ReplaceTextResult> {
  const res = await docs.documents.batchUpdate({
    documentId,
    requestBody: {
      requests: [
        {
          replaceAllText: {
            containsText: {
              text: findText,
              matchCase,
            },
            replaceText: replaceWithText,
          },
        },
      ],
    },
  });

  const occurrences = res.data.replies?.[0]?.replaceAllText?.occurrencesChanged || 0;

  return {
    documentId,
    occurrencesChanged: occurrences,
  };
}

// ============================================================================
// Export Operations
// ============================================================================

type ExportFormat = "pdf" | "docx" | "odt" | "txt" | "html" | "rtf" | "epub";

const EXPORT_MIME_TYPES: Record<ExportFormat, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  odt: "application/vnd.oasis.opendocument.text",
  txt: "text/plain",
  html: "text/html",
  rtf: "application/rtf",
  epub: "application/epub+zip",
};

const FORMAT_EXTENSIONS: Record<ExportFormat, string> = {
  pdf: ".pdf",
  docx: ".docx",
  odt: ".odt",
  txt: ".txt",
  html: ".html",
  rtf: ".rtf",
  epub: ".epub",
};

interface ExportResult {
  documentId: string;
  format: ExportFormat;
  path: string;
  size: number;
}

async function exportDocument(
  documentId: string,
  format: ExportFormat,
  outputPath?: string
): Promise<ExportResult> {
  const drive = await getDriveClient();
  const mimeType = EXPORT_MIME_TYPES[format];

  // Get document metadata from Drive API (doesn't require Docs API)
  const fileMeta = await drive.files.get({
    fileId: documentId,
    fields: "id,name",
  });
  const docName = fileMeta.data.name || "document";

  // Determine output path
  let finalPath: string;
  if (outputPath) {
    // If outputPath is a directory, append filename
    try {
      const stat = await fs.stat(outputPath);
      if (stat.isDirectory()) {
        const safeName = docName.replace(/[/\\?%*:|"<>]/g, "_");
        finalPath = path.join(outputPath, safeName + FORMAT_EXTENSIONS[format]);
      } else {
        finalPath = outputPath;
      }
    } catch {
      // Path doesn't exist, use it as filename
      finalPath = outputPath;
    }
  } else {
    // Generate filename from document title
    const safeName = docName.replace(/[/\\?%*:|"<>]/g, "_");
    finalPath = safeName + FORMAT_EXTENSIONS[format];
  }

  // Export the document
  const res = await drive.files.export(
    {
      fileId: documentId,
      mimeType,
    },
    { responseType: "arraybuffer" }
  );

  // Write to file
  const buffer = Buffer.from(res.data as ArrayBuffer);
  await fs.writeFile(finalPath, buffer);

  return {
    documentId,
    format,
    path: path.resolve(finalPath),
    size: buffer.length,
  };
}

// ============================================================================
// CLI
// ============================================================================

function printUsage(): void {
  console.log(`
Google Docs CLI

COMMANDS:
  list                    List your documents
    --max=N               Max results (default: 20)

  get <documentId>        Get document metadata

  read <documentId>       Read document content as plain text

  create                  Create a new document
    --title=NAME          Document title (required)

  insert <documentId>     Insert text at position
    --text=TEXT           Text to insert (required)
    --index=N             Position index (default: 1, beginning)

  append <documentId>     Append text to end of document
    --text=TEXT           Text to append (required)

  replace <documentId>    Find and replace text
    --find=TEXT           Text to find (required)
    --replace=TEXT        Replacement text (required)
    --match-case          Match case (default: false)

  export <documentId>     Export document to file
    --format=FORMAT       Format: pdf, docx, odt, txt, html, rtf, epub (default: pdf)
    --output=PATH         Output path (optional, defaults to document title)

EXAMPLES:
  # List documents
  npx tsx scripts/gdocs.ts list

  # Get document info
  npx tsx scripts/gdocs.ts get 1abc123...

  # Read document content
  npx tsx scripts/gdocs.ts read 1abc123...

  # Create document
  npx tsx scripts/gdocs.ts create --title="My Document"

  # Insert text at beginning
  npx tsx scripts/gdocs.ts insert 1abc123... --text="Hello World\\n"

  # Insert text at specific position
  npx tsx scripts/gdocs.ts insert 1abc123... --text="Inserted here" --index=50

  # Append text to end
  npx tsx scripts/gdocs.ts append 1abc123... --text="\\n\\nAppended paragraph."

  # Find and replace
  npx tsx scripts/gdocs.ts replace 1abc123... --find="old text" --replace="new text"

  # Export to PDF (default)
  npx tsx scripts/gdocs.ts export 1abc123...

  # Export to Word
  npx tsx scripts/gdocs.ts export 1abc123... --format=docx

  # Export to specific file
  npx tsx scripts/gdocs.ts export 1abc123... --format=pdf --output=./report.pdf

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
      case "list": {
        const max = parseInt(flags.max || "20", 10);
        const documents = await listDocuments(max);
        output({ success: true, data: { documents, count: documents.length } });
        break;
      }

      case "get": {
        const documentId = positional[0];
        if (!documentId) fail("Document ID required. Usage: gdocs.ts get <documentId>");
        const docs = await getDocsClient();
        const metadata = await getDocument(docs, documentId);
        output({ success: true, data: metadata });
        break;
      }

      case "read": {
        const documentId = positional[0];
        if (!documentId) fail("Document ID required. Usage: gdocs.ts read <documentId>");
        const docs = await getDocsClient();
        const content = await readDocument(docs, documentId);
        output({ success: true, data: content });
        break;
      }

      case "create": {
        const title = flags.title;
        if (!title) fail("Title required. Usage: gdocs.ts create --title=NAME");
        const docs = await getDocsClient();
        const result = await createDocument(docs, title);
        output({ success: true, data: { ...result, message: "Document created" } });
        break;
      }

      case "insert": {
        const documentId = positional[0];
        const text = flags.text;
        if (!documentId || !text) {
          fail("Usage: gdocs.ts insert <documentId> --text=TEXT [--index=N]");
        }
        const index = flags.index ? parseInt(flags.index, 10) : undefined;
        const docs = await getDocsClient();
        // Unescape common escape sequences
        const unescapedText = text.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
        const result = await insertText(docs, documentId, unescapedText, index);
        output({ success: true, data: result });
        break;
      }

      case "append": {
        const documentId = positional[0];
        const text = flags.text;
        if (!documentId || !text) {
          fail("Usage: gdocs.ts append <documentId> --text=TEXT");
        }
        const docs = await getDocsClient();
        // Unescape common escape sequences
        const unescapedText = text.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
        const result = await appendText(docs, documentId, unescapedText);
        output({ success: true, data: result });
        break;
      }

      case "replace": {
        const documentId = positional[0];
        const findText = flags.find;
        const replaceWithText = flags.replace;
        if (!documentId || !findText || replaceWithText === undefined) {
          fail("Usage: gdocs.ts replace <documentId> --find=TEXT --replace=TEXT [--match-case]");
        }
        const matchCase = flags["match-case"] === "true";
        const docs = await getDocsClient();
        const result = await replaceText(docs, documentId, findText, replaceWithText, matchCase);
        output({
          success: true,
          data: {
            ...result,
            message: `Replaced ${result.occurrencesChanged} occurrence(s)`,
          },
        });
        break;
      }

      case "export": {
        const documentId = positional[0];
        if (!documentId) {
          fail("Document ID required. Usage: gdocs.ts export <documentId> [--format=pdf|docx|odt|txt|html|rtf|epub] [--output=PATH]");
        }
        const formatStr = flags.format || "pdf";
        const validFormats: ExportFormat[] = ["pdf", "docx", "odt", "txt", "html", "rtf", "epub"];
        if (!validFormats.includes(formatStr as ExportFormat)) {
          fail(`Invalid format: ${formatStr}. Valid formats: ${validFormats.join(", ")}`);
        }
        const format = formatStr as ExportFormat;
        const outputPath = flags.output;
        const result = await exportDocument(documentId, format, outputPath);
        output({
          success: true,
          data: {
            ...result,
            message: `Document exported to ${result.path}`,
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
