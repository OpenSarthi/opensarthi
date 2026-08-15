"""
Social Media Posting Tools — Mark-L Parity Feature

- twitter_post: Post tweet / reply / delete
- linkedin_post: Post to LinkedIn
- telegram_send: Send to channel/group/DM
- whatsapp_send: Send via WhatsApp Web automation
- discord_send: Send via webhook or bot
- email_send: Send via SMTP
"""
import asyncio
import structlog
from typing import Dict, Any, Optional, List

from tools.base import BaseTool, RiskLevel, ToolResult

logger = structlog.get_logger()


class TwitterPostTool(BaseTool):
    """Post to Twitter (X)."""

    name = "twitter_post"
    description = "Post a tweet, reply, or delete on Twitter/X."
    schema = {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["post", "reply", "delete"], "default": "post"},
            "text": {"type": "string", "description": "Tweet text (required for post/reply)"},
            "reply_to_id": {"type": "string", "description": "Tweet ID to reply to"},
            "tweet_id": {"type": "string", "description": "Tweet ID to delete"},
            "media_paths": {"type": "array", "items": {"type": "string"}, "description": "Paths to media files"},
        },
        "required": [],
    }
    risk_level = RiskLevel.DANGEROUS

    async def execute(self, args: Dict[str, Any]) -> ToolResult:
        action = args.get("action", "post")

        # Require OAuth tokens
        from config import settings
        if not getattr(settings, "twitter_api_key", None):
            return ToolResult(
                success=False,
                result=None,
                error="Twitter API not configured. Set TWITTER_API_KEY and tokens.",
            )

        try:
            import tweepy

            client = tweepy.Client(
                consumer_key=settings.twitter_api_key,
                consumer_secret=settings.twitter_api_secret,
                access_token=settings.twitter_access_token,
                access_token_secret=settings.twitter_access_token_secret,
            )

            if action == "post":
                text = args.get("text", "")
                media_paths = args.get("media_paths", [])
                media_ids = []
                for path in media_paths:
                    media = client.media_upload(path)
                    media_ids.append(media.media_id)
                response = client.create_tweet(text=text, media_ids=media_ids if media_ids else None)
                return ToolResult(success=True, result={"tweet_id": response.data["id"]})

            elif action == "reply":
                text = args.get("text", "")
                reply_to = args.get("reply_to_id", "")
                response = client.create_tweet(text=text, in_reply_to_tweet_id=reply_to)
                return ToolResult(success=True, result={"tweet_id": response.data["id"]})

            elif action == "delete":
                tweet_id = args.get("tweet_id", "")
                client.delete_tweet(tweet_id)
                return ToolResult(success=True, result="Tweet deleted")

        except ImportError:
            return ToolResult(success=False, result=None, error="tweepy not installed")
        except Exception as e:
            logger.error("Twitter post failed", error=str(e))
            return ToolResult(success=False, result=None, error=str(e))


class LinkedInPostTool(BaseTool):
    """Post to LinkedIn."""

    name = "linkedin_post"
    description = "Post to LinkedIn."
    schema = {
        "type": "object",
        "properties": {
            "text": {"type": "string", "description": "Post text"},
            "media_paths": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["text"],
    }
    risk_level = RiskLevel.DANGEROUS

    async def execute(self, args: Dict[str, Any]) -> ToolResult:
        from config import settings
        if not getattr(settings, "linkedin_access_token", None):
            return ToolResult(
                success=False,
                result=None,
                error="LinkedIn not configured. Set LINKEDIN_ACCESS_TOKEN.",
            )

        try:
            import httpx
            text = args["text"]
            media_paths = args.get("media_paths", [])

            async with httpx.AsyncClient() as client:
                # Create post
                response = await client.post(
                    "https://api.linkedin.com/v2/ugcPosts",
                    headers={
                        "Authorization": f"Bearer {settings.linkedin_access_token}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "author": f"urn:li:person:{settings.linkedin_person_id}",
                        "lifecycleState": "PUBLISHED",
                        "specificContent": {
                            "com.linkedin.ugc.ShareContent": {
                                "shareCommentary": {"text": text},
                                "shareMediaCategory": "NONE",
                            }
                        },
                        "visibility": {"com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"},
                    },
                    timeout=10,
                )
                response.raise_for_status()
                return ToolResult(success=True, result=response.json())

        except Exception as e:
            logger.error("LinkedIn post failed", error=str(e))
            return ToolResult(success=False, result=None, error=str(e))


class TelegramSendTool(BaseTool):
    """Send message via Telegram Bot."""

    name = "telegram_send"
    description = "Send a message to a Telegram channel, group, or DM via bot."
    schema = {
        "type": "object",
        "properties": {
            "chat_id": {"type": "string", "description": "Chat/channel ID (e.g., @channel or -123456789)"},
            "text": {"type": "string", "description": "Message text"},
            "parse_mode": {"type": "string", "enum": ["Markdown", "HTML"], "default": "Markdown"},
        },
        "required": ["chat_id", "text"],
    }
    risk_level = RiskLevel.MODERATE

    async def execute(self, args: Dict[str, Any]) -> ToolResult:
        from config import settings
        if not getattr(settings, "telegram_bot_token", None):
            return ToolResult(
                success=False,
                result=None,
                error="Telegram not configured. Set TELEGRAM_BOT_TOKEN.",
            )

        try:
            import httpx
            chat_id = args["chat_id"]
            text = args["text"]
            parse_mode = args.get("parse_mode", "Markdown")

            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"https://api.telegram.org/bot{settings.telegram_bot_token}/sendMessage",
                    json={
                        "chat_id": chat_id,
                        "text": text,
                        "parse_mode": parse_mode,
                    },
                    timeout=10,
                )
                response.raise_for_status()
                return ToolResult(success=True, result=response.json())

        except Exception as e:
            logger.error("Telegram send failed", error=str(e))
            return ToolResult(success=False, result=None, error=str(e))


class WhatsAppSendTool(BaseTool):
    """Send via WhatsApp Web automation."""

    name = "whatsapp_send"
    description = "Send a WhatsApp message via browser automation (requires QR login)."
    schema = {
        "type": "object",
        "properties": {
            "phone": {"type": "string", "description": "Phone number with country code (e.g., +15551234567)"},
            "text": {"type": "string", "description": "Message text"},
        },
        "required": ["phone", "text"],
    }
    risk_level = RiskLevel.DANGEROUS

    async def execute(self, args: Dict[str, Any]) -> ToolResult:
        try:
            from tools.browser import browser_go_to, browser_click, browser_type, browser_press
            phone = args["phone"]
            text = args["text"]

            # Open WhatsApp Web
            await browser_go_to.execute({"url": "https://web.whatsapp.com/"})

            # Wait for QR/login (would need manual first time)
            await asyncio.sleep(3)

            # Search for contact
            await browser_click.execute({"selector": 'div[title="Search"]'})
            await browser_type.execute({"selector": 'div[title="Search"]', "text": phone, "press_enter": True})
            await asyncio.sleep(2)

            # Type message
            await browser_type.execute({"selector": 'div[data-testid="conversation-compose-box-input"]', "text": text, "press_enter": True})

            return ToolResult(success=True, result=f"Message sent to {phone}")

        except Exception as e:
            logger.error("WhatsApp send failed", error=str(e))
            return ToolResult(success=False, result=None, error=str(e))


class DiscordSendTool(BaseTool):
    """Send via Discord webhook."""

    name = "discord_send"
    description = "Send a message to Discord via webhook."
    schema = {
        "type": "object",
        "properties": {
            "webhook_url": {"type": "string", "description": "Discord webhook URL"},
            "text": {"type": "string", "description": "Message text"},
            "username": {"type": "string", "description": "Override webhook username"},
            "avatar_url": {"type": "string", "description": "Override webhook avatar"},
        },
        "required": ["webhook_url", "text"],
    }
    risk_level = RiskLevel.MODERATE

    async def execute(self, args: Dict[str, Any]) -> ToolResult:
        try:
            import httpx
            webhook_url = args["webhook_url"]
            text = args["text"]
            username = args.get("username")
            avatar_url = args.get("avatar_url")

            payload = {"content": text}
            if username:
                payload["username"] = username
            if avatar_url:
                payload["avatar_url"] = avatar_url

            async with httpx.AsyncClient() as client:
                response = await client.post(webhook_url, json=payload, timeout=10)
                response.raise_for_status()
                return ToolResult(success=True, result="Message sent to Discord")

        except Exception as e:
            logger.error("Discord send failed", error=str(e))
            return ToolResult(success=False, result=None, error=str(e))


class EmailSendTool(BaseTool):
    """Send email via SMTP."""

    name = "email_send"
    description = "Send an email via SMTP."
    schema = {
        "type": "object",
        "properties": {
            "to": {"type": "string", "description": "Recipient email"},
            "subject": {"type": "string", "description": "Email subject"},
            "body": {"type": "string", "description": "Email body"},
            "html": {"type": "boolean", "default": False, "description": "Body is HTML"},
            "attachments": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["to", "subject", "body"],
    }
    risk_level = RiskLevel.DANGEROUS

    async def execute(self, args: Dict[str, Any]) -> ToolResult:
        from config import settings
        if not getattr(settings, "smtp_host", None):
            return ToolResult(
                success=False,
                result=None,
                error="SMTP not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS.",
            )

        try:
            import smtplib
            from email.mime.text import MIMEText
            from email.mime.multipart import MIMEMultipart
            from email.mime.base import MIMEBase
            from email import encoders

            to = args["to"]
            subject = args["subject"]
            body = args["body"]
            html = args.get("html", False)
            attachments = args.get("attachments", [])

            msg = MIMEMultipart()
            msg["From"] = settings.smtp_user
            msg["To"] = to
            msg["Subject"] = subject

            if html:
                msg.attach(MIMEText(body, "html"))
            else:
                msg.attach(MIMEText(body, "plain"))

            for path in attachments:
                part = MIMEBase("application", "octet-stream")
                with open(path, "rb") as f:
                    part.set_payload(f.read())
                encoders.encode_base64(part)
                part.add_header("Content-Disposition", f"attachment; filename={path.split('/')[-1]}")
                msg.attach(part)

            with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as server:
                server.starttls()
                server.login(settings.smtp_user, settings.smtp_pass)
                server.send_message(msg)

            return ToolResult(success=True, result=f"Email sent to {to}")

        except Exception as e:
            logger.error("Email send failed", error=str(e))
            return ToolResult(success=False, result=None, error=str(e))


# Tool instances
twitter_post_tool = TwitterPostTool()
linkedin_post_tool = LinkedInPostTool()
telegram_send_tool = TelegramSendTool()
whatsapp_send_tool = WhatsAppSendTool()
discord_send_tool = DiscordSendTool()
email_send_tool = EmailSendTool()