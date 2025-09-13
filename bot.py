import os
import random
import logging
from motor.motor_asyncio import AsyncIOMotorClient
from telegram import Update
from telegram.ext import (
    Application,
    CommandHandler,
    ContextTypes,
)
from dotenv import load_dotenv

load_dotenv()

BOT_TOKEN = os.getenv("BOT_TOKEN")
MONGO_URL = os.getenv("MONGO_URL")

if not BOT_TOKEN:
    raise RuntimeError("BOT_TOKEN env variable is required")
if not MONGO_URL:
    raise RuntimeError("MONGO_URL env variable is required")

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s", level=logging.INFO
)

mongo_client = AsyncIOMotorClient(MONGO_URL)
db = mongo_client.telegram_md_bot
users_collection = db.users
links_collection = db.device_links


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    await users_collection.update_one(
        {"_id": user.id},
        {
            "$set": {
                "username": user.username,
                "first_name": user.first_name,
                "last_name": user.last_name,
                "joined": update.effective_message.date,
            }
        },
        upsert=True,
    )
    await update.message.reply_text(
        f"Hello, {user.first_name}! Welcome to the bot. Use /help to see commands."
    )


async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    help_text = (
        "/start - Start the bot\n"
        "/help - Show this help message\n"
        "/ping - Check bot response\n"
        "/connect - Generate device linking code\n"
    )
    await update.message.reply_text(help_text)


async def ping(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("Pong! Bot is alive and responding.")


async def connect(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    existing = await links_collection.find_one({"userId": user.id})
    if existing:
        await update.message.reply_text(
            f"🔗 You are already linked! Your code: {existing['code']}"
        )
        return

    linking_code = str(random.randint(100000, 999999))
    await links_collection.update_one(
        {"userId": user.id},
        {"$set": {"userId": user.id, "code": linking_code, "linkedAt": update.effective_message.date}},
        upsert=True,
    )
    await update.message.reply_text(
        f"🔗 Your device linking code has been generated:\n\n{linking_code}\n\n"
        "Use this code in your app or website to link your device with this bot."
    )


async def main():
    app = Application.builder().token(BOT_TOKEN).build()

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("help", help_command))
    app.add_handler(CommandHandler("ping", ping))
    app.add_handler(CommandHandler("connect", connect))

    print("Bot is starting...")
    await app.run_polling()


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
