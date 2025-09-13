const { Telegraf, session } = require('telegraf');
const { MongoClient } = require('mongodb');
require('dotenv').config();

if (!process.env.BOT_TOKEN) {
  console.error('❌ BOT_TOKEN env variable is required');
  process.exit(1);
}

const bot = new Telegraf(process.env.BOT_TOKEN);

// Session middleware
bot.use(session());

// MongoDB client & collections
let mongoClient;
let db, usersCollection;

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
    console.log('MongoDB connected:', db.databaseName);
  } catch (err) {
    console.error('MongoDB connection error:', err.message);
  }
}

// Pass commands on to handlers, react only on non-command messages
bot.on('message', async (ctx, next) => {
  console.log('Received message:', ctx.message.text);
  if (ctx.message.text && ctx.message.text.startsWith('/')) return next();
  // Example auto-reaction disabled here to keep it simple
  return next();
});

// /start command
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

// /help command
bot.help((ctx) => {
  console.log('/help invoked by', ctx.from.id);
  ctx.reply(
    '/start - Start the bot\n' +
      '/help - Show help\n' +
      '/ping - Test bot response\n'
  );
});

// /ping command
bot.command('ping', (ctx) => {
  console.log('/ping invoked by', ctx.from.id);
  ctx.reply('Pong! Bot is alive and responding.');
});

// Start the bot
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

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));