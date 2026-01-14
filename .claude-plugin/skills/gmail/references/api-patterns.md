# Gmail API Patterns

Advanced patterns and techniques for Gmail API integration.

## Core Concepts

### Message Format Options

When fetching messages, choose the appropriate format:

| Format | Use Case | Data Returned |
|--------|----------|---------------|
| `minimal` | Just IDs | id, threadId |
| `metadata` | Headers only | Headers + snippet |
| `full` | Everything | Full message with body |
| `raw` | RFC 2822 | Base64 encoded raw message |

```typescript
// Efficient: Only get what you need
const metadata = await gmail.users.messages.get({
  userId: 'me',
  id: messageId,
  format: 'metadata',
  metadataHeaders: ['Subject', 'From', 'Date'],
});

// Full content when needed
const full = await gmail.users.messages.get({
  userId: 'me',
  id: messageId,
  format: 'full',
});
```

### Batch Operations

For multiple messages, use batch requests to reduce API calls:

```typescript
async function batchGetMessages(
  gmail: gmail_v1.Gmail,
  messageIds: string[]
): Promise<gmail_v1.Schema$Message[]> {
  const batch = messageIds.map(id =>
    gmail.users.messages.get({
      userId: 'me',
      id,
      format: 'metadata',
    })
  );

  const results = await Promise.all(batch);
  return results.map(r => r.data);
}
```

### Pagination

Handle large result sets with pagination:

```typescript
async function getAllMessages(
  gmail: gmail_v1.Gmail,
  query: string
): Promise<gmail_v1.Schema$Message[]> {
  const messages: gmail_v1.Schema$Message[] = [];
  let pageToken: string | undefined;

  do {
    const res = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 100,
      pageToken,
    });

    if (res.data.messages) {
      messages.push(...res.data.messages);
    }
    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);

  return messages;
}
```

## Working with Threads

### Get Thread with All Messages

```typescript
async function getThread(
  gmail: gmail_v1.Gmail,
  threadId: string
): Promise<gmail_v1.Schema$Thread> {
  const res = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
    format: 'full',
  });
  return res.data;
}
```

### Reply to Thread

```typescript
function createReplyMessage(
  to: string,
  subject: string,
  body: string,
  threadId: string,
  messageId: string
): string {
  const messageParts = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `In-Reply-To: ${messageId}`,
    `References: ${messageId}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
  ];

  return Buffer.from(messageParts.join('\n'))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function replyToThread(
  gmail: gmail_v1.Gmail,
  threadId: string,
  to: string,
  subject: string,
  body: string,
  inReplyTo: string
): Promise<string> {
  const raw = createReplyMessage(to, subject, body, threadId, inReplyTo);

  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw,
      threadId,
    },
  });

  return res.data.id!;
}
```

## Working with Attachments

### List Attachments

```typescript
interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}

function getAttachments(
  message: gmail_v1.Schema$Message
): Attachment[] {
  const attachments: Attachment[] = [];

  function scanParts(parts: gmail_v1.Schema$MessagePart[] | undefined) {
    if (!parts) return;

    for (const part of parts) {
      if (part.filename && part.body?.attachmentId) {
        attachments.push({
          id: part.body.attachmentId,
          filename: part.filename,
          mimeType: part.mimeType || 'application/octet-stream',
          size: part.body.size || 0,
        });
      }
      scanParts(part.parts);
    }
  }

  scanParts(message.payload?.parts);
  return attachments;
}
```

### Download Attachment

```typescript
async function downloadAttachment(
  gmail: gmail_v1.Gmail,
  messageId: string,
  attachmentId: string
): Promise<Buffer> {
  const res = await gmail.users.messages.attachments.get({
    userId: 'me',
    messageId,
    id: attachmentId,
  });

  const data = res.data.data!;
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}
```

### Send with Attachment

```typescript
function createMessageWithAttachment(
  to: string,
  subject: string,
  body: string,
  attachment: { filename: string; mimeType: string; data: Buffer }
): string {
  const boundary = 'boundary_' + Date.now();

  const messageParts = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
    '',
    `--${boundary}`,
    `Content-Type: ${attachment.mimeType}`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${attachment.filename}"`,
    '',
    attachment.data.toString('base64'),
    '',
    `--${boundary}--`,
  ];

  return Buffer.from(messageParts.join('\r\n'))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
```

## Label Management

### Create Nested Labels

Gmail supports nested labels using `/` separator:

```typescript
async function createNestedLabel(
  gmail: gmail_v1.Gmail,
  labelPath: string // e.g., "Projects/Active/Important"
): Promise<string> {
  const res = await gmail.users.labels.create({
    userId: 'me',
    requestBody: {
      name: labelPath,
      labelListVisibility: 'labelShow',
      messageListVisibility: 'show',
    },
  });
  return res.data.id!;
}
```

### Batch Label Operations

```typescript
async function archiveMessages(
  gmail: gmail_v1.Gmail,
  messageIds: string[]
): Promise<void> {
  await gmail.users.messages.batchModify({
    userId: 'me',
    requestBody: {
      ids: messageIds,
      removeLabelIds: ['INBOX'],
    },
  });
}

async function markAsRead(
  gmail: gmail_v1.Gmail,
  messageIds: string[]
): Promise<void> {
  await gmail.users.messages.batchModify({
    userId: 'me',
    requestBody: {
      ids: messageIds,
      removeLabelIds: ['UNREAD'],
    },
  });
}
```

## History API for Sync

Track changes since last sync:

```typescript
interface SyncState {
  historyId: string;
  lastSync: string;
}

async function getChanges(
  gmail: gmail_v1.Gmail,
  startHistoryId: string
): Promise<{
  added: string[];
  deleted: string[];
  labelsChanged: string[];
}> {
  const changes = {
    added: [] as string[],
    deleted: [] as string[],
    labelsChanged: [] as string[],
  };

  let pageToken: string | undefined;

  do {
    const res = await gmail.users.history.list({
      userId: 'me',
      startHistoryId,
      historyTypes: ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved'],
      pageToken,
    });

    for (const history of res.data.history || []) {
      if (history.messagesAdded) {
        changes.added.push(...history.messagesAdded.map(m => m.message!.id!));
      }
      if (history.messagesDeleted) {
        changes.deleted.push(...history.messagesDeleted.map(m => m.message!.id!));
      }
      if (history.labelsAdded || history.labelsRemoved) {
        const msgs = [
          ...(history.labelsAdded || []),
          ...(history.labelsRemoved || []),
        ];
        changes.labelsChanged.push(...msgs.map(m => m.message!.id!));
      }
    }

    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);

  return changes;
}
```

## Rate Limiting

Gmail API has quotas:
- 250 quota units per user per second
- 1 billion quota units per day

Different operations cost different units:
- `messages.list`: 5 units
- `messages.get`: 5 units
- `messages.send`: 100 units

Implement rate limiting:

```typescript
class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number;

  constructor(maxTokens: number = 250, refillRate: number = 250) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
    this.maxTokens = maxTokens;
    this.refillRate = refillRate;
  }

  async acquire(cost: number): Promise<void> {
    this.refill();

    while (this.tokens < cost) {
      await new Promise(r => setTimeout(r, 100));
      this.refill();
    }

    this.tokens -= cost;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }
}
```

## Error Handling

Common error codes and handling:

```typescript
async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3
): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      const status = error.response?.status;

      // Rate limited - wait and retry
      if (status === 429) {
        const retryAfter = error.response?.headers?.['retry-after'] || 60;
        await new Promise(r => setTimeout(r, retryAfter * 1000));
        continue;
      }

      // Server error - retry with backoff
      if (status >= 500) {
        await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
        continue;
      }

      // Client error - don't retry
      throw error;
    }
  }

  throw new Error('Max retries exceeded');
}
```

## OAuth Scopes Reference

| Scope | Access Level |
|-------|-------------|
| `gmail.readonly` | Read messages and settings |
| `gmail.send` | Send messages only |
| `gmail.compose` | Create drafts and send |
| `gmail.modify` | All except permanent delete |
| `gmail.labels` | Manage labels only |
| `gmail.settings.basic` | Read/write settings |
| `mail.google.com` | Full access (requires verification) |

Always use the minimum scope needed for your use case.
