# Gmail API Setup Guide

Complete step-by-step guide for setting up Gmail API access with OAuth 2.0.

## Step 1: Create Google Cloud Project

1. Navigate to [Google Cloud Console](https://console.cloud.google.com/)
2. Click "Select a project" dropdown → "New Project"
3. Enter project name (e.g., "Gmail Agent")
4. Click "Create"

## Step 2: Enable Gmail API

1. In Google Cloud Console, go to **APIs & Services** → **Library**
2. Search for "Gmail API"
3. Click on **Gmail API**
4. Click **Enable**

## Step 3: Configure OAuth Consent Screen

1. Go to **APIs & Services** → **OAuth consent screen**
2. Select User Type:
   - **Internal** - For Google Workspace accounts (recommended if available)
   - **External** - For personal Gmail accounts

3. Fill in required fields:
   - App name: Your app name
   - User support email: Your email
   - Developer contact: Your email

4. Click **Save and Continue**

5. Add Scopes:
   - Click "Add or Remove Scopes"
   - Add these scopes:
     - `https://www.googleapis.com/auth/gmail.readonly`
     - `https://www.googleapis.com/auth/gmail.send`
     - `https://www.googleapis.com/auth/gmail.labels`
     - `https://www.googleapis.com/auth/gmail.modify`
   - Click **Update** → **Save and Continue**

6. Add Test Users (for External apps):
   - Click "Add Users"
   - Add your Gmail address
   - Click **Save and Continue**

7. Review and click **Back to Dashboard**

## Step 4: Create OAuth Credentials

1. Go to **APIs & Services** → **Credentials**
2. Click **Create Credentials** → **OAuth client ID**
3. Select Application type: **Desktop app**
4. Name: "Gmail Agent CLI"
5. Click **Create**
6. Click **Download JSON**
7. Save as `credentials.json` in your project root

## Step 5: Install Dependencies

```bash
# Using npm
npm install googleapis @google-cloud/local-auth

# Using pnpm
pnpm add googleapis @google-cloud/local-auth

# Using bun
bun add googleapis @google-cloud/local-auth
```

## Step 6: Authenticate

Run the authentication command:

```bash
npx tsx skills/gmail/scripts/gmail.ts auth
```

This will:
1. Open your default browser
2. Show Google OAuth consent screen
3. After approval, save tokens to `token.json`

## File Structure After Setup

```
your-project/
├── credentials.json    # OAuth client config (from Step 4)
├── token.json          # Generated after auth (Step 6)
├── package.json
└── .gitignore          # Must include credentials.json and token.json
```

## Important Security Notes

### Never Commit Credentials

Add to `.gitignore`:
```
credentials.json
token.json
*.keys.json
```

### Token Expiration

- **Access tokens**: Expire after 1 hour (auto-refreshed)
- **Refresh tokens**: Valid until revoked or password change
- **Testing mode tokens**: Expire after 7 days

### Re-authentication Required When

- Password changed
- Token revoked in Google Account settings
- Refresh token expired (rare)
- Scopes changed

To re-authenticate:
```bash
rm token.json
npx tsx skills/gmail/scripts/gmail.ts auth
```

## Troubleshooting

### "Access blocked: This app's request is invalid"

- OAuth consent screen not configured
- Redirect URI mismatch
- Solution: Check OAuth consent screen setup

### "Token has been expired or revoked"

```bash
rm token.json
npx tsx skills/gmail/scripts/gmail.ts auth
```

### "Insufficient Permission"

- Missing required scope
- Solution: Delete token.json and re-authenticate

### "The OAuth client was not found"

- credentials.json is invalid or missing
- Solution: Re-download from Google Cloud Console

## Testing Mode Limitations

For **External** apps in testing mode:
- Maximum 100 test users
- Tokens expire after 7 days
- Consent screen shows "unverified app" warning

For production use with >100 users, submit for Google verification.

## Environment Variables (Optional)

Set `GMAIL_PROJECT_ROOT` to specify credential location:

```bash
export GMAIL_PROJECT_ROOT=/path/to/credentials
npx tsx gmail.ts auth
```
