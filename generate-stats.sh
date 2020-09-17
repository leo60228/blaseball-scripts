#! /usr/bin/env bash

set -e

S3_LOGS_ARCHIVE=s3://blaseball-archive-iliana/
S3_BLASEBALL_REF_ARCHIVE=s3://blaseball-reference/public/json-data/

mkdir -p ./blaseball-logs ./tmp

echo "Pulling source data from S3..."
s3 sync --no-sign-request --endpoint=https://nyc3.digitaloceanspaces.com s3://blaseball-reference/public/json-data/ ./data/

echo "Pulling game update logs from S3..."
aws --no-sign-request --quiet s3 sync $S3_LOGS_ARCHIVE ./blaseball-logs/ --exclude "hourly/*" --exclude "compressed-hourly/*" --exclude "idols/*"

echo "Combining logs..."
cat ./blaseball-logs/*.gz > ./tmp/combined-blaseball-log.json.gz
gunzip -c ./tmp/combined-blaseball-log.json.gz > ./tmp/blaseball-log.json

echo "Installing JavaScript dependencies..."
npm install

echo "Compiling TypeScript files..."
npx tsc --project tsconfig.json

echo "Fetching latest team information..."
node dist/fetchTeams.js

echo "Generating standing tables..."
node dist/generateStandings.js

echo "Generating schedule files..."
node dist/generateSchedules.js

echo "Generating player stats..."
node dist/generatePlayerPitchingStats.js
node dist/generatePlayerBattingStats.js
node dist/combinePlayers.js

echo "Generating team player stats..."
node dist/generateTeamPlayerStats.js

echo "Generating stat leaders..."
node dist/generateStatLeaders.js

echo "Cleaning up..."
rm -r ./tmp/

echo "Done!"
