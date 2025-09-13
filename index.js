const { Telegraf, session } = require('telegraf');
const { MongoClient } = require('mongodb');
require('dotenv').config();

if (!process.env.BOT_TOKEN) {
  console.error('❌ BOT_TOKEN env variable is required');
  process.exit(1);
}

const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

let mongoClient;
let db, usersCollection, linksCollection;

async function connectDB() {
  const mongoUri = process.env.MONGO_URL;
  if (!mongoUri) {
    console.warn('⚠️ No MONGO_URL given, running without DB');
    return;
  }
  try {
    console.log('Connecting to MongoDB...');
    mongoClient = new MongoClient(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      tls: true,
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
    });
    await mongoClient.connect();
    const dbName = mongoUri.split('/').pop().split('?')[0] || 'telegram_md_bot';
    db = mongoClient.db(dbName);
    usersCollection = db.collection('users');
    linksCollection = db.collection('device_links');
    await linksCollection.createIndex({ userId: 1 }, { unique: true });
    console.log('MongoDB connected:', db.databaseName);
  } catch (err) {
    console.error('MongoDB connection error:', err.message);
  }
}

bot.on('message', async (ctx, next) => {
  console.log('Received message:', ctx.message.text);
  if (ctx.message.text && ctx.message.text.startsWith('/')) return next();
  return next();
});

bot.start(async (ctx) => {
  console.log('/start invoked by', ctx.from.id);
  if (usersCollection) {
    await usersCollection.updateOne(
      { _id: ctx.from.id },
      {
        $set: {
          username: ctx.from.username,
          first_name: ctx.from.first_name,
          last_name: ctx.from.last_name,
          joined: new Date(),
        },
      },
      { upsert: true }
    );
  }
  ctx.reply(`Hello, ${ctx.from.first_name}! Welcome to the bot. Use /help to get commands.`);
});

bot.help((ctx) => {
  console.log('/help invoked by', ctx.from.id);
  ctx.reply(
    '/start - Start the bot\n' +
      '/help - Show help\n' +
      '/ping - Test bot response\n' +
      '/connect - Generate device linking code\n'
  );
});

bot.command('ping', (ctx) => {
  console.log('/ping invoked by', ctx.from.id);
  ctx.reply('Pong! Bot is alive and responding.');
});

// /connect command
bot.command('connect', async (ctx) => {
  if (!linksCollection) {
    return ctx.reply('❌ Database connection required for linking your device.');
  }

  try {
    const existing = await linksCollection.findOne({ userId: ctx.from.id });
    if (existing) {
      return ctx.reply(`🔗 You are already linked! Your code: *${existing.code}*`, { parse_mode: 'Markdown' });
    }

    const linkingCode = Math.floor(100000 + Math.random() * 900000).toString();

    await linksCollection.updateOne(
      { userId: ctx.from.id },
      { $set: { userId: ctx.from.id, code: linkingCode, linkedAt: new Date() } },
      { upsert: true }
    );

    await ctx.reply(
      `🔗 Your device linking code has been generated:\n\n` +
      `*${linkingCode}*\n\n` +
      `Use this code in your app or website to link your device with this bot.`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error('Error in /connect:', error);
    ctx.reply('❌ Failed to generate linking code.');
  }
});

async function startBot() {
  try {
    await connectDB();
    await bot.launch();
    console.log('Bot started successfully.');
  } catch (err) {
    console.error('Failed to start bot:', err.message);
  }
}

startBot();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));