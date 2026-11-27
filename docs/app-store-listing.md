# App Store listing: Plaibook Live (iOS / iPadOS)

Bundle id `live.plaibook.app` · Team NSYYJ2GK7A · project in `ui/ios` (Capacitor 8, Swift Package Manager).

Draft fields first, then the privacy answers, the notes for App Review, and the steps only the account owner can do.
Character counts are against Apple's limits.

**Rules for this listing and its screenshots**
- No prices, plans or purchase paths. The app sells nothing and has no accounts.
- No link or mention of the Plaibook coaching app inside this app (reviewers read two apps from one developer that
  point at each other as one product split in two).
- No competitor names. No emojis.
- Screenshots show real pages; use well-known pro and national teams or colleges, and no under-18 player profiles.

## 1. Fields: English (U.S.)

| Field | Value | Chars |
|---|---|---|
| **Name** (30) | `Plaibook Live: Soccer Scores` | 28 |
| **Subtitle** (30) | `College, Pro & World Stats` | 26 |
| **Keywords** (100) | `ncaa,mls,nwsl,bracket,standings,football,fixtures,results,alerts,rankings,tournament,usmnt,uswnt` | 96 |
| **Primary category** | Sports | |
| **Secondary category** | News | |
| **Support URL** | `https://www.plaibook.live/contact` | |
| **Marketing URL** | `https://www.plaibook.live` | |
| **Privacy Policy URL** | `https://www.plaibook.live/privacy` | |
| **Copyright** | `2026 Plaibook Technologies, Inc.` | |
| **Age rating** | 4+ (no user content, no gambling, no web browsing outside the in-app sheet) | |
| **Price** | Free | |

The name under the icon is "Plaibook Live" (from the app, not this field).

**Promotional text (170)**

Follow your teams and get the score the moment it changes: kick-off, goals and full time for college, pro and international soccer, with brackets and tables.

**Description (4000)**

Plaibook Live is soccer scores and stats from college to the World Cup, built around the teams you follow.

Follow any team, player or competition. No account, no sign-up. The app opens on your teams: what is next, what just happened, and where they stand.

Score alerts
- Kick-off, goals and the final score for everything you follow
- Tap an alert to open the match
- Quiet hours, and each alert type can be switched off

Every level of the American game
- Every NCAA program in Divisions I, II and III: schedules, box scores, rosters, standings and rankings
- The NCAA tournament and conference tournaments as brackets
- MLS, the NWSL and the USL, then the leagues abroad, with tables, squads and player stats
- National teams and international tournaments, with rankings

Made for a phone
- One list of today's matches, with college, pro and international together or apart
- The last scores you loaded stay readable with no signal
- Share a stat card of any player, team or match

Stats are provided as-is. Team names, logos and competition names are trademarks of their owners. Plaibook Live is independent and is not affiliated with or endorsed by the NCAA, any conference, school, league or federation.

## 2. App Privacy answers

Matches `ui/ios/App/App/PrivacyInfo.xcprivacy`.

| Question | Answer |
|---|---|
| Tracking | No |
| Identifiers: Device ID | Collected. App functionality. Not linked to the user. (The push address and a random install token, stored with the list of followed teams so alerts can be sent.) |
| Usage data: Product interaction | Collected. Analytics. Not linked to the user. (Cookie-free page counts.) |
| Contact info, user content | Only if someone uses the corrections or player photo forms: name, email and the photo they send. If those forms stay in the app, add Email, Name and Photos as "App functionality, linked". If they are removed from the app build, nothing more to declare. |
| Advertising | None in the app (ads and sponsors are switched off in the app build). |

## 3. Notes for App Review

No sign-in is needed; every screen is open.

Plaibook Live is a native-shell app with its own bundled interface, not a link to a website. What it does that a
browser does not:
- Follow teams, players and competitions on the device, with push alerts for kick-off, goals and full time (allow
  notifications after following a team to see them; a live match is needed for an alert to arrive).
- My teams as the first screen, kept on the device and restored if the system clears web storage.
- The last loaded scores stay available offline, with a notice.
- Native share sheet for stat card images.
- Universal links from plaibook.live open in the app.

Relation to our other app: "Plaibook" (soccer.plaibook.app) is a planning tool for coaching staff that requires a
club login. Plaibook Live is a free public scores and stats app for fans, with no accounts and no purchases. They
share no screens.

Content rights: sources and permissions are listed at https://www.plaibook.live/sources and
https://www.plaibook.live/data-use. Player photos come from schools and clubs under the permission process at
https://www.plaibook.live/photo; removal requests at https://www.plaibook.live/corrections.

## 4. Only the account owner can do these

1. developer.apple.com → Identifiers: register `live.plaibook.app` with **Push Notifications** and **Associated
   Domains** switched on.
2. developer.apple.com → Keys: create an **APNs** key (or reuse the team's existing one). Give Claude the Key ID and
   the `.p8` file's location so it can be set on Render as `APNS_KEY_ID` and `APNS_KEY_P8` (`APNS_TEAM_ID` is
   NSYYJ2GK7A).
3. App Store Connect → My Apps → new app with this bundle id, iPhone and iPad, free.
4. In `CollegeScraper/ui`: `npm run cap:ios` (builds the app bundle from a clean tree and opens Xcode), pick the
   team if asked, then Product → Archive → Distribute to TestFlight. Raise `CURRENT_PROJECT_VERSION` by one for
   every upload.
5. Paste the fields above, upload screenshots (6.9" iPhone and 13" iPad), fill App Privacy from section 2, set the
   age rating, paste the review notes.

The server must be deployed first: the app calls `https://www.plaibook.live`, which has to answer the app's origin
(`capacitor://localhost`) and serve `/.well-known/apple-app-site-association`.
