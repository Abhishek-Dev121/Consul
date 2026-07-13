"""Best-effort email sending for user invites.

If SMTP is configured in settings, an invite email is sent and `send_invite`
returns True. If not configured (or sending fails), it returns False and the
caller surfaces the invite link in the UI for the admin to share manually.
"""
import smtplib
from email.message import EmailMessage

from app.config import settings


def smtp_configured() -> bool:
    return bool(settings.smtp_host and settings.smtp_from)


def send_invite(to_email: str, name: str, invite_url: str) -> bool:
    if not smtp_configured():
        return False
    msg = EmailMessage()
    msg["Subject"] = "You've been invited to join Consul"
    msg["From"] = settings.smtp_from
    msg["To"] = to_email
    
    text_content = (
        f"Hi {name},\n\n"
        f"You've been invited to join Consul.\n"
        f"Set your password and activate your account here:\n\n{invite_url}\n\n"
        f"This link expires in {settings.invite_ttl_hours} hours.\n"
    )
    msg.set_content(text_content)
    
    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body {{
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          background-color: #f4f5f6;
          color: #2D3748;
          margin: 0;
          padding: 0;
          -webkit-font-smoothing: antialiased;
        }}
        .wrapper {{
          background-color: #f4f5f6;
          padding: 40px 20px;
          text-align: center;
        }}
        .container {{
          max-width: 580px;
          margin: 0 auto;
          background: #ffffff;
          border-radius: 12px;
          padding: 40px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
          text-align: left;
          border: 1px solid #E2E8F0;
        }}
        .header {{
          text-align: center;
          margin-bottom: 30px;
        }}
        .logo {{
          font-size: 24px;
          font-weight: 700;
          color: #3182CE;
          margin: 0;
          letter-spacing: -0.5px;
        }}
        .title {{
          font-size: 20px;
          font-weight: 600;
          color: #1A202C;
          margin-top: 10px;
          margin-bottom: 20px;
        }}
        p {{
          font-size: 15px;
          line-height: 1.6;
          color: #4A5568;
          margin: 0 0 16px 0;
        }}
        .btn-container {{
          text-align: center;
          margin: 32px 0 24px 0;
        }}
        .btn {{
          display: inline-block;
          background-color: #3182CE;
          color: #ffffff !important;
          font-weight: 600;
          font-size: 15px;
          text-decoration: none;
          padding: 12px 32px;
          border-radius: 8px;
          box-shadow: 0 4px 6px rgba(49, 130, 206, 0.2);
          transition: background-color 0.2s;
        }}
        .footer {{
          margin-top: 32px;
          font-size: 12px;
          color: #A0AEC0;
          text-align: center;
          line-height: 1.5;
        }}
        .divider {{
          border: 0;
          border-top: 1px solid #E2E8F0;
          margin: 32px 0 24px 0;
        }}
      </style>
    </head>
    <body>
      <div class="wrapper">
        <div class="container">
          <div class="header">
            <h1 class="logo">Consul</h1>
          </div>
          <h2 class="title">Join your team on Consul</h2>
          <p>Hi {name},</p>
          <p>You've been invited to join the Consul dashboard. Click the button below to set your password and activate your account:</p>
          
          <div class="btn-container">
            <a href="{invite_url}" class="btn" target="_blank">Activate Account</a>
          </div>
          
          <p style="font-size: 13px; color: #718096; text-align: center; margin-top: 16px;">
            Note: This activation link will expire in {settings.invite_ttl_hours} hours.
          </p>
          
          <hr class="divider">
          
          <div class="footer">
            This is an automated security notification from your Consul team.<br>
            If you did not request this invitation, please ignore this email.
          </div>
        </div>
      </div>
    </body>
    </html>
    """
    msg.add_alternative(html_content, subtype="html")
    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as s:
            if settings.smtp_tls:
                s.starttls()
            if settings.smtp_user:
                s.login(settings.smtp_user, settings.smtp_password)
            s.send_message(msg)
        return True
    except Exception:  # noqa: BLE001 — email is best-effort; link is the fallback
        return False


def send_credentials_email(to_email: str, name: str, password: str) -> bool:
    if not smtp_configured():
        return False
    msg = EmailMessage()
    msg["Subject"] = "Your account credentials for Consul"
    msg["From"] = settings.smtp_from
    msg["To"] = to_email
    
    text_content = (
        f"Hi {name},\n\n"
        f"Your login credentials for Consul have been set or updated by an administrator.\n\n"
        f"You can log in to the dashboard at {settings.app_base_url}/login using:\n"
        f"Email: {to_email}\n"
        f"Password: {password}\n\n"
        f"We recommend changing your password after logging in for security reasons.\n"
    )
    msg.set_content(text_content)
    
    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body {{
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          background-color: #f4f5f6;
          color: #2D3748;
          margin: 0;
          padding: 0;
          -webkit-font-smoothing: antialiased;
        }}
        .wrapper {{
          background-color: #f4f5f6;
          padding: 40px 20px;
          text-align: center;
        }}
        .container {{
          max-width: 580px;
          margin: 0 auto;
          background: #ffffff;
          border-radius: 12px;
          padding: 40px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
          text-align: left;
          border: 1px solid #E2E8F0;
        }}
        .header {{
          text-align: center;
          margin-bottom: 30px;
        }}
        .logo {{
          font-size: 24px;
          font-weight: 700;
          color: #3182CE;
          margin: 0;
          letter-spacing: -0.5px;
        }}
        .title {{
          font-size: 20px;
          font-weight: 600;
          color: #1A202C;
          margin-top: 10px;
          margin-bottom: 20px;
        }}
        p {{
          font-size: 15px;
          line-height: 1.6;
          color: #4A5568;
          margin: 0 0 16px 0;
        }}
        .credentials-card {{
          background-color: #F7FAFC;
          border: 1px solid #EDF2F7;
          border-radius: 8px;
          padding: 20px;
          margin: 24px 0;
        }}
        .credential-row {{
          margin-bottom: 10px;
          font-size: 15px;
        }}
        .credential-row:last-child {{
          margin-bottom: 0;
        }}
        .label {{
          font-weight: 600;
          color: #718096;
          display: inline-block;
          width: 100px;
        }}
        .value {{
          color: #2D3748;
          font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, Courier, monospace;
          background-color: #EDF2F7;
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 14px;
        }}
        .btn-container {{
          text-align: center;
          margin: 32px 0 24px 0;
        }}
        .btn {{
          display: inline-block;
          background-color: #3182CE;
          color: #ffffff !important;
          font-weight: 600;
          font-size: 15px;
          text-decoration: none;
          padding: 12px 32px;
          border-radius: 8px;
          box-shadow: 0 4px 6px rgba(49, 130, 206, 0.2);
          transition: background-color 0.2s;
        }}
        .footer {{
          margin-top: 32px;
          font-size: 12px;
          color: #A0AEC0;
          text-align: center;
          line-height: 1.5;
        }}
        .divider {{
          border: 0;
          border-top: 1px solid #E2E8F0;
          margin: 32px 0 24px 0;
        }}
      </style>
    </head>
    <body>
      <div class="wrapper">
        <div class="container">
          <div class="header">
            <h1 class="logo">Consul</h1>
          </div>
          <h2 class="title">Welcome to Consul!</h2>
          <p>Hi {name},</p>
          <p>Your login credentials for Consul have been set or updated by an administrator. You can now log in to your dashboard to manage channels, chats, and clients.</p>
          
          <div class="credentials-card">
            <div class="credential-row">
              <span class="label">Email:</span>
              <span class="value">{to_email}</span>
            </div>
            <div class="credential-row">
              <span class="label">Password:</span>
              <span class="value">{password}</span>
            </div>
          </div>
          
          <div class="btn-container">
            <a href="{settings.app_base_url}/login" class="btn" target="_blank">Log In to Dashboard</a>
          </div>
          
          <p style="font-size: 13px; color: #718096; text-align: center; margin-top: 16px;">
            For security reasons, we highly recommend changing your password after logging in.
          </p>
          
          <hr class="divider">
          
          <div class="footer">
            This is an automated security notification from your Consul team.<br>
            If you did not request this account, please contact your administrator.
          </div>
        </div>
      </div>
    </body>
    </html>
    """
    msg.add_alternative(html_content, subtype="html")
    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as s:
            if settings.smtp_tls:
                s.starttls()
            if settings.smtp_user:
                s.login(settings.smtp_user, settings.smtp_password)
            s.send_message(msg)
        return True
    except Exception:
        return False


def send_password_reset_email(to_email: str, name: str, reset_url: str) -> bool:
    if not smtp_configured():
        return False
    msg = EmailMessage()
    msg["Subject"] = "Reset your password for Consul"
    msg["From"] = settings.smtp_from
    msg["To"] = to_email
    
    text_content = (
        f"Hi {name},\n\n"
        f"You requested to reset your password for Consul.\n"
        f"Click the link below to set a new password:\n\n{reset_url}\n\n"
        f"This link will expire in 2 hours. If you did not request this, you can safely ignore this email.\n"
    )
    msg.set_content(text_content)
    
    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body {{
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          background-color: #f4f5f6;
          color: #2D3748;
          margin: 0;
          padding: 0;
          -webkit-font-smoothing: antialiased;
        }}
        .wrapper {{
          background-color: #f4f5f6;
          padding: 40px 20px;
          text-align: center;
        }}
        .container {{
          max-width: 580px;
          margin: 0 auto;
          background: #ffffff;
          border-radius: 12px;
          padding: 40px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
          text-align: left;
          border: 1px solid #E2E8F0;
        }}
        .header {{
          text-align: center;
          margin-bottom: 30px;
        }}
        .logo {{
          font-size: 24px;
          font-weight: 700;
          color: #3182CE;
          margin: 0;
          letter-spacing: -0.5px;
        }}
        .title {{
          font-size: 20px;
          font-weight: 600;
          color: #1A202C;
          margin-top: 10px;
          margin-bottom: 20px;
        }}
        p {{
          font-size: 15px;
          line-height: 1.6;
          color: #4A5568;
          margin: 0 0 16px 0;
        }}
        .btn-container {{
          text-align: center;
          margin: 32px 0 24px 0;
        }}
        .btn {{
          display: inline-block;
          background-color: #3182CE;
          color: #ffffff !important;
          font-weight: 600;
          font-size: 15px;
          text-decoration: none;
          padding: 12px 32px;
          border-radius: 8px;
          box-shadow: 0 4px 6px rgba(49, 130, 206, 0.2);
          transition: background-color 0.2s;
        }}
        .footer {{
          margin-top: 32px;
          font-size: 12px;
          color: #A0AEC0;
          text-align: center;
          line-height: 1.5;
        }}
        .divider {{
          border: 0;
          border-top: 1px solid #E2E8F0;
          margin: 32px 0 24px 0;
        }}
      </style>
    </head>
    <body>
      <div class="wrapper">
        <div class="container">
          <div class="header">
            <h1 class="logo">Consul</h1>
          </div>
          <h2 class="title">Reset your password</h2>
          <p>Hi {name},</p>
          <p>We received a request to reset the password for your Consul account. Click the button below to choose a new password:</p>
          
          <div class="btn-container">
            <a href="{reset_url}" class="btn" target="_blank">Reset Password</a>
          </div>
          
          <p style="font-size: 13px; color: #718096; text-align: center; margin-top: 16px;">
            Note: This reset link will expire in 2 hours. If you did not make this request, you can safely ignore this email.
          </p>
          
          <hr class="divider">
          
          <div class="footer">
            This is an automated security notification from your Consul team.<br>
            If you did not request this, please ignore this email.
          </div>
        </div>
      </div>
    </body>
    </html>
    """
    msg.add_alternative(html_content, subtype="html")
    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as s:
            if settings.smtp_tls:
                s.starttls()
            if settings.smtp_user:
                s.login(settings.smtp_user, settings.smtp_password)
            s.send_message(msg)
        return True
    except Exception:
        return False
