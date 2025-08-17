
echo "Starting the bot..."

cd /home/ec2-user/SheetsBot-master
#!/bin/bash

# Bot-Pfad definieren
BOT_PATH="/home/ec2-user/SheetsBot-master/src/index.js"

# Ignorierte Dateien und Verzeichnisse
IGNORE_FILES=(
    "~/SheetsBot-master/src/SlashCommands/levelsys/members.json"
    "~/SheetsBot-master/src/SlashCommands/levelsys/activeVoiceTimes.json"
    "~/SheetsBot-master/src/gekauftes.json"
    "~/SheetsBot-master/src/SlashCommands/fraktion/fraktionen.json"
    "~/SheetsBot-master/src/besuche.json"
    "~/SheetsBot-master/src/jsons/*"
    "~/SheetsBot-master/src/jsons/"
    "~/SheetsBot-master/src/SlashCommands/waffensystem/waffenscheine.json"
)

# `--ignore`-Parameter erstellen
IGNORE_PARAMS=""
for file in "${IGNORE_FILES[@]}"
do
    IGNORE_PARAMS+=" --ignore $file"
done

# Nodemon ausführen
sudo nodemon "$BOT_PATH" $IGNORE_PARAMS

read -p "Press any key to continue..."
