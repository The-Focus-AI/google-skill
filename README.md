# gmail-skill

Gmail and Google Calendar integration for Claude Code. Read, send, search emails. List, create, delete calendar events.

## Installation

### Via Marketplace

If the marketplace is set up:

```bash
/plugin install The-Focus-AI/gmail-skill
```

### Direct Install

```bash
/plugin install https://github.com/The-Focus-AI/gmail-skill
```

Then restart Claude Code.

## First-Time Setup

After installation, run:

```bash
pnpm gmail auth
```

If this is your first time, you'll see setup instructions to create Google OAuth credentials. This is a one-time setup stored in `~/.config/gmail-skill/`.

### What Gets Created

```
~/.config/gmail-skill/
├── credentials.json   # OAuth client (you create once)
└── token.json         # Your refresh token (created by auth)
```

These are shared across all projects - set up once, works everywhere.

## Usage

Once authenticated, Claude can:

- **Gmail**: "check my unread emails", "send an email to...", "search for emails from..."
- **Calendar**: "what's on my calendar today", "create a meeting for...", "list my upcoming events"

### Manual Commands

```bash
# Gmail
pnpm gmail list                          # List recent messages
pnpm gmail list --query="is:unread"      # Search
pnpm gmail read <message-id>             # Read message
pnpm gmail send --to=x@y.com --subject="Hi" --body="Hello"

# Calendar
pnpm gmail calendars                     # List calendars
pnpm gmail events                        # Upcoming events
pnpm gmail events --max=20               # More events
pnpm gmail create --summary="Meeting" --start="2026-01-15T10:00:00" --end="2026-01-15T11:00:00"
pnpm gmail delete <event-id>

# Help
pnpm gmail --help
```

## Local Development

### Test Without Installing

```bash
# Clone the repo
git clone https://github.com/The-Focus-AI/gmail-skill
cd gmail-skill

# Install dependencies
pnpm install

# Test commands directly
pnpm gmail --help
pnpm gmail auth
pnpm gmail list
```

### Test as Plugin

```bash
# Run Claude Code with the plugin loaded from local directory
claude --plugin-dir /path/to/gmail-skill
```

Then try: "list my unread emails" or "what's on my calendar"

### Development Workflow

1. Make changes to `scripts/gmail.ts`
2. Test directly: `pnpm gmail <command>`
3. Test as plugin: `claude --plugin-dir .`
4. Commit and push

## Project Structure

```
gmail-skill/
├── .claude-plugin/
│   ├── plugin.json                    # Plugin manifest
│   └── skills/gmail/
│       ├── SKILL.md                   # Skill definition (triggers, docs)
│       └── references/                # Additional documentation
├── scripts/
│   └── gmail.ts                       # Main CLI tool
├── package.json
└── README.md
```

## Configuration

### Environment Variables

| Variable | Description |
|----------|-------------|
| `XDG_CONFIG_HOME` | Override config directory (default: `~/.config`) |
| `GMAIL_TOKEN_PATH` | Override token location |

### Gmail Search Syntax

```
is:unread                    # Unread messages
from:alice@example.com       # From specific sender
to:bob@example.com           # To specific recipient
subject:meeting              # Subject contains word
has:attachment               # Has attachments
newer_than:7d                # Within last 7 days
older_than:1m                # Older than 1 month
label:work                   # Has specific label
```

Combine: `from:boss@company.com is:unread newer_than:7d`

## Troubleshooting

### "Credentials not found"

Run `pnpm gmail auth` and follow the setup instructions.

### "Token expired" or "Invalid credentials"

```bash
rm ~/.config/gmail-skill/token.json
pnpm gmail auth
```

### "No refresh token received"

The app was already authorized. Revoke access and retry:

1. Go to https://myaccount.google.com/permissions
2. Find and remove "Gmail Skill" (or whatever you named it)
3. Run `pnpm gmail auth` again

### "Access blocked" during OAuth

Your OAuth consent screen may not be configured correctly. Check:
- APIs are enabled (Gmail API, Google Calendar API)
- Your email is added as a test user
- Scopes are configured

## License

MIT
