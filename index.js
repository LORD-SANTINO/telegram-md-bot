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
let db, usersCollection, sessionsCollection, settingsCollection;

async function connectDB() {
  const mongoUri = process.env.MONGO_URL || process.env.MONGODB_URI;

  if (!mongoUri) {
    console.warn('⚠️  MONGO_URL not provided. Running without database...');
    return;
  }

  try {
    console.log('🔗 Attempting to connect to MongoDB...');
    const options = {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    };

    mongoClient = new MongoClient(mongoUri, options);
    await mongoClient.connect();

    const dbName = mongoUri.split('/').pop().split('?')[0] || 'telegram_md_bot';
    db = mongoClient.db(dbName);

    usersCollection = db.collection('users');
    sessionsCollection = db.collection('sessions');
    settingsCollection = db.collection('settings');

    console.log('✅ Connected to MongoDB successfully');

    // Create indexes
    await usersCollection.createIndex({ _id: 1 });
    await sessionsCollection.createIndex({ userId: 1 });
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

// Check if user is admin
function isAdmin(ctx) {
  const admins = process.env.ADMINS ? process.env.ADMINS.split(',') : [];
  return admins.includes(ctx.from.id.toString());
}

// Format uptime function
function formatUptime(seconds) {
  const days = Math.floor(seconds / (3600 * 24));
  const hours = Math.floor((seconds % (3600 * 24)) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  return `${days}d ${hours}h ${minutes}m`;
}

// ==================== AUTO FEATURES & MESSAGE HANDLER ====================

// Fixed message handler - pass command messages on so command handlers receive them
bot.on('message', async (ctx, next) => {
  if (ctx.message.text && ctx.message.text.startsWith('/')) {
    return next(); // Pass command messages on
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
        } catch (error) {
          // Reaction might not be supported or forbidden, ignore error
        }
      }
    }
  } catch (error) {
    console.error('Error in message handler:', error);
  }
  return next();
});

// ==================== COMMAND HANDLERS ====================

// /start command
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
      `I can help you automate tasks, manage messages, and more!\n\n` +
      `🔧 *Available Features:*\n` +
      `• Auto-reply to messages\n` +
      `• Auto-reactions to posts\n` +
      `• Message scheduling\n` +
      `• Chat management\n` +
      `• And much more!\n\n` +
      `Use /help to see all available commands.`,
    { parse_mode: 'Markdown' }
  );
});

// /help command
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
/sticker [query] - Search for stickers
/gif [query] - Search for GIFs
/font [text] - Change text font
/tts [text] - Text to speech

*🛡️ Privacy:*
/block - Block a user
/unblock - Unblock a user
/ignore - Ignore a chat
/mute - Mute a chat

*👨‍💻 Admin Only:*
/broadcast [message] - Broadcast to all users
/stats - Bot statistics
/restart - Restart bot

Use /command for more info about a specific command.
  `;

  ctx.replyWithMarkdown(helpText);
});

// /autoreact command
bot.command('autoreact', async (ctx) => {
  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    const settings = await settingsCollection.findOne({ _id: 'global' });
    return ctx.reply(`Auto-reactions are currently ${settings?.autoreact ? 'ON' : 'OFF'}. Use /autoreact on or /autoreact off`);
  }

  const state = args[1].toLowerCase();
  if (state !== 'on' && state !== 'off') {
    return ctx.reply('Please specify "on" or "off". Usage: /autoreact on');
  }

  if (settingsCollection) {
    await settingsCollection.updateOne(
      { _id: 'global' },
      { $set: { autoreact: state === 'on' } }
    );
  }

  ctx.reply(`✅ Auto-reactions have been turned ${state.toUpperCase()}.`);
});

// /schedule command
bot.command('schedule', async (ctx) => {
  const args = ctx.message.text.split(' ');
  if (args.length < 3) {
    return ctx.reply('Please specify time and message. Usage: /schedule 5m Hello world!');
  }

  const time = args[1];
  const message = args.slice(2).join(' ');

  let milliseconds = 0;
  if (time.endsWith('s')) {
    milliseconds = parseInt(time) * 1000;
  } else if (time.endsWith('m')) {
    milliseconds = parseInt(time) * 60 * 1000;
  } else if (time.endsWith('h')) {
    milliseconds = parseInt(time) * 60 * 60 * 1000;
  } else {
    return ctx.reply('Please specify time with unit (s, m, h). Example: 5m, 1h, 30s');
  }

  ctx.reply(`✅ Message scheduled to be sent in ${time}.`);

  setTimeout(async () => {
    try {
      await ctx.reply(`⏰ Scheduled message: ${message}`);
    } catch (error) {
      console.error('Error sending scheduled message:', error);
    }
  }, milliseconds);
});

// /font command
bot.command('font', (ctx) => {
  const text = ctx.message.text.replace('/font', '').trim();
  if (!text) {
    return ctx.reply('Please provide text. Usage: /font Hello world');
  }

  const fonts = {
    bold: `*${text}*`,
    italic: `_${text}_`,
    mono: '``````',
    strike: `~${text}~`,
    underline: `__${text}__`,
  };

  let response = `🔠 *Font Styles:*\n\n`;
  response += `*Bold:* ${fonts.bold}\n`;
  response += `_Italic:_ ${fonts.italic}\n`;
  response += `Monospace: ${fonts.mono}\n`;
  response += `~Strikethrough:~ ${fonts.strike}\n`;
  response += `__Underline:__ ${fonts.underline}`;

  ctx.replyWithMarkdown(response);
});

// /tts command
bot.command('tts', (ctx) => {
  const text = ctx.message.text.replace('/tts', '').trim();
  if (!text) {
    return ctx.reply('Please provide text. Usage: /tts Hello world');
  }

  ctx.replyWithMarkdown(`🗣️ *Text to Speech:*\n\n"${text}"\n\n*(This is a simulation. In a real implementation, this would use TTS API)*`);
});

// /broadcast command (admin only)
bot.command('broadcast', async (ctx) => {
  if (!isAdmin(ctx)) {
    return ctx.reply('❌ This command is only available for admins.');
  }

  const message = ctx.message.text.replace('/broadcast', '').trim();
  if (!message) {
    return ctx.reply('Please provide a message to broadcast. Usage: /broadcast Your message here');
  }

  try {
    if (usersCollection) {
      const users = await usersCollection.find({}).toArray();
      let successCount = 0;
      let failCount = 0;

      ctx.reply(`📢 Starting broadcast to ${users.length} users...`);

      for (const user of users) {
        try {
          await ctx.telegram.sendMessage(user._id, `📢 *BROADCAST FROM ADMIN:*\n\n${message}`, { parse_mode: 'Markdown' });
          successCount++;
          await new Promise((resolve) => setTimeout(resolve, 100));
        } catch (error) {
          console.error(`Failed to send to user ${user._id}:`, error);
          failCount++;
        }
      }

      ctx.reply(`✅ Broadcast completed!\nSuccess: ${successCount}\nFailed: ${failCount}`);
    } else {
      ctx.reply('❌ Database not available for broadcast.');
    }
  } catch (error) {
    console.error('Broadcast error:', error);
    ctx.reply('❌ An error occurred during broadcast.');
  }
});

// /ping command
bot.command('ping', (ctx) => {
  ctx.reply(`🏓 Pong! Bot is alive and responding.\n⏱️ Response time: ${new Date().getTime() - ctx.message.date * 1000}ms`);
});

// /stats command
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

// /session command
bot.command('session', async (ctx) => {
  if (sessionsCollection) {
    const userSessions = await sessionsCollection.countDocuments({ userId: ctx.from.id });
    const maxSessions = 3; // Default max sessions

    ctx.replyWithMarkdown(
      `🔗 *Session Management*\n\n` +
        `Active sessions: ${userSessions}/${maxSessions}\n\n` +
        `*Commands:*\n` +
        `/session list - List your sessions\n` +
        `/session kill [id] - Terminate a session\n` +
        `/session killall - Terminate all sessions`
    );
  } else {
    ctx.reply('❌ Session management not available (database connection issue).');
  }
});

// ==================== START THE BOT ====================

async function startBot() {
  try {
    console.log('🔧 Starting Personal MD Telegram Bot...');
    console.log('🤖 Bot token:', process.env.BOT_TOKEN ? '✅ Provided' : '❌ Missing');

    const mongoUri = process.env.MONGO_URL || process.env.MONGODB_URI;
    console.log('🗄️  MongoDB URI:', mongoUri ? '✅ Provided' : '❌ Missing - using memory storage');

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
