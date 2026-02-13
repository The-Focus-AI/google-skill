---
name: gdocs
description: This skill should be used when the user asks to "read document", "create document", "edit document", "google doc", "list documents", "insert text", "append text", "find and replace", "export document", "export to pdf", "export to word", "download as pdf", or mentions Google Docs operations. Provides Google Docs API integration for reading, writing, exporting, and managing documents.
version: 0.2.0
---

# Google Docs Skill

Create, read, edit, and export Google Docs documents.

## First-Time Setup

Run `npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/gmail/scripts/gmail.ts auth` to authenticate with Google. This opens a browser for OAuth consent and grants access to all Google services including Docs.

Tokens are stored per-project in `.claude/google-skill.local.json`.

## Using Your Own Credentials (Optional)

By default, this skill uses embedded OAuth credentials. To use your own Google Cloud project instead, save your credentials to `~/.config/google-skill/credentials.json`.

## Commands

```bash
# List your documents
npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/gdocs/scripts/gdocs.ts list
npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/gdocs/scripts/gdocs.ts list --max=50

# Get document metadata
npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/gdocs/scripts/gdocs.ts get <documentId>

# Read document content as plain text
npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/gdocs/scripts/gdocs.ts read <documentId>

# Create new document
npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/gdocs/scripts/gdocs.ts create --title="My Document"

# Insert text at beginning (index 1)
npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/gdocs/scripts/gdocs.ts insert <documentId> --text="Hello World\n"

# Insert text at specific position
npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/gdocs/scripts/gdocs.ts insert <documentId> --text="Inserted here" --index=50

# Append text to end of document
npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/gdocs/scripts/gdocs.ts append <documentId> --text="\n\nNew paragraph at the end."

# Find and replace text
npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/gdocs/scripts/gdocs.ts replace <documentId> \
  --find="old text" \
  --replace="new text"

# Find and replace (case-sensitive)
npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/gdocs/scripts/gdocs.ts replace <documentId> \
  --find="Hello" \
  --replace="Hi" \
  --match-case

# Export to PDF (default)
npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/gdocs/scripts/gdocs.ts export <documentId>

# Export to Word (.docx)
npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/gdocs/scripts/gdocs.ts export <documentId> --format=docx

# Export to other formats (odt, txt, html, rtf, epub)
npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/gdocs/scripts/gdocs.ts export <documentId> --format=odt

# Export to specific file path
npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/gdocs/scripts/gdocs.ts export <documentId> --format=pdf --output=./report.pdf
```

## Export Formats

| Format | Extension | Description |
|--------|-----------|-------------|
| pdf | .pdf | Portable Document Format (default) |
| docx | .docx | Microsoft Word |
| odt | .odt | OpenDocument Text |
| txt | .txt | Plain text |
| html | .html | Web page |
| rtf | .rtf | Rich Text Format |
| epub | .epub | E-book format |

## Text Formatting Notes

- Use `\n` for newlines in text arguments
- Use `\t` for tabs
- Text is inserted as plain text (no rich formatting via CLI)
- For complex formatting, use the Google Docs web interface

## Document IDs

Document IDs can be found in the URL of any Google Doc:
`https://docs.google.com/document/d/{documentId}/edit`

Or use the `list` command to see your recent documents with their IDs.

## Output

All commands return JSON with `success` and `data` fields.

## Help

```bash
npx tsx ${CLAUDE_PLUGIN_ROOT}/skills/gdocs/scripts/gdocs.ts --help
```
