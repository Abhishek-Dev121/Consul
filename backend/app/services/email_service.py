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
    msg["Subject"] = "You've been invited to Communication Agent"
    msg["From"] = settings.smtp_from
    msg["To"] = to_email
    msg.set_content(
        f"Hi {name},\n\n"
        f"You've been invited to join Communication Agent.\n"
        f"Set your password and activate your account here:\n\n{invite_url}\n\n"
        f"This link expires in {settings.invite_ttl_hours} hours.\n"
    )
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
