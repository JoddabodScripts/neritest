/* eslint-disable */
// A completely unmodified Nerimity bot: no NeriTest imports, no overrides.
// `sandbox.loadBot("./vanilla-bot.cjs")` patches the SDK endpoints before this
// file is imported, so `new Client()` connects to the sandbox and `login()`
// authenticates as the sandbox bot via any token.
const { Client, Events } = require("@nerimity/nerimity.js");

const client = new Client();

client.on(Events.Ready, () => {
  console.log(`[vanilla-bot] connected as ${client.user?.username}`);
});

client.on(Events.MessageCreate, async (message) => {
  if (message.user.id === client.user.id) return;
  if (message.content === "!hello") {
    await message.reply("Hi from the vanilla bot!");
  }
});

client.login("paste token here");

module.exports = { client };
