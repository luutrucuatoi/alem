import PostalMime from 'postal-mime';

// Helper function to format dates with timezone
function formatDateWithTimezone(dateString, timezone) {
  try {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  } catch (error) {
    console.error('Error formatting date:', error);
    return dateString; // fallback to original string
  }
}

// Helper function to clean up old emails based on retention setting
async function cleanupOldEmails(env) {
  try {
    const retentionMinutes = parseInt(env.EMAIL_RETENTION_MINUTES || '15');
    const cutoffTime = new Date(Date.now() - retentionMinutes * 60 * 1000).toISOString();
    
    if (env.DEBUG_ENABLED === 'true') {
      console.log(`Cleaning up emails older than ${retentionMinutes} minutes: ${cutoffTime}`);
    }
    
    // First, count how many emails will be deleted
    const countResult = await env.D1.prepare(
      `SELECT COUNT(*) as count FROM emails WHERE received_at < ?`
    ).bind(cutoffTime).first();
    
    // Delete old emails
    const deleteResult = await env.D1.prepare(
      `DELETE FROM emails WHERE received_at < ?`
    ).bind(cutoffTime).run();
    
    if (env.DEBUG_ENABLED === 'true') {
      console.log(`Cleanup completed: ${countResult.count} emails deleted, success: ${deleteResult.success}`);
    }
    
    return {
      deleted_count: countResult.count,
      success: deleteResult.success,
      retention_minutes: retentionMinutes
    };
  } catch (error) {
    console.error('Error during email cleanup:', error);
    const retentionMinutes = parseInt(env.EMAIL_RETENTION_MINUTES || '15');
    return {
      deleted_count: 0,
      success: false,
      retention_minutes: retentionMinutes,
      error: error.message
    };
  }
}

// Main entry for your Worker
export default {
  // Handle incoming emails
  async email(message, env, ctx) {
    try {
      // Debug logging (configurable)
      if (env.DEBUG_ENABLED === 'true') {
        console.log('Email received:', {
          to: message.to,
          from: message.from,
          rawSize: message.rawSize,
          hasHeaders: !!message.headers,
          hasRaw: !!message.raw
        });
      }
      
      // Only capture emails sent to the configured target email
      const targetEmail = env.TARGET_EMAIL;
      const isForTarget = message.to && message.to.trim() === targetEmail;
      
      if (env.DEBUG_ENABLED === 'true') {
        console.log('Email check result:', {
          to: message.to,
          targetEmail: targetEmail,
          isForTarget,
          exactMatch: message.to === targetEmail
        });
      }
      
      if (!isForTarget) {
        if (env.DEBUG_ENABLED === 'true') {
          console.log(`Email rejected - sent to ${message.to}, not ${targetEmail}`);
        }
        return new Response(`Not for ${targetEmail}`, { status: 550 });
      }
      
      if (env.DEBUG_ENABLED === 'true') {
        console.log(`Email accepted - sent to ${message.to}`);
      }

      // Parse the raw email with postal-mime
      if (env.DEBUG_ENABLED === 'true') {
        console.log('Parsing email with PostalMime...');
      }
      const email = await PostalMime.parse(message.raw);
      
      if (env.DEBUG_ENABLED === 'true') {
        console.log('Email parsed:', {
          from: email.from?.address,
          subject: email.subject,
          hasText: !!email.text,
          hasHtml: !!email.html,
          textLength: email.text?.length || 0,
          htmlLength: email.html?.length || 0
        });
      }

      // Store the email into D1 database
      if (env.DEBUG_ENABLED === 'true') {
        console.log('Attempting to store email in D1...');
      }
      const insertResult = await env.D1.prepare(
        `INSERT INTO emails (recipient, sender, subject, body, html, received_at)
         VALUES (?, ?, ?, ?, ?, ?);`
      ).bind(
        message.to,
        email.from?.address || message.from || '',
        email.subject || '',
        email.text || '',
        email.html || '',
        new Date().toISOString()
      ).run();

      if (env.DEBUG_ENABLED === 'true') {
        console.log('Email stored successfully in D1:', {
          success: insertResult.success,
          insertId: insertResult.meta?.last_row_id
        });
      }

      // Clean up old emails after storing new one
      if (env.DEBUG_ENABLED === 'true') {
        console.log('Running cleanup after email storage...');
      }
      const cleanupResult = await cleanupOldEmails(env);
      if (env.DEBUG_ENABLED === 'true') {
        console.log('Cleanup result:', cleanupResult);
      }

      return new Response('Email stored', { status: 200 });
    } catch (error) {
      console.error('Error in email handler:', error);
      return new Response(`Error storing email: ${error.message}`, { status: 500 });
    }
  },

  // Handle HTTP requests (fetch events)
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      // GET /health: Check D1 database connection
      if (url.pathname === '/health') {
        try {
          if (env.DEBUG_ENABLED === 'true') {
            console.log('Testing D1 connection...');
          }
          
          // Test basic D1 connection with a simple query
          const testResult = await env.D1.prepare('SELECT 1 as test').first();
          
          // Try to check if emails table exists
          const tableCheck = await env.D1.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='emails'"
          ).first();
          
          const healthData = {
            worker_name: env.WORKER_NAME,
            target_email: env.TARGET_EMAIL,
            debug_enabled: env.DEBUG_ENABLED,
            timezone: env.TIMEZONE,
            status: 'healthy',
            timestamp: formatDateWithTimezone(new Date().toISOString(), env.TIMEZONE),
            timestamp_utc: new Date().toISOString(),
            d1_connection: 'success',
            test_query_result: testResult,
            emails_table_exists: !!tableCheck,
            table_info: tableCheck
          };
          
          if (env.DEBUG_ENABLED === 'true') {
            console.log('D1 health check passed:', healthData);
          }
          
          return new Response(JSON.stringify(healthData, null, 2), {
            headers: { 'Content-Type': 'application/json' }
          });
        } catch (error) {
          console.error('D1 health check failed:', error);
          const errorData = {
            worker_name: env.WORKER_NAME,
            timezone: env.TIMEZONE,
            status: 'unhealthy',
            timestamp: formatDateWithTimezone(new Date().toISOString(), env.TIMEZONE),
            timestamp_utc: new Date().toISOString(),
            d1_connection: 'failed',
            error: error.message,
            error_stack: error.stack
          };
          
          return new Response(JSON.stringify(errorData, null, 2), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }

      // GET /db-init: Initialize the emails table (for debugging)
      if (url.pathname === '/db-init') {
        try {
          if (env.DEBUG_ENABLED === 'true') {
            console.log('Initializing emails table...');
          }
          await env.D1.prepare(`
            CREATE TABLE IF NOT EXISTS emails (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              recipient TEXT NOT NULL,
              sender TEXT,
              subject TEXT,
              body TEXT,
              html TEXT,
              received_at TEXT NOT NULL
            )
          `).run();
          
          return new Response(JSON.stringify({
            worker_name: env.WORKER_NAME,
            timezone: env.TIMEZONE,
            status: 'success',
            timestamp: formatDateWithTimezone(new Date().toISOString(), env.TIMEZONE),
            message: 'Emails table initialized successfully'
          }), {
            headers: { 'Content-Type': 'application/json' }
          });
        } catch (error) {
          console.error('Failed to initialize table:', error);
          return new Response(JSON.stringify({
            worker_name: env.WORKER_NAME,
            timezone: env.TIMEZONE,
            status: 'error',
            timestamp: formatDateWithTimezone(new Date().toISOString(), env.TIMEZONE),
            message: error.message
          }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }

      // GET /emails: List all emails sent to the configured target email
      if (url.pathname === '/emails') {
        if (env.DEBUG_ENABLED === 'true') {
          console.log('Fetching emails from D1...');
        }
        const query = `SELECT id, sender, subject, body, html, received_at FROM emails WHERE recipient=? ORDER BY received_at DESC;`;
        const result = await env.D1.prepare(query).bind(env.TARGET_EMAIL).all();
        
        if (env.DEBUG_ENABLED === 'true') {
          console.log(`Found ${result.results.length} emails`);
        }
        
        // Helper function to strip HTML tags and get plain text
        const stripHtml = (html) => {
          if (!html) return '';
          return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
        };

        // Helper function to get content preview (first 300 chars)
        const getContentPreview = (email) => {
          let content = '';
          if (email.html) {
            content = stripHtml(email.html);
          } else if (email.body) {
            content = email.body;
          }
          return content.length > 300 ? content.substring(0, 300) + '...' : content;
        };

        // Generate email list HTML
        const emailListHtml = result.results.map(email => {
          const preview = getContentPreview(email);
          const date = formatDateWithTimezone(email.received_at, env.TIMEZONE);
          
          return `
            <div class="email-item" onclick="window.location.href='/emails/${email.id}'" style="cursor: pointer;">
              <div class="email-header">
                <h3 class="email-subject">${email.subject || 'No Subject'}</h3>
                <span class="email-date">${date}</span>
              </div>
              <div class="email-preview">
                ${preview || 'No content'}
              </div>
            </div>
          `;
        }).join('');

        const htmlResponse = `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <title>All Emails - ${env.WORKER_NAME}</title>
            <style>
              body { 
                font-family: Arial, sans-serif; 
                max-width: 900px; 
                margin: 0 auto; 
                padding: 20px; 
                background-color: #f5f5f5;
              }
              .header { 
                background: white; 
                padding: 20px; 
                border-radius: 8px; 
                margin-bottom: 20px; 
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
              }
              .header h1 { margin: 0 0 10px 0; color: #333; }
              .header p { margin: 0; color: #666; }
              .email-count { 
                background: #e3f2fd; 
                padding: 10px 15px; 
                border-radius: 5px; 
                margin-bottom: 20px; 
                text-align: center;
                font-weight: bold;
              }
              .email-item {
                background: white;
                border: 1px solid #ddd;
                border-radius: 8px;
                padding: 20px;
                margin-bottom: 15px;
                transition: all 0.2s ease;
                box-shadow: 0 1px 3px rgba(0,0,0,0.1);
              }
              .email-item:hover {
                box-shadow: 0 4px 8px rgba(0,0,0,0.15);
                transform: translateY(-1px);
                border-color: #007cba;
              }
              .email-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 10px;
                border-bottom: 1px solid #eee;
                padding-bottom: 10px;
              }
              .email-subject {
                margin: 0;
                color: #007cba;
                font-size: 18px;
                font-weight: 600;
              }
              .email-date {
                color: #666;
                font-size: 12px;
                white-space: nowrap;
              }
              .email-meta {
                color: #666;
                font-size: 14px;
                margin-bottom: 10px;
              }
              .email-preview {
                color: #333;
                line-height: 1.4;
                font-size: 14px;
              }
              .navigation {
                text-align: center;
                margin-top: 30px;
                padding: 20px;
                background: white;
                border-radius: 8px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
              }
              .navigation a {
                display: inline-block;
                padding: 12px 24px;
                background: #007cba;
                color: white;
                text-decoration: none;
                border-radius: 5px;
                margin: 0 10px;
                font-weight: 500;
              }
              .navigation a:hover {
                background: #005a87;
              }
              .no-emails {
                text-align: center;
                color: #666;
                background: white;
                padding: 40px;
                border-radius: 8px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
              }
            </style>
          </head>
          <body>
            
            <div class="email-count">
              ${result.results.length} email(s) received 
            </div>
            
            ${result.results.length > 0 ? emailListHtml : `
              <div class="no-emails">
                <h2>No emails received yet</h2>
                <p>Waiting for emails to be sent to ${env.TARGET_EMAIL}</p>
              </div>
            `}
            
            <div class="navigation">
              <a href="/">Latest Email</a>
            </div>
          </body>
          </html>
        `;
        
        return new Response(htmlResponse, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }

      // GET /cleanup: Manual cleanup trigger (for testing)
      if (url.pathname === '/cleanup') {
        try {
          if (env.DEBUG_ENABLED === 'true') {
            console.log('Manual cleanup triggered...');
          }
          
          const cleanupResult = await cleanupOldEmails(env);
          
          return new Response(JSON.stringify({
            worker_name: env.WORKER_NAME,
            timezone: env.TIMEZONE,
            status: 'cleanup_completed',
            timestamp: formatDateWithTimezone(new Date().toISOString(), env.TIMEZONE),
            timestamp_utc: new Date().toISOString(),
            cleanup_result: cleanupResult
          }, null, 2), {
            headers: { 'Content-Type': 'application/json' }
          });
        } catch (error) {
          console.error('Manual cleanup failed:', error);
          return new Response(JSON.stringify({
            worker_name: env.WORKER_NAME,
            timezone: env.TIMEZONE,
            status: 'cleanup_failed',
            timestamp: formatDateWithTimezone(new Date().toISOString(), env.TIMEZONE),
            timestamp_utc: new Date().toISOString(),
            error: error.message
          }, null, 2), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }

      // GET /: Redirect to the latest email
      if (url.pathname === '/') {
        if (env.DEBUG_ENABLED === 'true') {
          console.log('Fetching latest email ID for redirect...');
        }
        const query = `SELECT id FROM emails WHERE recipient=? ORDER BY received_at DESC LIMIT 1;`;
        const result = await env.D1.prepare(query).bind(env.TARGET_EMAIL).first();
        
        if (!result) {
          if (env.DEBUG_ENABLED === 'true') {
            console.log('No emails found');
          }
          return new Response('No emails received yet or all emails have been deleted', { status: 404 });
        }

        if (env.DEBUG_ENABLED === 'true') {
          console.log(`Redirecting to latest email with ID: ${result.id}`);
        }

        // Redirect to the latest email
        return Response.redirect(`${url.origin}/emails/${result.id}`, 302);
      }

      // GET /emails/<id>: Show a specific email
      const match = url.pathname.match(/^\/emails\/(\d+)$/);
      if (match) {
        const id = Number(match[1]);
        if (env.DEBUG_ENABLED === 'true') {
          console.log(`Fetching email with ID: ${id}`);
        }
        const query = `SELECT * FROM emails WHERE id=? AND recipient=?;`;
        const result = await env.D1.prepare(query).bind(id, env.TARGET_EMAIL).first();
        if (!result) {
          if (env.DEBUG_ENABLED === 'true') {
            console.log(`Email with ID ${id} not found`);
          }
          return new Response('Not found', { status: 404 });
        }

        // Get previous email (older)
        const prevQuery = `SELECT id FROM emails WHERE recipient=? AND received_at < ? ORDER BY received_at DESC LIMIT 1;`;
        const prevResult = await env.D1.prepare(prevQuery).bind(env.TARGET_EMAIL, result.received_at).first();
        
        // Get next email (newer)
        const nextQuery = `SELECT id FROM emails WHERE recipient=? AND received_at > ? ORDER BY received_at ASC LIMIT 1;`;
        const nextResult = await env.D1.prepare(nextQuery).bind(env.TARGET_EMAIL, result.received_at).first();

        // Create email detail HTML with consistent design
        const emailDetailHtml = `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <title>Email Details - ${env.WORKER_NAME}</title>
            <style>
              body { 
                font-family: Arial, sans-serif; 
                max-width: 900px; 
                margin: 0 auto; 
                padding: 20px; 
                background-color: #f5f5f5;
                line-height: 1.6;
              }
              .header { 
                background: white; 
                padding: 20px; 
                border-radius: 8px; 
                margin-bottom: 20px; 
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
              }
              .header h1 { margin: 0 0 10px 0; color: #333; }
              .header p { margin: 0; color: #666; }
              .email-meta { 
                background: white; 
                padding: 20px; 
                border-radius: 8px; 
                margin-bottom: 20px; 
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
              }
              .email-meta h3 { margin: 0 0 15px 0; color: #333; border-bottom: 2px solid #007cba; padding-bottom: 10px; }
              .email-meta .meta-item { 
                margin-bottom: 10px; 
                padding: 8px 0;
                border-bottom: 1px solid #f0f0f0;
              }
              .email-meta .meta-item:last-child { border-bottom: none; }
              .email-meta strong { color: #555; }
              .email-content { 
                background: white; 
                border-radius: 8px; 
                padding: 25px; 
                margin-bottom: 20px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                min-height: 200px;
              }
              .email-content h2 {
                margin: 0 0 20px 0;
                color: #333;
                border-bottom: 2px solid #007cba;
                padding-bottom: 10px;
              }
              .text-content { 
                white-space: pre-wrap; 
                font-family: 'Courier New', monospace; 
                background: #f8f9fa; 
                padding: 20px; 
                border-radius: 5px; 
                border-left: 4px solid #007cba;
                overflow-x: auto;
              }
              .navigation {
                background: white;
                padding: 20px;
                border-radius: 8px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                text-align: center;
                margin-top: 20px;
              }
              .navigation h3 {
                margin: 0 0 15px 0;
                color: #333;
              }
              .nav-buttons {
                display: flex;
                justify-content: center;
                gap: 10px;
                margin-bottom: 15px;
                flex-wrap: wrap;
              }
              .nav-buttons a, .nav-buttons span {
                display: inline-block;
                padding: 10px 16px;
                border-radius: 5px;
                text-decoration: none;
                font-weight: 500;
                font-size: 14px;
                min-width: 80px;
                text-align: center;
              }
              .nav-buttons a {
                background: #007cba;
                color: white;
                transition: background-color 0.2s ease;
              }
              .nav-buttons a:hover {
                background: #005a87;
              }
              .nav-buttons span {
                background: #e9ecef;
                color: #6c757d;
              }
              .nav-secondary {
                display: flex;
                justify-content: center;
                gap: 10px;
                flex-wrap: wrap;
              }
              .nav-secondary a {
                padding: 8px 16px;
                background: #28a745;
                color: white;
                text-decoration: none;
                border-radius: 5px;
                font-size: 13px;
                transition: background-color 0.2s ease;
              }
              .nav-secondary a:hover {
                background: #1e7e34;
              }
              .nav-secondary a.latest {
                background: #ffc107;
                color: #212529;
              }
              .nav-secondary a.latest:hover {
                background: #e0a800;
              }
            </style>
          </head>
          <body>
            
            
            
            <div class="email-content">
              <h2>Email Content</h2>
              ${result.html ? result.html : `<div class="text-content">${result.body || 'No content available'}</div>`}
            </div>

                         <div class="email-meta">
               <h3>Email Information</h3>
              <div class="meta-item">
                <strong>Subject:</strong> ${result.subject || 'No Subject'}
              </div>
                             <div class="meta-item">
                 <strong>Received:</strong> ${formatDateWithTimezone(result.received_at, env.TIMEZONE)}
               </div>
            </div>
            <div class="navigation">
              <h3>Navigation</h3>
              <div class="nav-buttons">
                ${prevResult ? `<a href="/emails/${prevResult.id}">← Previous Email</a>` : '<span>← Previous Email</span>'}
                ${nextResult ? `<a href="/emails/${nextResult.id}">Next Email →</a>` : '<span>Next Email →</span>'}
              </div>
              <div class="nav-secondary">
                <a href="/emails">All Emails</a>
                <a href="/" class="latest">Latest Email</a>
              </div>
            </div>
          </body>
          </html>
        `;

        return new Response(emailDetailHtml, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }

      return new Response('Not found', { status: 404 });
      
    } catch (error) {
      console.error('Error in fetch handler:', error);
      return new Response(JSON.stringify({
        error: 'Internal server error',
        timezone: env.TIMEZONE,
        timestamp: formatDateWithTimezone(new Date().toISOString(), env.TIMEZONE),
        message: error.message,
        stack: error.stack
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  },

  // Scheduled event handler for periodic cleanup
  async scheduled(event, env, ctx) {
    try {
      if (env.DEBUG_ENABLED === 'true') {
        console.log('Scheduled cleanup started:', new Date().toISOString());
      }
      
      const cleanupResult = await cleanupOldEmails(env);
      
      if (env.DEBUG_ENABLED === 'true') {
        console.log('Scheduled cleanup completed:', cleanupResult);
      }
      
      return cleanupResult;
    } catch (error) {
      console.error('Error in scheduled cleanup:', error);
      return {
        deleted_count: 0,
        success: false,
        error: error.message
      };
    }
  }
}
