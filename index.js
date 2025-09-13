const { Telegraf, Markup, session } = require('telegraf');
const { MongoClient } = require('mongodb');
require('dotenv').config();

// Check if required environment variables exist
if (!process.env.BOT_TOKEN) {
  console.error('❌ ERROR: BOT_TOKEN environment variable is required');
  process.exit(1);
}

// Initialize bot
const bot = new Telegraf(process.env.BOT_TOKEN);

// Session middleware for user data
bot.use(session());

// MongoDB connection
let mongoClient;
let db, usersCollection, sessionsCollection, settingsCollection, linksCollection;

async function connectDB() {
  const mongoUri = process.env.MONGO_URL;

  if (!mongoUri) {
    console.warn('⚠️  MONGO_URL not provided. Running without database...');
    return;
  }

  try {
    console.log('🔗 Attempting to connect to MongoDB...');
    // Connection options with TLS explicitly enabled
    const options = {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      tls: true,
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    };

    mongoClient = new MongoClient(mongoUri, options);
    await mongoClient.connect();

    // Database name extracted from URI or set default
    const dbName = mongoUri.split('/').pop().split('?')[0] || 'telegram_md_bot';

    db = mongoClient.db(dbName);

    usersCollection = db.collection('users');
    sessionsCollection = db.collection('sessions');
    settingsCollection = db.collection('settings');
    linksCollection = db.collection('device_links');

    console.log('✅ Connected to MongoDB successfully');

    await usersCollection.createIndex({ _id: 1 });
    await sessionsCollection.createIndex({ userId: 1 });
    await linksCollection.createIndex({ userId: 1 }, { unique: true });
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    console.warn('⚠️  Running without database functionality');
  }
}

async function initSettings() {
  if (!settingsCollection) return;

  try {
    const defaultSettings = await settingsCollection.findOne({ _id: 'global' });
    if (!defaultSettings) {
      await settingsCollection.insertOne({
        _id: 'global',
        autoreact: true,
        autoreact_emojis: ['👍', '❤️', '🔥'],
        max_sessions: 3,
        allow_broadcast: true,
      });
      console.log('✅ Default settings initialized');
    }
  } catch (error) {
    console.error('❌ Error initializing settings:', error.message);
  }
}

function isAdmin(ctx) {
  const admins = process.env.ADMINS ? process.env.ADMINS.split(',') : [];
  return admins.includes(ctx.from.id.toString());
}

function formatUptime(seconds) {
  const days = Math.floor(seconds / (3600 * 24));
  const hours = Math.floor((seconds % (3600 * 24)) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  return `${days}d ${hours}h ${minutes}m`;
}

// ==================== AUTO FEATURES & MESSAGE HANDLER ====================

bot.on('message', async (ctx, next) => {
  if (ctx.message.text && ctx.message.text.startsWith('/')) {
    return next();
  }

  try {
    if (settingsCollection) {
      const settings = await settingsCollection.findOne({ _id: 'global' });
      if (settings && settings.autoreact && ctx.message.text) {
        const randomEmoji = settings.autoreact_emojis[
          Math.floor(Math.random() * settings.autoreact_emojis.length)
        ];
        try {
          await ctx.react(randomEmoji);
        } catch {
          // Ignore reaction errors
        }
      }
    }
  } catch (error) {
    console.error('Error in message handler:', error);
  }
  return next();
});

// ==================== COMMAND HANDLERS ====================

bot.start(async (ctx) => {
  if (usersCollection) {
    try {
      await usersCollection.updateOne(
        { _id: ctx.from.id },
        {
          $set: {
            username: ctx.from.username,
            first_name: ctx.from.first_name,
            last_name: ctx.from.last_name,
            joined: new Date(),
            is_premium: ctx.from.is_premium || false,
          },
        },
        { upsert: true }
      );
    } catch (error) {
      console.error('Database error:', error.message);
    }
  }

  ctx.reply(
    `👋 Welcome ${ctx.from.first_name}! I'm your personal MD bot for Telegram.\n\n` +
      `Use /help to see all available commands.`,
    { parse_mode: 'Markdown' }
  );
});

bot.help((ctx) => {
  const helpText = `
🤖 *PERSONAL MD BOT COMMANDS* 🤖

*🔧 Core Features:*
/start - Start the bot
/help - Show this help message
/stats - Show your statistics
/ping - Check bot response time

*⚙️ Settings:*
/autoreact [on/off] - Toggle auto reactions
/autoreply [on/off] - Toggle auto replies
/setautoreply [message] - Set auto reply message
/session - Manage your sessions

*📨 Message Tools:*
/schedule [time] [message] - Schedule a message
/broadcast [message] - Broadcast to your chats (Admin)
/copy - Copy message format
/quote - Quote a message

*🎨 Content Tools:*
/sticker [query] - Search for stickers (Not implemented)
/gif [query] - Search for GIFs (Not implemented)
/font [text] - Change text font
/tts [text] - Text to speech (Integrated)
/connect - Link your device (new command)

*🛡️ Privacy:*
/block - Block a user (DB required)
/unblock - Unblock a user (DB required)
/ignore - Ignore a chat (DB required)
/mute - Mute a chat (DB required)

*👨‍💻 Admin Only:*
/broadcast [message] - Broadcast to all users
/stats - Bot statistics
/restart - Restart bot

Use /command for more info about a specific command.
  `;

  ctx.replyWithMarkdown(helpText);
});

bot.command('connect', async (ctx) => {
  if (!linksCollection) {
    return ctx.reply('❌ Database connection required for linking your device.');
  }

  const existingLink = await linksCollection.findOne({ userId: ctx.from.id });
  if (existingLink) {
    return ctx.reply('🔗 Your device is already linked!');
  }

  const linkingCode = Math.floor(100000 + Math.random() * 900000).toString();

  await linksCollection.updateOne(
    { userId: ctx.from.id },
    { $set: { userId: ctx.from.id, code: linkingCode, linkedAt: new Date() } },
    { upsert: true }
  );

  ctx.reply(
    `🔗 Your device linking code is:\n\n*${linkingCode}*\n\n` +
      'Use this code in your app or website to link your device with this bot.',
    { parse_mode: 'Markdown' }
  );
});

bot.command('tts', async (ctx) => {
  const text = ctx.message.text.replace('/tts', '').trim();
  if (!text) {
    return ctx.reply('Please provide text. Usage: /tts Hello world');
  }

  try {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&q=${encodeURIComponent(
      text
    )}&tl=en`;

    await ctx.replyWithChatAction('upload_voice');
    await ctx.telegram.sendVoice(ctx.chat.id, url, { caption: `🗣️ TTS for: "${text}"` });
  } catch (error) {
    console.error('TTS error:', error);
    ctx.reply('❌ Failed to generate TTS audio.');
  }
});

bot.command('broadcast', async (ctx) => {
  if (!isAdmin(ctx)) {
    return ctx.reply('❌ This command is only available for admins.');
  }

  if (!usersCollection) {
    return ctx.reply('❌ Database not available for broadcast.');
  }

  const message = ctx.message.text.replace('/broadcast', '').trim();
  if (!message) {
    return ctx.reply('Please provide a message to broadcast. Usage: /broadcast Your message here');
  }

  try {
    const users = await usersCollection.find({}).toArray();
    let successCount = 0;
    let failCount = 0;

    ctx.reply(`📢 Starting broadcast to ${users.length} users...`);

    for (const user of users) {
      try {
        await ctx.telegram.sendMessage(user._id, `📢 *BROADCAST FROM ADMIN:*\n\n${message}`, { parse_mode: 'Markdown' });
        successCount++;
        await new Promise((res) => setTimeout(res, 100));
      } catch (error) {
        console.error(`Failed to send to user ${user._id}:`, error);
        failCount++;
      }
    }

    ctx.reply(`✅ Broadcast completed!\nSuccess: ${successCount}\nFailed: ${failCount}`);
  } catch (error) {
    console.error('Broadcast error:', error);
    ctx.reply('❌ An error occurred during broadcast.');
  }
});

bot.command('stats', async (ctx) => {
  let userCount = 'N/A';
  let sessionCount = 'N/A';

  if (usersCollection && sessionsCollection) {
    try {
      userCount = await usersCollection.countDocuments();
      sessionCount = await sessionsCollection.countDocuments();
    } catch (error) {
      console.error('Database error in stats:', error.message);
    }
  }

  const statsText = `
📊 *YOUR STATISTICS*

👤 Your ID: ${ctx.from.id}
📅 Joined: ${new Date().toLocaleDateString()}
👥 Total Users: ${userCount}
🔗 Active Sessions: ${sessionCount}
⚡ Uptime: ${formatUptime(process.uptime())}
${!process.env.MONGO_URL ? '\n⚠️ *Running in memory mode (no database)*' : ''}
  `;

  ctx.replyWithMarkdown(statsText);
});

// Add your other commands here (autoreact, schedule, font, etc.) from your previous code

// ==================== START THE BOT ====================

async function startBot() {
  try {
    console.log('🔧 Starting Personal MD Telegram Bot...');
    console.log('🤖 Bot token:', process.env.BOT_TOKEN ? '✅ Provided' : '❌ Missing');

    const mongoUri = process.env.MONGO_URL;
    console.log('🗄️  MongoDB URI:', mongoUri ? '✅ Provided' : '❌ Missing');

    await connectDB();
    await initSettings();

    await bot.launch();

    console.log('✅ Personal MD Telegram Bot is running!');

    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
  } catch (error) {
    console.error('❌ Failed to start bot:', error.message);
    process.exit(1);
  }
}

startBot();
