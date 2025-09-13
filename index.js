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

// MongoDB connection - with proper error handling
let mongoClient;
let db, usersCollection, groupsCollection, settingsCollection;

// Connect to MongoDB only if URI is provided
async function connectDB() {
  // Use MONGO_URL (Railway's standard variable name) or MONGODB_URI
  const mongoUri = process.env.MONGO_URL || process.env.MONGODB_URI;
  
  if (!mongoUri) {
    console.warn('⚠️  MONGO_URL not provided. Running without database...');
    return;
  }
  
  try {
    console.log('🔗 Attempting to connect to MongoDB...');
    console.log('📋 Connection string:', mongoUri.replace(/:[^:]*@/, ':********@')); // Hide password in logs
    
    // Add connection options for better stability
    const options = {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    };
    
    mongoClient = new MongoClient(mongoUri, options);
    await mongoClient.connect();
    
    // Use the database name from the connection string or default to 'telegram_md_bot'
    const dbName = mongoUri.split('/').pop().split('?')[0] || 'telegram_md_bot';
    db = mongoClient.db(dbName);
    
    usersCollection = db.collection('users');
    groupsCollection = db.collection('groups');
    settingsCollection = db.collection('settings');
    
    console.log('✅ Connected to MongoDB successfully');
    console.log('💾 Using database:', dbName);
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    console.warn('⚠️  Running without database functionality');
  }
}

// Initialize default settings
async function initSettings() {
  if (!settingsCollection) return;
  
  try {
    const defaultSettings = await settingsCollection.findOne({ _id: 'global' });
    if (!defaultSettings) {
      await settingsCollection.insertOne({
        _id: 'global',
        autoreact: true,
        welcome_message: true,
        antispam: true,
        max_warnings: 3,
        autoreact_emojis: ['👍', '❤️', '🔥']
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

// Update your start command to handle missing DB
bot.start(async (ctx) => {
  // Save user to database if available
  if (usersCollection) {
    try {
      await usersCollection.updateOne(
        { _id: ctx.from.id },
        { 
          $set: { 
            username: ctx.from.username,
            first_name: ctx.from.first_name,
            last_name: ctx.from.last_name,
            joined: new Date()
          } 
        },
        { upsert: true }
      );
    } catch (error) {
      console.error('Database error:', error.message);
    }
  }
  
  ctx.reply(
    `Welcome to MD Bot ${ctx.from.first_name}! 🤖\n\n` +
    `I'm a powerful group management bot with many features.\n` +
    `Use /help to see all available commands.`,
    Markup.keyboard([
      ['📊 Bot Status', '🛠️ Group Tools'],
      ['⚙️ Settings', '❓ Help']
    ]).resize()
  );
});

// Update stats command to handle missing DB
bot.command('stats', async (ctx) => {
  let userCount = 'N/A';
  let groupCount = 'N/A';
  
  if (usersCollection && groupsCollection) {
    try {
      userCount = await usersCollection.countDocuments();
      groupCount = await groupsCollection.countDocuments();
    } catch (error) {
      console.error('Database error in stats:', error.message);
    }
  }
  
  const statsText = `
📊 *BOT STATISTICS*

👥 Users: ${userCount}
👥 Groups: ${groupCount}
⚡ Uptime: ${formatUptime(process.uptime())}
${!process.env.MONGO_URL ? '\n⚠️ *Running in memory mode (no database)*' : ''}
  `;
  
  ctx.replyWithMarkdown(statsText);
});

// Add a simple in-memory storage fallback
const memoryStorage = {
  users: new Map(),
  groups: new Map(),
  settings: {
    autoreact: true,
    welcome_message: true,
    autoreact_emojis: ['👍', '❤️', '🔥']
  }
};

// Format uptime function
function formatUptime(seconds) {
  const days = Math.floor(seconds / (3600 * 24));
  const hours = Math.floor((seconds % (3600 * 24)) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  return `${days}d ${hours}h ${minutes}m`;
}

// Add basic commands to test functionality
bot.command('ping', (ctx) => {
  ctx.reply('🏓 Pong! Bot is alive and responding.');
});

bot.command('testdb', async (ctx) => {
  if (usersCollection) {
    try {
      const userCount = await usersCollection.countDocuments();
      ctx.reply(`✅ Database connection working! Users in DB: ${userCount}`);
    } catch (error) {
      ctx.reply(`❌ Database error: ${error.message}`);
    }
  } else {
    ctx.reply('❌ No database connection available');
  }
});

// Start the bot
async function startBot() {
  try {
    console.log('🔧 Starting MD Telegram Bot...');
    console.log('🤖 Bot token:', process.env.BOT_TOKEN ? '✅ Provided' : '❌ Missing');
    
    const mongoUri = process.env.MONGO_URL || process.env.MONGODB_URI;
    console.log('🗄️  MongoDB URI:', mongoUri ? '✅ Provided' : '❌ Missing - using memory storage');
    
    if (mongoUri) {
      console.log('📋 Connection string:', mongoUri.replace(/:[^:]*@/, ':********@')); // Hide password
    }
    
    await connectDB();
    await initSettings();
    
    bot.launch().then(() => {
      console.log('✅ MD Telegram Bot is running!');
    });
    
    // Enable graceful stop
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
  } catch (error) {
    console.error('❌ Failed to start bot:', error.message);
    process.exit(1);
  }
}

startBot();
