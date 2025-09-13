const { Telegraf, Markup, session } = require('telegraf');
const { MongoClient } = require('mongodb');
require('dotenv').config();

// Initialize bot
const bot = new Telegraf(process.env.BOT_TOKEN);

// Session middleware for user data
bot.use(session());

// MongoDB connection
const mongoClient = new MongoClient(process.env.MONGO_URI);
let db, usersCollection, groupsCollection, settingsCollection;

// Connect to MongoDB
async function connectDB() {
  await mongoClient.connect();
  db = mongoClient.db('telegram_md_bot');
  usersCollection = db.collection('users');
  groupsCollection = db.collection('groups');
  settingsCollection = db.collection('settings');
  console.log('Connected to MongoDB');
}

// Initialize default settings
async function initSettings() {
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
  }
}

// Check if user is admin
function isAdmin(ctx) {
  const admins = process.env.ADMINS.split(',');
  return admins.includes(ctx.from.id.toString());
}

// ==================== COMMANDS ====================

// Start command
bot.start(async (ctx) => {
  // Save user to database
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

// Help command - shows all available commands
bot.help((ctx) => {
  const helpText = `
🤖 *MD BOT COMMANDS* 🤖

*👥 Group Management:*
/mute [reply] [time] - Mute a user
/unmute [reply] - Unmute a user
/ban [reply] - Ban a user
/unban [reply] - Unban a user
/warn [reply] - Warn a user
/clearwarns [reply] - Clear user warnings
/kick [reply] - Kick a user

*⚙️ Settings:*
/settings - Show group settings
/autoreact [on/off] - Toggle auto reaction
/public [on/off] - Toggle public mode
/antispam [on/off] - Toggle anti-spam
/setwelcome [message] - Set welcome message
/setrules [rules] - Set group rules

*🔧 Utilities:*
/stats - Show bot statistics
/broadcast [message] - Broadcast message to all users (Admins only)
/userinfo [reply] - Get user information
/groupinfo - Get group information
/ping - Check bot response time

*🎉 Fun:*
/react [emoji] - React to a message
/gif [query] - Search for GIFs
/sticker [query] - Search for stickers
/quote - Get random quote
/roll [number] - Roll a dice

*👨‍💻 Admin Only:*
/leavegroup - Make bot leave group
/backup - Backup bot data
/restart - Restart bot (Admins only)

Use /command for more info about a specific command.
  `;
  
  ctx.replyWithMarkdown(helpText);
});

// ==================== ADMIN COMMANDS ====================

// Broadcast command (admin only)
bot.command('broadcast', async (ctx) => {
  if (!isAdmin(ctx)) {
    return ctx.reply('❌ This command is only available for admins.');
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
        // Small delay to avoid hitting rate limits
        await new Promise(resolve => setTimeout(resolve, 100));
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

// ==================== GROUP MANAGEMENT COMMANDS ====================

// Mute command
bot.command('mute', async (ctx) => {
  if (!ctx.message.reply_to_message) {
    return ctx.reply('Please reply to a user to mute them.');
  }
  
  const repliedUser = ctx.message.reply_to_message.from;
  const timeMatch = ctx.message.text.match(/(\d+)(m|h|d)/);
  let muteTime = 60; // Default 60 minutes
  
  if (timeMatch) {
    const value = parseInt(timeMatch[1]);
    const unit = timeMatch[2];
    
    if (unit === 'm') muteTime = value;
    else if (unit === 'h') muteTime = value * 60;
    else if (unit === 'd') muteTime = value * 60 * 24;
  }
  
  try {
    // Restrict user in the group
    const untilDate = Math.floor(Date.now() / 1000) + (muteTime * 60);
    await ctx.telegram.restrictChatMember(
      ctx.chat.id, 
      repliedUser.id, 
      { until_date: untilDate, permissions: { can_send_messages: false } }
    );
    
    ctx.replyWithMarkdown(`🔇 User @${repliedUser.username || repliedUser.first_name} has been muted for ${muteTime} minutes.`);
  } catch (error) {
    console.error('Mute error:', error);
    ctx.reply('❌ I need admin permissions to mute users.');
  }
});

// Unmute command
bot.command('unmute', async (ctx) => {
  if (!ctx.message.reply_to_message) {
    return ctx.reply('Please reply to a user to unmute them.');
  }
  
  const repliedUser = ctx.message.reply_to_message.from;
  
  try {
    // Restore user permissions
    await ctx.telegram.restrictChatMember(
      ctx.chat.id, 
      repliedUser.id, 
      { permissions: { can_send_messages: true } }
    );
    
    ctx.replyWithMarkdown(`🔊 User @${repliedUser.username || repliedUser.first_name} has been unmuted.`);
  } catch (error) {
    console.error('Unmute error:', error);
    ctx.reply('❌ I need admin permissions to unmute users.');
  }
});

// ==================== SETTINGS COMMANDS ====================

// Autoreact toggle
bot.command('autoreact', async (ctx) => {
  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    const settings = await settingsCollection.findOne({ _id: 'global' });
    return ctx.reply(`Autoreact is currently ${settings.autoreact ? 'ON' : 'OFF'}. Use /autoreact on or /autoreact off`);
  }
  
  const state = args[1].toLowerCase();
  if (state !== 'on' && state !== 'off') {
    return ctx.reply('Please specify "on" or "off". Usage: /autoreact on');
  }
  
  await settingsCollection.updateOne(
    { _id: 'global' },
    { $set: { autoreact: state === 'on' } }
  );
  
  ctx.reply(`✅ Autoreact has been turned ${state.toUpperCase()}.`);
});

// Public mode toggle
bot.command('public', async (ctx) => {
  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    const groupData = await groupsCollection.findOne({ _id: ctx.chat.id });
    const isPublic = groupData ? groupData.public : false;
    return ctx.reply(`Public mode is currently ${isPublic ? 'ON' : 'OFF'}. Use /public on or /public off`);
  }
  
  const state = args[1].toLowerCase();
  if (state !== 'on' && state !== 'off') {
    return ctx.reply('Please specify "on" or "off". Usage: /public on');
  }
  
  await groupsCollection.updateOne(
    { _id: ctx.chat.id },
    { $set: { public: state === 'on' } },
    { upsert: true }
  );
  
  ctx.reply(`✅ Public mode has been turned ${state.toUpperCase()}.`);
});

// ==================== EVENT HANDLERS ====================

// Auto-react to messages if enabled
bot.on('message', async (ctx) => {
  try {
    const settings = await settingsCollection.findOne({ _id: 'global' });
    if (settings.autoreact && ctx.message.text) {
      // React with random emoji from settings
      const randomEmoji = settings.autoreact_emojis[
        Math.floor(Math.random() * settings.autoreact_emojis.length)
      ];
      
      // Try to react to the message (if supported)
      try {
        await ctx.react(randomEmoji);
      } catch (error) {
        // Reaction might not be supported in this context
      }
    }
  } catch (error) {
    console.error('Error in message handler:', error);
  }
});

// New chat member handler
bot.on('new_chat_members', async (ctx) => {
  const newMembers = ctx.message.new_chat_members;
  const settings = await settingsCollection.findOne({ _id: 'global' });
  
  if (settings.welcome_message) {
    for (const member of newMembers) {
      // Don't welcome yourself
      if (member.id === ctx.botInfo.id) continue;
      
      ctx.replyWithMarkdown(
        `Welcome to the group, [${member.first_name}](tg://user?id=${member.id})! 👋\n` +
        `Please read the rules and enjoy your stay.`
      );
    }
  }
  
  // Save group to database
  await groupsCollection.updateOne(
    { _id: ctx.chat.id },
    { 
      $set: { 
        title: ctx.chat.title,
        type: ctx.chat.type,
        last_activity: new Date()
      } 
    },
    { upsert: true }
  );
});

// ==================== UTILITY COMMANDS ====================

// Stats command
bot.command('stats', async (ctx) => {
  const userCount = await usersCollection.countDocuments();
  const groupCount = await groupsCollection.countDocuments();
  const settings = await settingsCollection.findOne({ _id: 'global' });
  
  const statsText = `
📊 *BOT STATISTICS*

👥 Users: ${userCount}
👥 Groups: ${groupCount}
⚡ Uptime: ${formatUptime(process.uptime())}

🔧 *SETTINGS STATUS*
Autoreact: ${settings.autoreact ? 'ON' : 'OFF'}
Welcome Messages: ${settings.welcome_message ? 'ON' : 'OFF'}
Anti-Spam: ${settings.antispam ? 'ON' : 'OFF'}
  `;
  
  ctx.replyWithMarkdown(statsText);
});

// Ping command
bot.command('ping', (ctx) => {
  ctx.reply(`🏓 Pong! Bot is alive and responding.\n⏱️ Response time: ${new Date().getTime() - ctx.message.date * 1000}ms`);
});

// ==================== HELPER FUNCTIONS ====================

function formatUptime(seconds) {
  const days = Math.floor(seconds / (3600 * 24));
  const hours = Math.floor((seconds % (3600 * 24)) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  return `${days}d ${hours}h ${minutes}m`;
}

// ==================== BOT STARTUP ====================

// Start the bot
async function startBot() {
  try {
    await connectDB();
    await initSettings();
    
    bot.launch().then(() => {
      console.log('🤖 MD Telegram Bot is running!');
    });
    
    // Enable graceful stop
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
  } catch (error) {
    console.error('Failed to start bot:', error);
  }
}

startBot();
