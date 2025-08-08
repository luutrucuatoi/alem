# Email Worker - Temporary Email Storage

A Cloudflare Worker that receives, stores, and displays emails with automatic cleanup. Perfect for temporary email handling, testing, or monitoring specific email addresses.

## ✨ Features

- **📧 Email Reception**: Receives emails via Cloudflare Email Routing
- **💾 Temporary Storage**: Stores emails in Cloudflare D1 database
- **🗑️ Auto-Cleanup**: Automatically deletes emails after configurable time (default: 15 minutes)
- **🌐 Web Interface**: Clean, responsive web UI to view emails
- **🕒 Timezone Support**: Configurable timezone display (default: UTC+7)
- **🔄 Navigation**: Easy navigation between emails with Previous/Next buttons
- **📱 Mobile Friendly**: Responsive design works on all devices
- **🔍 Email Preview**: List view with subject and content preview
- **🔧 Health Monitoring**: Built-in health check and manual cleanup endpoints

## 🚀 Quick Start

### Prerequisites

- Cloudflare account with Workers and D1 enabled
- Domain configured with Cloudflare Email Routing
- Node.js and npm/pnpm installed
- Wrangler CLI installed (`npm install -g wrangler`)

### Setup

1. **Clone and Install**
   ```bash
   git clone https://github.com/taicv/cloudflare-email-worker-inbox
   cd cloudflare-email-worker-inbox
   pnpm install
   ```

2. **Configure Wrangler**
   ```bash
   cp wrangler.toml.example wrangler.toml
   ```
   
   Edit `wrangler.toml` with your settings:
   - `name`: Your worker name
   - `TARGET_EMAIL`: Email address to capture
   - `WORKER_NAME`: Display name for the worker
   - `TIMEZONE`: Your preferred timezone (e.g., "Asia/Bangkok", "America/New_York")
   - `EMAIL_RETENTION_MINUTES`: How long to keep emails before auto-deletion (default: 15)

3. **Create D1 Database**
   ```bash
   npx wrangler d1 create your-database-name
   ```
   
   Copy the database ID from the output to your `wrangler.toml`

4. **Initialize Database**
   ```bash
   npx wrangler deploy
   # Then visit: https://your-worker.your-subdomain.workers.dev/db-init
   ```

5. **Configure Email Routing**
   - Go to Cloudflare Dashboard → Email → Email Routing
   - Add a custom address rule: `your-email@yourdomain.com` → `your-worker.your-subdomain.workers.dev`

## 📖 Usage

### Web Interface

- **`/`** - Shows the latest email (redirects to `/emails/{latest-id}`)
- **`/emails`** - Lists all emails with preview
- **`/emails/{id}`** - View specific email with navigation

### API Endpoints

- **`/health`** - Health check and system status
- **`/cleanup`** - Manual cleanup trigger (for testing)
- **`/db-init`** - Initialize the emails table

### Email Storage

Emails are automatically:
- Parsed using PostalMime
- Stored with sender, subject, content (text + HTML)
- Assigned unique IDs and timestamps
- Cleaned up after configurable retention time (default: 15 minutes)

## ⚙️ Configuration

### Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `TARGET_EMAIL` | Email address to capture | `alerts@yourdomain.com` |
| `DEBUG_ENABLED` | Enable debug logging | `true` / `false` |
| `WORKER_NAME` | Display name | `My Email Worker` |
| `TIMEZONE` | Display timezone | `Asia/Bangkok` |
| `EMAIL_RETENTION_MINUTES` | Auto-cleanup time in minutes | `15` / `30` / `60` |

### Timezone Options

Common timezone values:
- `Asia/Bangkok` - UTC+7 (Thailand, Vietnam, Indonesia)
- `Asia/Tokyo` - UTC+9 (Japan, South Korea)
- `America/New_York` - UTC-5/-4 (US Eastern)
- `Europe/London` - UTC+0/+1 (UK)
- `UTC` - UTC+0

### Email Retention

Configure how long emails are kept before automatic deletion:
- `EMAIL_RETENTION_MINUTES = "15"` - 15 minutes (default)
- `EMAIL_RETENTION_MINUTES = "30"` - 30 minutes
- `EMAIL_RETENTION_MINUTES = "60"` - 1 hour
- `EMAIL_RETENTION_MINUTES = "1440"` - 24 hours

**Note**: Shorter retention times improve privacy and reduce storage costs, but may miss emails if not checked frequently.


## 🔒 Security Considerations

- **Temporary Storage**: Emails auto-delete after configurable time (default: 15 minutes)
- **Single Target**: Only captures emails sent to the configured `TARGET_EMAIL`
- **No Authentication**: The web interface is public (consider adding Cloudflare Access if needed)
- **Debug Logging**: Disable `DEBUG_ENABLED` in production to avoid sensitive data in logs

## 📊 Monitoring

### Health Check Response
```json
{
  "worker_name": "Your Email Worker",
  "target_email": "your-email@domain.com",
  "timezone": "Asia/Bangkok",
  "status": "healthy",
  "timestamp": "12/25/2024, 15:30:45",
  "d1_connection": "success",
  "emails_table_exists": true
}
```

### Cleanup Process

- **Automatic**: Runs every 5 minutes via cron trigger
- **On Email**: Triggers after each new email is stored
- **Manual**: Available via `/cleanup` endpoint
- **Retention**: Configurable minutes from `received_at` timestamp (set via `EMAIL_RETENTION_MINUTES`)

## 🎨 UI Features

### Email List (`/emails`)
- Clean card-based layout
- Subject, date, and content preview
- Click any email to view full content
- Email count display

### Email Detail (`/emails/{id}`)
- Full email content (HTML or formatted text)
- Email metadata (subject, sender, received date)
- Previous/Next navigation buttons
- Quick access to email list and latest email

## 🛠️ Troubleshooting

### Common Issues

1. **Emails not appearing**
   - Check Email Routing configuration in Cloudflare Dashboard
   - Verify `TARGET_EMAIL` matches the routing rule
   - Check worker logs: `npx wrangler tail`

2. **Database errors**
   - Run `/db-init` to initialize tables
   - Check D1 database configuration in `wrangler.toml`

3. **Timezone issues**
   - Verify `TIMEZONE` value in `wrangler.toml`
   - Check browser console for timezone parsing errors

### Debug Mode

Enable debug logging by setting `DEBUG_ENABLED = "true"` in `wrangler.toml`. This will log:
- Email reception details
- Database operations
- Cleanup processes
- Error details

## 📝 License

This project is for personal/educational use. Modify as needed for your requirements.

## 🤝 Contributing

Feel free to fork, modify, and improve this worker for your own needs. Some ideas for enhancements:

- Add authentication/access control
- Support multiple target emails
- Email forwarding capabilities
- Attachment handling
- Search functionality
- Export options 