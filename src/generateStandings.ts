import Bottleneck from "bottleneck";
// import chunk from "lodash.chunk";
import fetch from "node-fetch";
import fs from "fs";

const limiter = new Bottleneck({ maxConcurrent: 1, minTime: 250 });

type DivisionRecord = {
  league: string;
  division: string;
  standingsType: "regularSeason" | "postseason";
  lastUpdated: string;
  teamRecords: Array<TeamRecord>;
};

type TeamRecord = {
  teamId: string;
  teamName: string;
  teamSlug: string;
  season: number;
  streak: {
    streakType: "wins" | "losses";
    streakNumber: number;
    streakCode: string;
  };
  divisionRank: number;
  leagueRank: number;
  sportRank: number;
  gamesPlayed: number;
  gamesBack: string;
  leagueGamesBack: string;
  sportGamesBack: string;
  divisionGamesBack: string;
  leagueRecord: {
    wins: number;
    losses: number;
    pct: number;
  };
  divisionRecord: {
    wins: number;
    losses: number;
    pct: number;
  };
  splitRecords: {
    [recordType: string]: {
      wins: number;
      losses: number;
      pct: number;
      type: string;
    };
  };
  weatherRecords: {
    [weatherType: number]: {
      wins: number;
      losses: number;
      pct: number;
      type: string;
    };
  };
  leagueRecords: {
    [leagueId: string]: {
      wins: number;
      losses: number;
      pct: number;
      leagueId: string;
      leagueName: string;
    };
  };
  divisionRecords: {
    [divisionId: string]: {
      wins: number;
      losses: number;
      pct: number;
      divisionId: string;
      divisionName: string;
    };
  };
  runsAllowed: number;
  runsScored: number;
  eliminationNumber: string;
  divisionChamp: boolean;
  divisionLeader: boolean;
  leagueLeader: boolean;
  sportLeader: boolean;
  clinched: boolean;
  magicNumber: string;
  wins: number;
  losses: number;
  runDifferential: number;
  winningPercentage: number;
};

type Subleague = {
  divisions: Array<string>;
  id: string;
  name: string;
  teams: Array<string>;
};

type Division = {
  id: string;
  name: string;
  teams: Array<string>;
  subleague: string;
};

function main() {
  generateStandings();
}

async function fetchGameResults({
  startingDay,
  startingSeason,
}: {
  startingDay: number;
  startingSeason: number;
}): Promise<{ [seasonId: string]: { [day: number]: Array<any> } }> {
  let season = startingSeason;
  let day = startingDay;

  const gameResults: { [seasonId: string]: { [day: number]: Array<any> } } = {};

  const url = new URL("https://www.blaseball.com/database/games");
  url.searchParams.set("season", season.toString());
  url.searchParams.set("day", day.toString());

  await limiter.schedule(async () => {
    let response = await fetch(url);
    let games = await response.json();
    let hasActiveGame = false;

    // Iterate through all days in a season until reaching an empty array response
    while (!hasActiveGame && Array.isArray(games) && games.length !== 0) {
      console.log(`Fetched results for season ${season} day ${day}`);

      for (const game of games) {
        // Stop fetching games when reaching in-progress games
        // - Exclude season 3 due to some games being incorrectly marked as not complete
        if (Number(game.season) !== 3 && game.gameComplete === false) {
          hasActiveGame = true;

          break;
        }
      }

      if (hasActiveGame) {
        break;
      }

      if (!Object.hasOwnProperty.call(gameResults, season)) {
        gameResults[season] = {};
      }
      if (!Object.hasOwnProperty.call(gameResults[season], day)) {
        gameResults[season][day] = games;
      }

      day += 1;
      const url = new URL("https://www.blaseball.com/database/games");
      url.searchParams.set("season", season.toString());
      url.searchParams.set("day", day.toString());

      try {
        response = await fetch(url);
        games = await response.json();
      } catch (err) {
        console.log(err);
        break;
      }

      // When at the end of a season, begin iteration on next season
      if (Array.isArray(games) && games.length === 0) {
        season += 1;
        day = 0;

        const url = new URL("https://www.blaseball.com/database/games");
        url.searchParams.set("season", season.toString());
        url.searchParams.set("day", day.toString());

        try {
          response = await fetch(url);
          games = await response.json();
        } catch (err) {
          console.log(err);
          break;
        }
      }
    }
  });

  return gameResults;
}

async function generateStandings() {
  const { divisions, subleagues } = await fetchSubleaguesAndDivisions();

  let teamRecords: Array<TeamRecord> = [];
  const divisionRecordsBySeason: {
    [seasonId: number]: { [divisonId: string]: Array<TeamRecord> };
  } = {};
  let divisionRecords: { [divisonId: string]: Array<TeamRecord> } = {};
  let leagueRecords: { [leagueId: string]: Array<TeamRecord> } = {};

  const GAMES_IN_SEASON = 99;

  let games;
  let season;
  let day;

  try {
    games = await JSON.parse(
      fs.readFileSync("./data/gameResults.json", "utf8")
    );

    season = Number(Object.keys(games).sort().pop());
    day = Number(Object.keys(games[season]).sort().pop());
  } catch {
    games = {};

    season = 0;
    day = 0;
  }

  const newGames = await fetchGameResults({
    startingDay: day,
    startingSeason: season,
  });

  games = { ...games, ...newGames };

  for (const season in games) {
    for (const day in games[season]) {
      for (const game of games[season][day]) {
        // Fitler out games in progress
        if (game.gameComplete === false) break;

        // Filter out postseason games
        if (game.isPostseason === true) break;

        const winner: "away" | "home" =
          game.homeScore > game.awayScore ? "home" : "away";
        const loser: "away" | "home" =
          game.homeScore > game.awayScore ? "away" : "home";

        const winnerSubleague: Subleague | undefined = subleagues.find(
          (subleague) => {
            return subleague.teams.find(
              (team) => team === game[`${winner}Team`]
            );
          }
        );
        const loserSubleague: Subleague | undefined = subleagues.find(
          (subleague) => {
            return subleague.teams.find(
              (team) => team === game[`${loser}Team`]
            );
          }
        );

        const winnerDivision: Division | undefined = divisions.find(
          (division) => {
            return division.teams.find(
              (team) => team === game[`${winner}Team`]
            );
          }
        );

        const loserDivision: Division | undefined = divisions.find(
          (division) => {
            return division.teams.find((team) => team === game[`${loser}Team`]);
          }
        );

        // Attempt to locate existing team records
        let winningTeamRecords = teamRecords.find(
          (team) => team.teamId === game[`${winner}Team`]
        );

        let losingTeamRecords = teamRecords.find(
          (team) => team.teamId === game[`${loser}Team`]
        );

        // Create initial team records object if missing
        if (!winningTeamRecords) {
          winningTeamRecords = createTeamRecord({
            teamId: game[`${winner}Team`],
            teamName: game[`${winner}TeamName`],
          });
        }

        if (!losingTeamRecords) {
          losingTeamRecords = createTeamRecord({
            teamId: game[`${loser}Team`],
            teamName: game[`${loser}TeamName`],
          });
        }

        // Update streak
        if (winningTeamRecords.streak.streakType === "wins") {
          winningTeamRecords.streak.streakNumber += 1;
          winningTeamRecords.streak.streakCode = `W${winningTeamRecords.streak.streakNumber}`;
        } else {
          winningTeamRecords.streak.streakType = "wins";
          winningTeamRecords.streak.streakNumber = 1;
          winningTeamRecords.streak.streakCode = "W1";
        }

        if (losingTeamRecords.streak.streakType === "losses") {
          losingTeamRecords.streak.streakNumber += 1;
          losingTeamRecords.streak.streakCode = `L${winningTeamRecords.streak.streakNumber}`;
        } else {
          losingTeamRecords.streak.streakType = "losses";
          losingTeamRecords.streak.streakNumber = 1;
          losingTeamRecords.streak.streakCode = "L1";
        }

        // Set season
        if (!winningTeamRecords.season) {
          winningTeamRecords.season = game.season;
        }
        if (!losingTeamRecords.season) {
          losingTeamRecords.season = game.season;
        }

        winningTeamRecords.gamesPlayed += 1;
        losingTeamRecords.gamesPlayed += 1;

        winningTeamRecords.wins += 1;
        losingTeamRecords.losses += 1;

        winningTeamRecords.winningPercentage =
          winningTeamRecords.wins /
          (winningTeamRecords.wins + winningTeamRecords.losses);
        losingTeamRecords.winningPercentage =
          losingTeamRecords.wins /
          (losingTeamRecords.wins + losingTeamRecords.losses);

        winningTeamRecords.runsAllowed += game[`${loser}Score`];
        losingTeamRecords.runsAllowed += game[`${winner}Score`];

        winningTeamRecords.runsScored += game[`${winner}Score`];
        losingTeamRecords.runsScored += game[`${loser}Score`];

        winningTeamRecords.runDifferential +=
          game[`${winner}Score`] - game[`${loser}Score`];
        losingTeamRecords.runDifferential -=
          game[`${winner}Score`] - game[`${loser}Score`];

        // For intra-league games, increment/decrement league record
        if (winnerSubleague === loserSubleague) {
          winningTeamRecords.leagueRecord.wins += 1;
          losingTeamRecords.leagueRecord.losses += 1;
        }

        // Increment home and away split records
        winningTeamRecords.splitRecords[winner].wins += 1;
        winningTeamRecords.splitRecords[winner].pct = calculateSplitWinningPct(
          winningTeamRecords.splitRecords[winner]
        );

        losingTeamRecords.splitRecords[loser].losses += 1;
        losingTeamRecords.splitRecords[loser].pct = calculateSplitWinningPct(
          losingTeamRecords.splitRecords[loser]
        );

        // Increment extra innings split records
        if (game.inning > 8) {
          winningTeamRecords.splitRecords.extraInnings.wins += 1;
          losingTeamRecords.splitRecords.extraInnings.losses += 1;

          winningTeamRecords.splitRecords.extraInnings.pct = calculateSplitWinningPct(
            winningTeamRecords.splitRecords.extraInnings
          );
          losingTeamRecords.splitRecords.extraInnings.pct = calculateSplitWinningPct(
            losingTeamRecords.splitRecords.extraInnings
          );
        }

        // Increment record against winning team split record
        if (losingTeamRecords.winningPercentage > 0.5) {
          winningTeamRecords.splitRecords.winners.wins += 1;
          winningTeamRecords.splitRecords.winners.pct = calculateSplitWinningPct(
            winningTeamRecords.splitRecords.winners
          );
        }

        if (winningTeamRecords.winningPercentage > 0.5) {
          losingTeamRecords.splitRecords.winners.losses += 1;
          losingTeamRecords.splitRecords.winners.pct = calculateSplitWinningPct(
            losingTeamRecords.splitRecords.winners
          );
        }

        // Increment split record in one-run games
        if (Math.abs(game.homeScore - game.awayScore) === 1) {
          winningTeamRecords.splitRecords.oneRun.wins += 1;
          winningTeamRecords.splitRecords.oneRun.pct = calculateSplitWinningPct(
            winningTeamRecords.splitRecords.oneRun
          );

          losingTeamRecords.splitRecords.oneRun.losses += 1;
          losingTeamRecords.splitRecords.oneRun.pct = calculateSplitWinningPct(
            losingTeamRecords.splitRecords.oneRun
          );
        }

        // Increment split record in shame games
        if (game.shame === true) {
          winningTeamRecords.splitRecords.shame.wins += 1;
          winningTeamRecords.splitRecords.shame.pct = calculateSplitWinningPct(
            winningTeamRecords.splitRecords.shame
          );

          losingTeamRecords.splitRecords.shame.losses += 1;
          losingTeamRecords.splitRecords.shame.pct = calculateSplitWinningPct(
            losingTeamRecords.splitRecords.shame
          );
        }

        // Increment division records
        if (winnerDivision?.id && loserDivision?.id) {
          if (
            !Object.hasOwnProperty.call(
              winningTeamRecords.divisionRecords,
              loserDivision.id
            )
          ) {
            winningTeamRecords.divisionRecords[
              loserDivision.id
            ] = createSplitRecordObject({
              divisionId: loserDivision?.id,
              divisionName: loserDivision?.name,
            });
          }

          if (
            !Object.hasOwnProperty.call(
              losingTeamRecords.divisionRecords,
              winnerDivision.id
            )
          ) {
            losingTeamRecords.divisionRecords[
              winnerDivision.id
            ] = createSplitRecordObject({
              divisionId: winnerDivision?.id,
              divisionName: winnerDivision?.name,
            });
          }

          winningTeamRecords.divisionRecords[loserDivision.id].wins += 1;
          winningTeamRecords.divisionRecords[
            loserDivision.id
          ].pct = calculateSplitWinningPct(
            winningTeamRecords.divisionRecords[loserDivision.id]
          );
          losingTeamRecords.divisionRecords[winnerDivision.id].losses += 1;
          losingTeamRecords.divisionRecords[
            winnerDivision.id
          ].pct = calculateSplitWinningPct(
            losingTeamRecords.divisionRecords[winnerDivision.id]
          );
        }

        // Increment subleague records
        if (winnerSubleague && loserSubleague) {
          if (
            !Object.hasOwnProperty.call(
              winningTeamRecords.leagueRecords,
              loserSubleague.id
            )
          ) {
            winningTeamRecords.leagueRecords[
              loserSubleague.id
            ] = createSplitRecordObject({
              leagueId: loserSubleague?.id,
              leagueName: loserSubleague?.name,
            });
          }

          if (
            !Object.hasOwnProperty.call(
              losingTeamRecords.leagueRecords,
              winnerSubleague.id
            )
          ) {
            losingTeamRecords.leagueRecords[
              winnerSubleague.id
            ] = createSplitRecordObject({
              divisionId: winnerSubleague?.id,
              divisionName: winnerSubleague?.name,
            });
          }

          winningTeamRecords.leagueRecords[loserSubleague.id].wins += 1;
          winningTeamRecords.leagueRecords[
            loserSubleague.id
          ].pct = calculateSplitWinningPct(
            winningTeamRecords.leagueRecords[loserSubleague.id]
          );
          losingTeamRecords.leagueRecords[winnerSubleague.id].losses += 1;
          losingTeamRecords.leagueRecords[
            winnerSubleague.id
          ].pct = calculateSplitWinningPct(
            losingTeamRecords.leagueRecords[winnerSubleague.id]
          );
        }

        // Increment weather split records
        if (game.weather !== null) {
          if (
            !Object.hasOwnProperty.call(
              winningTeamRecords.weatherRecords,
              game.weather
            )
          ) {
            winningTeamRecords.weatherRecords[
              game.weather
            ] = createSplitRecordObject({
              type: getWeather()[game.weather].name || "",
            });
          }

          if (
            !Object.hasOwnProperty.call(
              losingTeamRecords.weatherRecords,
              game.weather
            )
          ) {
            losingTeamRecords.weatherRecords[
              game.weather
            ] = createSplitRecordObject({
              type: getWeather()[game.weather].name || "",
            });
          }

          winningTeamRecords.weatherRecords[game.weather].wins += 1;
          winningTeamRecords.weatherRecords[
            game.weather
          ].pct = calculateSplitWinningPct(
            winningTeamRecords.weatherRecords[game.weather]
          );

          losingTeamRecords.weatherRecords[game.weather].losses += 1;
          losingTeamRecords.weatherRecords[
            game.weather
          ].pct = calculateSplitWinningPct(
            losingTeamRecords.weatherRecords[game.weather]
          );
        }

        // Add teams to team records set
        if (
          !teamRecords.find(
            (record) => record.teamId === winningTeamRecords?.teamId
          )
        ) {
          teamRecords.push(winningTeamRecords);
        }

        if (
          !teamRecords.find(
            (record) => record.teamId === losingTeamRecords?.teamId
          )
        ) {
          teamRecords.push(losingTeamRecords);
        }

        // Add teams to division records set
        if (winnerDivision) {
          if (!Object.hasOwnProperty.call(divisionRecords, winnerDivision.id)) {
            divisionRecords[winnerDivision.id] = [winningTeamRecords];
          } else {
            if (
              !divisionRecords[winnerDivision.id].find(
                (team) => team.teamId === winningTeamRecords?.teamId
              )
            ) {
              divisionRecords[winnerDivision.id].push(winningTeamRecords);
            }
          }
        }

        if (loserDivision) {
          if (!Object.hasOwnProperty.call(divisionRecords, loserDivision.id)) {
            divisionRecords[loserDivision.id] = [losingTeamRecords];
          } else {
            if (
              !divisionRecords[loserDivision.id].find(
                (team) => team.teamId === losingTeamRecords?.teamId
              )
            ) {
              divisionRecords[loserDivision.id].push(losingTeamRecords);
            }
          }
        }

        // Add teams to subleague set
        if (winnerSubleague) {
          if (!Object.hasOwnProperty.call(leagueRecords, winnerSubleague.id)) {
            leagueRecords[winnerSubleague.id] = [winningTeamRecords];
          } else {
            if (
              !leagueRecords[winnerSubleague.id].find(
                (team) => team.teamId === winningTeamRecords?.teamId
              )
            ) {
              leagueRecords[winnerSubleague.id].push(winningTeamRecords);
            }
          }
        }

        if (loserSubleague) {
          if (!Object.hasOwnProperty.call(leagueRecords, loserSubleague.id)) {
            leagueRecords[loserSubleague.id] = [losingTeamRecords];
          } else {
            if (
              !leagueRecords[loserSubleague.id].find(
                (team) => team.teamId === losingTeamRecords?.teamId
              )
            ) {
              leagueRecords[loserSubleague.id].push(losingTeamRecords);
            }
          }
        }
      }
    }

    if (teamRecords) {
      const sortedSport = teamRecords.sort((a, b) =>
        a.wins < b.wins ? 1 : b.wins < a.wins ? -1 : 0
      );

      sortedSport[0].sportLeader = true;

      const leadingTeamWinDifferential =
        sortedSport[0].wins - sortedSport[0].losses;

      sortedSport.forEach((teamRecord, index) => {
        teamRecord.sportRank = index + 1;
        teamRecord.sportGamesBack =
          index === 0
            ? "-"
            : String(
                (leadingTeamWinDifferential -
                  (teamRecord.wins - teamRecord.losses)) /
                  2
              );
      });
    }

    for (const division in divisionRecords) {
      const sortedDivision = divisionRecords[division].sort((a, b) =>
        a.wins < b.wins ? 1 : b.wins < a.wins ? -1 : 0
      );

      sortedDivision[0].divisionLeader = true;

      const leadingTeamWinDifferential =
        sortedDivision[0].wins - sortedDivision[0].losses;

      sortedDivision.forEach((teamRecord, index) => {
        teamRecord.divisionRank = index + 1;
        teamRecord.divisionGamesBack =
          index === 0
            ? "-"
            : String(
                (leadingTeamWinDifferential -
                  (teamRecord.wins - teamRecord.losses)) /
                  2
              );
      });
    }

    for (const league in leagueRecords) {
      const sortedLeague = leagueRecords[league].sort((a, b) =>
        a.wins < b.wins ? 1 : b.wins < a.wins ? -1 : 0
      );

      sortedLeague[0].leagueLeader = true;

      for (let i = 0; i < 4; i++) {
        const magicNumber =
          GAMES_IN_SEASON + 1 - sortedLeague[i].wins - sortedLeague[4].losses;

        sortedLeague[i].magicNumber =
          magicNumber <= 0 ? "-" : String(magicNumber);
        sortedLeague[i].clinched = magicNumber <= 0 ? true : false;
      }

      for (let i = 4; i < sortedLeague.length; i++) {
        const tragicNumber =
          GAMES_IN_SEASON + 1 - sortedLeague[3].wins - sortedLeague[i].losses;

        sortedLeague[i].eliminationNumber = String(tragicNumber);
      }

      const leadingTeamWinDifferential =
        sortedLeague[0].wins - sortedLeague[0].losses;

      sortedLeague.forEach((teamRecord, index) => {
        teamRecord.leagueRank = index + 1;
        teamRecord.leagueGamesBack =
          index === 0
            ? "-"
            : String(
                (leadingTeamWinDifferential -
                  (teamRecord.wins - teamRecord.losses)) /
                  2
              );
        teamRecord.gamesBack = teamRecord.leagueGamesBack;
      });
    }

    divisionRecordsBySeason[season] = divisionRecords;

    teamRecords = [];
    divisionRecords = {};
    leagueRecords = {};
  }

  await fs.promises.mkdir(`./data/standings`, { recursive: true });

  fs.writeFile(
    `./data/standings/standings.json`,
    `${JSON.stringify(divisionRecordsBySeason, null, "\t")}\n`,
    function (err) {
      if (err) {
        console.log(err);
      }
    }
  );

  fs.writeFile(
    "./data/gameResults.json",
    `${JSON.stringify(games, null, "\t")}\n`,
    function (err) {
      if (err) {
        console.log(err);
      }
    }
  );
}
function calculateSplitWinningPct(record: {
  wins: number;
  losses: number;
}): number {
  return record.wins / (record.wins + record.losses);
}

function createSplitRecordObject(initialValues: any) {
  const defaults = {
    wins: 0,
    losses: 0,
    pct: 0,
    type: "",
  };

  // Perform a shallow copy of initialValues over defaults
  return Object.assign({}, defaults, initialValues);
}

function createTeamRecord(initialValues: any): TeamRecord {
  const defaults = {
    teamId: "",
    teamName: "",
    teamSlug: "",
    season: null,
    streak: {
      streakType: "",
      streakNumber: 0,
      streakCode: "",
    },
    divisionRank: 0,
    leagueRank: 0,
    sportRank: 0,
    gamesPlayed: 0,
    gamesBack: "",
    leagueGamesBack: "",
    sportGamesBack: "",
    divisionGamesBack: "",
    leagueRecord: {
      wins: 0,
      losses: 0,
      pct: 0,
    },
    splitRecords: {
      home: {
        wins: 0,
        losses: 0,
        pct: 0,
        type: "home",
      },
      away: {
        wins: 0,
        losses: 0,
        pct: 0,
        type: "away",
      },
      extraInnings: {
        wins: 0,
        losses: 0,
        pct: 0,
        type: "extraInnings",
      },
      winners: {
        wins: 0,
        losses: 0,
        pct: 0,
        type: "winners",
      },
      oneRun: {
        wins: 0,
        losses: 0,
        pct: 0,
        type: "oneRun",
      },
      shame: {
        wins: 0,
        losses: 0,
        pct: 0,
        type: "shame",
      },
    },
    weatherRecords: {},
    leagueRecords: {},
    divisionRecords: {},
    runsAllowed: 0,
    runsScored: 0,
    divisionChamp: false,
    divisionLeader: false,
    leagueLeader: false,
    sportLeader: false,
    clinched: false,
    eliminationNumber: "",
    magicNumber: "",
    wins: 0,
    losses: 0,
    runDifferential: 0,
    winningPercentage: 0,
  };

  // Perform a shallow copy of initialValues over defaults
  return Object.assign({}, defaults, initialValues);
}

async function fetchSubleaguesAndDivisions(): Promise<{
  subleagues: Array<Subleague>;
  divisions: Array<Division>;
}> {
  const subleagues: { [subleagueId: string]: Subleague } = {};
  const divisions: { [divisionId: string]: Division } = {};
  let hasCachedResponse;
  let response;

  try {
    const cachedResponse = JSON.parse(
      fs.readFileSync("./data/leaguesAndDivisions.json", "utf8")
    );

    const dataJson: {
      subleagues: Array<Subleague>;
      divisions: Array<Division>;
      lastUpdatedAt: number;
    } = cachedResponse;

    const ONE_DAY = 24 * 60 * 60 * 1000;
    if (Date.now() - dataJson.lastUpdatedAt > ONE_DAY) {
      console.log("Old cache object... refetching.");
      hasCachedResponse = false;
    }

    hasCachedResponse = true;
    response = {
      divisions: dataJson.divisions,
      subleagues: dataJson.subleagues,
    };
  } catch {
    hasCachedResponse = false;
  }

  if (hasCachedResponse && response) {
    return response;
  }

  const ILB_ID = "d8545021-e9fc-48a3-af74-48685950a183";
  const resp = await fetch(
    `https://blaseball.com/database/league?id=${ILB_ID}`
  );
  const league = await resp.json();

  for (const subleagueId of league.subleagues) {
    const resp = await fetch(
      `https://blaseball.com/database/subleague?id=${subleagueId}`
    );
    const subleague = await resp.json();

    subleagues[subleague.id] = {
      divisions: subleague.divisions,
      id: subleague.id,
      name: subleague.name,
      teams: [],
    };

    for (const divisionId of subleague.divisions) {
      const resp = await fetch(
        `https://blaseball.com/database/division?id=${divisionId}`
      );
      const division = await resp.json();

      subleagues[subleague.id].teams = [
        ...subleagues[subleague.id].teams,
        ...division.teams,
      ];

      divisions[divisionId] = {
        id: division.id,
        name: division.name,
        subleague: subleague.id,
        teams: division.teams,
      };
    }
  }

  response = {
    divisions: Object.values(divisions),
    subleagues: Object.values(subleagues),
  };

  fs.writeFile(
    "./data/leaguesAndDivisions.json",
    `${JSON.stringify(
      { ...response, lastUpdatedAt: Date.now() },
      null,
      "\t"
    )}\n`,
    function (err) {
      if (err) {
        console.log(err);
      }
    }
  );

  return response;
}

function getWeather() {
  return [
    {
      name: "Void",
    },
    {
      name: "Sunny",
    },
    {
      name: "Overcast",
    },
    {
      name: "Rainy",
    },
    {
      name: "Sandstorm",
    },
    {
      name: "Snowy",
    },
    {
      name: "Acidic",
    },
    {
      name: "Solar Eclipse",
    },
    {
      name: "Glitter",
    },
    {
      name: "Bloodwind",
    },
    {
      name: "Peanuts",
    },
    {
      name: "Birds",
    },
    {
      name: "Feedback",
    },
    {
      name: "Reverb",
    },
  ];
}

main();