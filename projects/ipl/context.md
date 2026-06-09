## GLOSSARY
NRR: Net Run Rate — (total runs scored / total overs faced) minus (total runs conceded / total overs bowled). Used to break ties on the points table when teams are level on points.
Powerplay: The mandatory first 6 overs of each innings (over_number 0–5). Only 2 fielders allowed outside the 30-yard circle. Batters typically score at high rates.
Middle overs: Overs 7–15 (over_number 6–14). Standard fielding restrictions. Consolidation phase where teams balance scoring and wicket preservation.
Death overs: Overs 16–20 (over_number 15–19). Batters maximise aggression; bowlers face their toughest challenge.
Dot ball: A delivery from which the batting side scores 0 runs total (runs_total = 0). Captured by the is_dot_ball computed column.
Boundary: A hit worth 4 runs (ball reaches the rope along the ground) or 6 runs (ball clears the rope in the air). Captured by is_boundary.
Six: A boundary worth 6 runs; the ball clears the rope without bouncing. Captured by is_six.
Four: A boundary worth 4 runs; the ball reaches the rope along the ground. Captured by is_four.
Strike rate: Runs scored by a batter per 100 legal balls faced. Formula: SUM(runs_batter) * 100.0 / NULLIF(COUNT(*) FILTER (WHERE extra_type IS NULL), 0).
Economy rate: Runs conceded by a bowler per 6 legal balls (per over). Formula: SUM(runs_batter      + CASE WHEN extra_type IN ('wide','noball') THEN runs_extras ELSE 0 END) * 6.0 / NULLIF(SUM(CASE WHEN extra_type IS NULL THEN 1 END), 0).
Duck: A batter dismissed without scoring any runs. A golden duck means dismissed on the very first legal ball faced.
Maiden over: An over where the bowler concedes 0 runs off the bat and gives away no extras. Rare in T20 cricket.
Wicket: A batter dismissal. Types: caught, bowled, run out, lbw, stumped, hit wicket, obstructing the field, retired hurt. Stored in the wickets table.
LBW: Leg Before Wicket — the ball would have hit the stumps but struck the batter's body first. Credited to the bowler.
Stumped: Wicket-keeper removes the bails while the batter is outside the crease and not playing a shot. Credited to the bowler.
Run out: Batter dismissed when the fielding side breaks the stumps during a run. NOT credited to the bowler; bowler_key/bowler_name still records who bowled the delivery.
Bowler wicket: A dismissal credited to the bowler — caught, bowled, lbw, stumped, hit wicket. Excludes run out and obstructing the field.
Extras: Runs not off the bat. Types: wide, noball, bye, legbye, penalty. Stored in extra_type; extras_* columns aggregate them per innings.
Wide: Delivery too far from the batter to hit; 1 extra run, must be re-bowled, does not count as a legal ball.
No-ball: Illegal delivery (e.g. overstepping); 1 extra run, must be re-bowled, batter cannot be dismissed except run out.
Bye: Extras scored when the ball beats both bat and keeper; the batter runs but no bat contact. extra_type = 'bye'.
Leg-bye: Extras when the ball hits the batter's body (not bat) and they run. extra_type = 'legbye'.
Legal ball: A delivery that is not a wide or no-ball. Filter with extra_type IS NULL to count only legal balls.
Phase: Innings phase derived from over_number — 'powerplay' (0–5), 'middle' (6–14), 'death' (15–19). Available as the computed phase column on deliveries.
Super over: A one-over eliminator played when scores are tied after 20 overs. Stored as innings rows with super_over = true.
DLS: Duckworth-Lewis-Stern method. Applied in rain-affected matches. win_method = 'D/L' flags these matches.
Player of the Match: Award for the single most impactful player. Stored as player_of_match TEXT[] in matches (array because a few matches record multiple winners).
Toss: The coin flip before a match. toss_decision is 'bat' (elected to bat first) or 'field' (elected to field first).
Franchise: An IPL team. Some franchises changed names across seasons (e.g. Delhi Daredevils → Delhi Capitals, Kings XI Punjab → Punjab Kings). Each distinct name is a separate row in teams.
Season: One edition of the IPL. Stored as a text string in the season column (e.g. '2007/08', '2024'). Seasons span a calendar year or cross two years.

## TABLE NOTES
seasons: Primary key is the season text label (e.g. '2007/08', '2024'). Use this to group matches by edition. JOIN matches ON matches.season = seasons.season.
teams: Each distinct franchise name is a separate row. Renamed teams (e.g. 'Delhi Daredevils' and 'Delhi Capitals') are different rows with different team_ids. To combine a franchise across renames, use LIKE or IN with all known names.
venues: name is the full stadium name; city is the host city. A venue can host matches for multiple franchises and neutral-venue playoff fixtures.
players: Registry of players with a stable cricsheet player_key. Not all deliveries have a matching player_key; player_name is always populated in deliveries and is the reliable join key for aggregations.
matches: match_id is the numeric cricsheet file ID. match_date is the actual match day. team1_id and team2_id reflect scheduling order, not home/away — IPL uses many neutral venues.
matches: outcome_type is 'winner' (normal result), 'tie' (scores level after 20 overs, broken by super over), or 'no result' (abandoned/washed out). Only exclude 'no result' matches for win-rate calculations.
matches: win_by_runs is set when batting-first team won; win_by_wickets is set when the chasing team won. win_method = 'D/L' for Duckworth-Lewis-Stern revised targets. eliminator_id is the team that won the super-over tiebreaker.
matches: player_of_match is a TEXT[] (PostgreSQL array). To unnest it: unnest(player_of_match) or use player_of_match @> ARRAY['Player Name'] to check membership.
match_officials: One row per (match, role, name). role values: 'umpire', 'tv umpire', 'reserve umpire', 'match referee'. Filter by role to get umpires only.
match_players: The declared 11 (or squad) per team per match — not necessarily every player who batted or bowled. player_key may be NULL for pre-2008 or data gaps. player_name is always present.
innings: innings_number=1 is the team that batted first; innings_number=2 is the chasing side. Super over innings have super_over=TRUE and innings_number >= 3.
innings: legal_balls counts only deliveries where extra_type IS NULL. A completed innings has 120 legal balls (20 overs) or ended at 10 wickets. Reduced-overs matches may have fewer.
innings: target_runs and target_overs are set only for the chasing innings (innings_number=2 and some DLS games). NULL for the first innings.
innings: extras breakdown — extras_wide, extras_no_ball, extras_bye, extras_leg_bye, extras_penalty. extras is their sum. Use these for quick totals without touching deliveries.
deliveries: over_number is 0-indexed. over_number=0 is the 1st over; over_number=19 is the 20th (final) over. Add 1 to display to users.
deliveries: ball_number is 1-indexed within an over and includes extras (wides, no-balls). An over with one wide has ball_numbers 1–7. Use extra_type IS NULL to count only legal balls.
deliveries: phase is a STORED computed column — 'powerplay' (over_number 0–5), 'middle' (6–14), 'death' (15–19). Never compute it manually; use it directly in WHERE and GROUP BY.
deliveries: is_dot_ball, is_boundary, is_four, is_six are STORED computed booleans. Always use them instead of writing CASE expressions or comparing runs values.
deliveries: runs_batter is runs credited to the batter. runs_extras is all extra runs on that delivery. runs_total = runs_batter + runs_extras.
deliveries: extra_type is NULL for a legal delivery, 'wide' for a wide, 'noball' for a no-ball, 'bye' for a bye, 'legbye' for a leg-bye, 'penalty' for a penalty. Only wides and no-balls make a delivery illegal (not re-countable as a ball faced).
deliveries: is_wicket = TRUE means at least one dismissal occurred on this delivery. Join to the wickets table via delivery_id to get dismissal details. A single delivery can have more than one wicket row (very rare).
deliveries: To compute a bowler's economy include only runs the bowler is charged for: runs_batter + (CASE WHEN extra_type IN ('wide','noball') THEN runs_extras ELSE 0 END). Byes and leg-byes are not charged to the bowler.
wickets: One row per dismissal. A delivery can have 0 or more rows (most have 0; wicket deliveries have 1; very rare deliveries may have 2).
wickets: kind values include: 'caught', 'bowled', 'run out', 'lbw', 'stumped', 'hit wicket', 'obstructing the field', 'retired hurt', 'retired out'. For bowler wickets, filter kind IN ('caught','bowled','lbw','stumped','hit wicket').
wickets: fielders is a TEXT[] of fielder names involved in the dismissal (e.g. the catcher's name for 'caught', the thrower/receiver for 'run out'). May be empty.

## EXAMPLES
Q: Who are the top 10 run-scorers in IPL history?
SQL: SELECT d.batter_name, SUM(d.runs_batter) AS total_runs, COUNT(*) FILTER (WHERE d.extra_type IS NULL) AS balls_faced, ROUND(SUM(d.runs_batter) * 100.0 / NULLIF(COUNT(*) FILTER (WHERE d.extra_type IS NULL), 0), 2) AS strike_rate, SUM(d.is_four::int) AS fours, SUM(d.is_six::int) AS sixes FROM deliveries d GROUP BY d.batter_name ORDER BY total_runs DESC LIMIT 10

Q: Who has taken the most wickets in IPL history (bowler wickets only)?
SQL: SELECT d.bowler_name, COUNT(*) AS wickets FROM deliveries d JOIN wickets w ON w.delivery_id = d.delivery_id WHERE w.kind IN ('caught','bowled','lbw','stumped','hit wicket') GROUP BY d.bowler_name ORDER BY wickets DESC LIMIT 10

Q: Which bowler has the best economy rate in death overs (minimum 300 legal balls bowled)?
SQL: SELECT d.bowler_name, ROUND(SUM(d.runs_batter + CASE WHEN d.extra_type IN ('wide','noball') THEN d.runs_extras ELSE 0 END) * 6.0 / NULLIF(SUM(CASE WHEN d.extra_type IS NULL THEN 1 END), 0), 2) AS economy, SUM(CASE WHEN d.extra_type IS NULL THEN 1 END) AS legal_balls FROM deliveries d WHERE d.phase = 'death' GROUP BY d.bowler_name HAVING SUM(CASE WHEN d.extra_type IS NULL THEN 1 END) >= 300 ORDER BY economy ASC LIMIT 10

Q: What is the highest individual score in a single IPL innings?
SQL: SELECT d.batter_name, i.innings_number, m.match_id, m.match_date, t_bat.name AS batting_team, t_bowl.name AS bowling_team, SUM(d.runs_batter) AS runs, COUNT(*) FILTER (WHERE d.extra_type IS NULL) AS balls, SUM(d.is_four::int) AS fours, SUM(d.is_six::int) AS sixes FROM deliveries d JOIN innings i ON d.innings_id = i.innings_id JOIN matches m ON i.match_id = m.match_id JOIN teams t_bat ON i.team_id = t_bat.team_id JOIN teams t_bowl ON (CASE WHEN i.team_id = m.team1_id THEN m.team2_id ELSE m.team1_id END) = t_bowl.team_id GROUP BY d.batter_name, i.innings_id, i.innings_number, m.match_id, m.match_date, t_bat.name, t_bowl.name ORDER BY runs DESC LIMIT 10

Q: Which batter has scored the most runs in a single IPL season?
SQL: SELECT d.batter_name, m.season, SUM(d.runs_batter) AS season_runs, COUNT(*) FILTER (WHERE d.extra_type IS NULL) AS balls_faced FROM deliveries d JOIN innings i ON d.innings_id = i.innings_id JOIN matches m ON i.match_id = m.match_id GROUP BY d.batter_name, m.season ORDER BY season_runs DESC LIMIT 10

Q: Who has hit the most sixes in IPL history?
SQL: SELECT d.batter_name, SUM(d.is_six::int) AS total_sixes FROM deliveries d GROUP BY d.batter_name ORDER BY total_sixes DESC LIMIT 10

Q: Which team has won the most matches in IPL history?
SQL: SELECT t.name AS team, COUNT(*) AS wins FROM matches m JOIN teams t ON m.winner_id = t.team_id WHERE m.outcome_type = 'winner' GROUP BY t.team_id, t.name ORDER BY wins DESC

Q: What is each team's win rate when batting first vs chasing?
SQL: SELECT t.name AS team, COUNT(*) FILTER (WHERE i.innings_number = 1 AND m.winner_id = i.team_id) AS wins_batting_first, COUNT(*) FILTER (WHERE i.innings_number = 1) AS total_batting_first, ROUND(100.0 * COUNT(*) FILTER (WHERE i.innings_number = 1 AND m.winner_id = i.team_id) / NULLIF(COUNT(*) FILTER (WHERE i.innings_number = 1), 0), 1) AS win_pct_batting_first, COUNT(*) FILTER (WHERE i.innings_number = 2 AND m.winner_id = i.team_id) AS wins_chasing, COUNT(*) FILTER (WHERE i.innings_number = 2) AS total_chasing, ROUND(100.0 * COUNT(*) FILTER (WHERE i.innings_number = 2 AND m.winner_id = i.team_id) / NULLIF(COUNT(*) FILTER (WHERE i.innings_number = 2), 0), 1) AS win_pct_chasing FROM innings i JOIN matches m ON i.match_id = m.match_id JOIN teams t ON i.team_id = t.team_id WHERE m.outcome_type = 'winner' AND i.super_over = FALSE GROUP BY t.team_id, t.name ORDER BY t.name

Q: Which venue has the highest average first innings total?
SQL: SELECT v.name AS venue, v.city, ROUND(AVG(i.total_runs), 1) AS avg_first_innings_score, COUNT(*) AS matches FROM innings i JOIN matches m ON i.match_id = m.match_id JOIN venues v ON m.venue_id = v.venue_id WHERE i.innings_number = 1 AND i.super_over = FALSE GROUP BY v.venue_id, v.name, v.city HAVING COUNT(*) >= 5 ORDER BY avg_first_innings_score DESC LIMIT 15

Q: Who has won the most Player of the Match awards?
SQL: SELECT player_name, COUNT(*) AS awards FROM (SELECT unnest(player_of_match) AS player_name FROM matches WHERE outcome_type != 'no result') t GROUP BY player_name ORDER BY awards DESC LIMIT 10

Q: Which batter has the best powerplay strike rate (minimum 200 balls faced in powerplay)?
SQL: SELECT d.batter_name, SUM(d.runs_batter) AS pp_runs, COUNT(*) FILTER (WHERE d.extra_type IS NULL) AS pp_balls, ROUND(SUM(d.runs_batter) * 100.0 / NULLIF(COUNT(*) FILTER (WHERE d.extra_type IS NULL), 0), 2) AS pp_strike_rate FROM deliveries d WHERE d.phase = 'powerplay' GROUP BY d.batter_name HAVING COUNT(*) FILTER (WHERE d.extra_type IS NULL) >= 200 ORDER BY pp_strike_rate DESC LIMIT 10

Q: Does winning the toss help? Show win rate for toss winners vs toss losers.
SQL: SELECT 'Toss Winner' AS group, COUNT(*) FILTER (WHERE m.winner_id = m.toss_winner_id) AS wins, COUNT(*) AS total, ROUND(100.0 * COUNT(*) FILTER (WHERE m.winner_id = m.toss_winner_id) / NULLIF(COUNT(*), 0), 1) AS win_pct FROM matches m WHERE m.outcome_type = 'winner' UNION ALL SELECT 'Toss Loser', COUNT(*) FILTER (WHERE m.winner_id != m.toss_winner_id), COUNT(*), ROUND(100.0 * COUNT(*) FILTER (WHERE m.winner_id != m.toss_winner_id) / NULLIF(COUNT(*), 0), 1) FROM matches m WHERE m.outcome_type = 'winner'

Q: Which bowler has taken the most wickets in powerplay across all IPL seasons?
SQL: SELECT d.bowler_name, COUNT(*) AS pp_wickets FROM deliveries d JOIN wickets w ON w.delivery_id = d.delivery_id WHERE d.phase = 'powerplay' AND w.kind IN ('caught','bowled','lbw','stumped','hit wicket') GROUP BY d.bowler_name ORDER BY pp_wickets DESC LIMIT 10

Q: Show the head-to-head record between Mumbai Indians and Chennai Super Kings.
SQL: SELECT t_win.name AS winner, COUNT(*) AS wins FROM matches m JOIN teams t1 ON m.team1_id = t1.team_id JOIN teams t2 ON m.team2_id = t2.team_id JOIN teams t_win ON m.winner_id = t_win.team_id WHERE m.outcome_type = 'winner' AND ((t1.name = 'Mumbai Indians' AND t2.name = 'Chennai Super Kings') OR (t1.name = 'Chennai Super Kings' AND t2.name = 'Mumbai Indians')) GROUP BY t_win.name

Q: Who are the top 5 six-hitters in death overs across all seasons?
SQL: SELECT d.batter_name, SUM(d.is_six::int) AS death_sixes FROM deliveries d WHERE d.phase = 'death' GROUP BY d.batter_name ORDER BY death_sixes DESC LIMIT 5

## METADATA
The full name of each player is
| Short Name | Full Name |
|------------|-----------|
| MS Dhoni | Mahendra Singh Dhoni |
| RG Sharma | Rohit Gurunath Sharma |
| V Kohli | Virat Kohli |
| AB de Villiers | Abraham Benjamin de Villiers |
| CH Gayle | Christopher Henry Gayle |
| DA Warner | David Andrew Warner |
| SR Watson | Shane Robert Watson |
| YS Chahal | Yuzvendra Singh Chahal |
| JJ Bumrah | Jasprit Jasbirsingh Bumrah |
| HH Pandya | Hardik Himanshu Pandya |
| KH Pandya | Krunal Himanshu Pandya |
| SK Raina | Suresh Kumar Raina |
| RV Uthappa | Robin Venu Uthappa |
| KD Karthik | Krishnakumar Dinesh Karthik |
| PP Chawla | Piyush Pramod Chawla |
| AT Rayudu | Ambati Thirupathi Rayudu |
| AJ Finch | Aaron James Finch |
| BB McCullum | Brendon Barrie McCullum |
| JC Buttler | Joseph Charles Buttler |
| Q de Kock | Quinton de Kock |
| KL Rahul | Kannur Lokesh Rahul |
| RA Jadeja | Ravindrasinh Anirudhsinh Jadeja |
| R Ashwin | Ravichandran Ashwin |
| SP Narine | Sunil Philip Narine |
| Rashid Khan | Rashid Khan Arman |
| K Rabada | Kagiso Rabada |
| F du Plessis | Francois du Plessis |
| MG Johnson | Mitchell Guy Johnson |
| SE Marsh | Shaun Edward Marsh |
| EJG Morgan | Eoin Joseph Gerard Morgan |
| JM Bairstow | Jonathan Marc Bairstow |
| AD Hales | Alexander Daniel Hales |
| HC Brook | Harry Cherrington Brook |
| WP Saha | Wriddhiman Prasanta Saha |
| A Mishra | Amit Mishra |
| S Dhawan | Shikhar Dhawan |
| YK Pathan | Yusuf Khan Pathan |
| IK Pathan | Irfan Khan Pathan |
| B Kumar | Bhuvneshwar Kumar |
| A Nehra | Ashish Nehra |
| G Gambhir | Gautam Gambhir |
| Harbhajan Singh | Harbhajan Singh Plaha |
| Z Khan | Zaheer Khan |
| M Vijay | Murali Vijay |
| S Badrinath | Subramaniam Badrinath |
| R Dravid | Rahul Sharad Dravid |
| V Sehwag | Virender Sehwag |
| SR Tendulkar | Sachin Ramesh Tendulkar |
| SC Ganguly | Sourav Chandidas Ganguly |
| JH Kallis | Jacques Henry Kallis |
| KC Sangakkara | Kumar Chokshanada Sangakkara |
| AC Gilchrist | Adam Craig Gilchrist |
| ST Jayasuriya | Sanath Teran Jayasuriya |
| M Muralitharan | Muttiah Muralitharan |
| ML Hayden | Matthew Lawrence Hayden |
| MEK Hussey | Michael Edward Killeen Hussey |
| RT Ponting | Ricky Thomas Ponting |
| KP Pietersen | Kevin Peter Pietersen |
| Shahid Afridi | Sahibzada Mohammad Shahid Khan Afridi |
| Shoaib Malik | Shoaib Malik |
| Umar Gul | Umar Gul |
| Shoaib Akhtar | Shoaib Akhtar |
| Kamran Akmal | Kamran Akmal |
| Misbah-ul-Haq | Misbah-ul-Haq |
| Mohammad Hafeez | Mohammad Hafeez |
| Shakib Al Hasan | Shakib Al Hasan |
| Mustafizur Rahman | Mustafizur Rahman |
| Mohammed Shami | Mohammed Shami Ahmed |
| Mohammed Siraj | Mohammed Siraj |
| Mohammad Nabi | Mohammad Nabi Eisakhil |
| Mujeeb Ur Rahman | Mujeeb Ur Rahman Zadran |
| Rahmanullah Gurbaz | Rahmanullah Gurbaz |
| Azmatullah Omarzai | Azmatullah Omarzai |
| Noor Ahmad | Noor Ahmad Lakanwal |
| Naveen-ul-Haq | Naveen-ul-Haq Murid |
| Gulbadin Naib | Gulbadin Naib |