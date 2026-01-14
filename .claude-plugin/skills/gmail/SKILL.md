---
name: gmail
description: This skill should be used when the user asks to "read emails", "send an email", "search gmail", "list messages", "check inbox", "manage labels", "find emails from", "check my calendar", "list events", "create an event", "schedule a meeting", or mentions Gmail/Calendar operations. Provides Gmail and Google Calendar API integration.
version: 0.1.0
---

# Gmail & Calendar Skill

Read, send, search Gmail. List, create, delete calendar events.

## First-Time Setup

Run `pnpm gmail auth`. If credentials aren't configured yet, you'll see detailed setup instructions.

Credentials are stored in `~/.config/gmail-skill/` and shared across all projects.

## Gmail Commands

```bash
# List messages
npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/gmail.ts list
npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/gmail.ts list --query="is:unread" --max=5

# Read message
npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/gmail.ts read <message-id>

# Send email
npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/gmail.ts send \
  --to="recipient@example.com" \
  --subject="Hello" \
  --body="Message content"

# Labels
npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/gmail.ts labels
npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/gmail.ts label <id> --add="IMPORTANT"
```

## Calendar Commands

```bash
# List calendars
npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/gmail.ts calendars

# List upcoming events
npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/gmail.ts events
npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/gmail.ts events --max=20

# Get event details
npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/gmail.ts event <event-id>

# Create event
npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/gmail.ts create \
  --summary="Meeting" \
  --start="2026-01-15T10:00:00" \
  --end="2026-01-15T11:00:00" \
  --location="Conference Room" \
  --description="Discuss project"

# Delete event
npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/gmail.ts delete <event-id>
```

## Search Operators (Gmail)

| Operator | Example | Description |
|----------|---------|-------------|
| `from:` | `from:alice@example.com` | From sender |
| `to:` | `to:bob@example.com` | To recipient |
| `subject:` | `subject:meeting` | Subject contains |
| `is:unread` | `is:unread` | Unread only |
| `has:attachment` | `has:attachment` | Has attachments |
| `newer_than:` | `newer_than:7d` | Within N days |
| `label:` | `label:work` | Has label |

## Output

All commands return JSON with `success` and `data` fields.

## Check Auth

```bash
npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/gmail.ts check
```

## Help

```bash
npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/gmail.ts --help
```
