#!/usr/bin/env npx tsx

/**
 * Google Sheets CLI - Create, read, and write spreadsheets
 */

import { google, sheets_v4, drive_v3 } from "googleapis";
import { loadToken, CREDENTIALS_PATH } from "../../../scripts/lib/auth.js";
import { output, fail, parseArgs } from "../../../scripts/lib/output.js";

// ============================================================================
// Sheets Client
// ============================================================================

async function getSheetsClient(): Promise<sheets_v4.Sheets> {
  const auth = await loadToken();
  return google.sheets({ version: "v4", auth });
}

async function getDriveClient(): Promise<drive_v3.Drive> {
  const auth = await loadToken();
  return google.drive({ version: "v3", auth });
}

// ============================================================================
// Sheets Operations
// ============================================================================

interface SpreadsheetInfo {
  id: string;
  name: string;
  createdTime?: string;
  modifiedTime?: string;
  webViewLink?: string;
}

async function listSpreadsheets(
  maxResults: number = 20
): Promise<SpreadsheetInfo[]> {
  const drive = await getDriveClient();
  const res = await drive.files.list({
    q: "mimeType='application/vnd.google-apps.spreadsheet'",
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

interface SheetInfo {
  sheetId: number;
  title: string;
  index: number;
  rowCount: number;
  columnCount: number;
}

interface SpreadsheetMetadata {
  spreadsheetId: string;
  title: string;
  locale: string;
  sheets: SheetInfo[];
  spreadsheetUrl: string;
}

async function getSpreadsheet(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string
): Promise<SpreadsheetMetadata> {
  const res = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "spreadsheetId,properties,sheets.properties,spreadsheetUrl",
  });

  return {
    spreadsheetId: res.data.spreadsheetId!,
    title: res.data.properties?.title || "",
    locale: res.data.properties?.locale || "",
    sheets: (res.data.sheets || []).map((s) => ({
      sheetId: s.properties?.sheetId || 0,
      title: s.properties?.title || "",
      index: s.properties?.index || 0,
      rowCount: s.properties?.gridProperties?.rowCount || 0,
      columnCount: s.properties?.gridProperties?.columnCount || 0,
    })),
    spreadsheetUrl: res.data.spreadsheetUrl || "",
  };
}

interface CellData {
  range: string;
  values: (string | number | boolean | null)[][];
}

async function readRange(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  range: string
): Promise<CellData> {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });

  return {
    range: res.data.range || range,
    values: (res.data.values as (string | number | boolean | null)[][]) || [],
  };
}

interface WriteResult {
  updatedRange: string;
  updatedRows: number;
  updatedColumns: number;
  updatedCells: number;
}

async function writeRange(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  range: string,
  values: (string | number | boolean | null)[][]
): Promise<WriteResult> {
  const res = await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });

  return {
    updatedRange: res.data.updatedRange || range,
    updatedRows: res.data.updatedRows || 0,
    updatedColumns: res.data.updatedColumns || 0,
    updatedCells: res.data.updatedCells || 0,
  };
}

interface AppendResult {
  updatedRange: string;
  updatedRows: number;
  updatedColumns: number;
  updatedCells: number;
}

async function appendRange(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  range: string,
  values: (string | number | boolean | null)[][]
): Promise<AppendResult> {
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });

  return {
    updatedRange: res.data.updates?.updatedRange || range,
    updatedRows: res.data.updates?.updatedRows || 0,
    updatedColumns: res.data.updates?.updatedColumns || 0,
    updatedCells: res.data.updates?.updatedCells || 0,
  };
}

interface CreateSpreadsheetResult {
  spreadsheetId: string;
  spreadsheetUrl: string;
  title: string;
}

async function createSpreadsheet(
  sheets: sheets_v4.Sheets,
  title: string,
  sheetTitles?: string[]
): Promise<CreateSpreadsheetResult> {
  const sheetsConfig = sheetTitles?.length
    ? sheetTitles.map((t) => ({ properties: { title: t } }))
    : undefined;

  const res = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title },
      sheets: sheetsConfig,
    },
  });

  return {
    spreadsheetId: res.data.spreadsheetId!,
    spreadsheetUrl: res.data.spreadsheetUrl!,
    title: res.data.properties?.title || title,
  };
}

interface AddSheetResult {
  sheetId: number;
  title: string;
  index: number;
}

async function addSheet(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  title: string
): Promise<AddSheetResult> {
  const res = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: { title },
          },
        },
      ],
    },
  });

  const reply = res.data.replies?.[0]?.addSheet?.properties;
  return {
    sheetId: reply?.sheetId || 0,
    title: reply?.title || title,
    index: reply?.index || 0,
  };
}

async function clearRange(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  range: string
): Promise<{ clearedRange: string }> {
  const res = await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range,
  });

  return {
    clearedRange: res.data.clearedRange || range,
  };
}

// ============================================================================
// CLI
// ============================================================================

function printUsage(): void {
  console.log(`
Google Sheets CLI

COMMANDS:
  list                    List your spreadsheets
    --max=N               Max results (default: 20)

  get <spreadsheetId>     Get spreadsheet metadata and sheet names

  read <spreadsheetId> <range>
                          Read cell values
                          Range uses A1 notation: Sheet1!A1:D10

  write <spreadsheetId> <range>
                          Write values to cells
    --values='[[...]]'    JSON array of arrays

  append <spreadsheetId> <range>
                          Append rows to the end of a sheet
    --values='[[...]]'    JSON array of arrays

  clear <spreadsheetId> <range>
                          Clear values in a range

  create                  Create a new spreadsheet
    --title=NAME          Spreadsheet title (required)
    --sheets=A,B,C        Optional comma-separated sheet names

  add-sheet <spreadsheetId>
                          Add a new sheet/tab to spreadsheet
    --title=NAME          Sheet title (required)

EXAMPLES:
  # List spreadsheets
  npx tsx scripts/gsheets.ts list

  # Get spreadsheet info
  npx tsx scripts/gsheets.ts get 1abc123...

  # Read cells
  npx tsx scripts/gsheets.ts read 1abc123... "Sheet1!A1:D10"

  # Write cells
  npx tsx scripts/gsheets.ts write 1abc123... "Sheet1!A1" --values='[["Hello","World"],["Row 2","Data"]]'

  # Append rows
  npx tsx scripts/gsheets.ts append 1abc123... "Sheet1!A:D" --values='[["New","Row"]]'

  # Create spreadsheet
  npx tsx scripts/gsheets.ts create --title="My Data"

  # Add sheet
  npx tsx scripts/gsheets.ts add-sheet 1abc123... --title="New Tab"

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
        const spreadsheets = await listSpreadsheets(max);
        output({ success: true, data: { spreadsheets, count: spreadsheets.length } });
        break;
      }

      case "get": {
        const spreadsheetId = positional[0];
        if (!spreadsheetId) fail("Spreadsheet ID required. Usage: gsheets.ts get <spreadsheetId>");
        const sheets = await getSheetsClient();
        const metadata = await getSpreadsheet(sheets, spreadsheetId);
        output({ success: true, data: metadata });
        break;
      }

      case "read": {
        const spreadsheetId = positional[0];
        const range = positional[1];
        if (!spreadsheetId || !range) fail("Usage: gsheets.ts read <spreadsheetId> <range>");
        const sheets = await getSheetsClient();
        const data = await readRange(sheets, spreadsheetId, range);
        output({ success: true, data });
        break;
      }

      case "write": {
        const spreadsheetId = positional[0];
        const range = positional[1];
        const valuesJson = flags.values;
        if (!spreadsheetId || !range || !valuesJson) {
          fail("Usage: gsheets.ts write <spreadsheetId> <range> --values='[[...]]'");
        }
        const values = JSON.parse(valuesJson);
        const sheets = await getSheetsClient();
        const result = await writeRange(sheets, spreadsheetId, range, values);
        output({ success: true, data: { ...result, message: "Values written" } });
        break;
      }

      case "append": {
        const spreadsheetId = positional[0];
        const range = positional[1];
        const valuesJson = flags.values;
        if (!spreadsheetId || !range || !valuesJson) {
          fail("Usage: gsheets.ts append <spreadsheetId> <range> --values='[[...]]'");
        }
        const values = JSON.parse(valuesJson);
        const sheets = await getSheetsClient();
        const result = await appendRange(sheets, spreadsheetId, range, values);
        output({ success: true, data: { ...result, message: "Rows appended" } });
        break;
      }

      case "clear": {
        const spreadsheetId = positional[0];
        const range = positional[1];
        if (!spreadsheetId || !range) fail("Usage: gsheets.ts clear <spreadsheetId> <range>");
        const sheets = await getSheetsClient();
        const result = await clearRange(sheets, spreadsheetId, range);
        output({ success: true, data: { ...result, message: "Range cleared" } });
        break;
      }

      case "create": {
        const title = flags.title;
        if (!title) fail("Title required. Usage: gsheets.ts create --title=NAME [--sheets=A,B,C]");
        const sheetTitles = flags.sheets ? flags.sheets.split(",").map((s) => s.trim()) : undefined;
        const sheets = await getSheetsClient();
        const result = await createSpreadsheet(sheets, title, sheetTitles);
        output({ success: true, data: { ...result, message: "Spreadsheet created" } });
        break;
      }

      case "add-sheet": {
        const spreadsheetId = positional[0];
        const title = flags.title;
        if (!spreadsheetId || !title) {
          fail("Usage: gsheets.ts add-sheet <spreadsheetId> --title=NAME");
        }
        const sheets = await getSheetsClient();
        const result = await addSheet(sheets, spreadsheetId, title);
        output({ success: true, data: { ...result, message: "Sheet added" } });
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
