# WebXR Meetup 🥽🤝

A multiplayer **WebXR social meetup game** built with **Babylon.js**, an **Express** HTTPS server, and **WebSockets**.
Players join a shared plaza as avatars, walk up to each other, chat, emote, and **connect**. Each new
connection earns points, with a bonus for every interest the two players share. A live leaderboard
appears in the HUD and on a billboard inside the world.

Works on desktop browsers, phones, and VR headsets (Meta Quest Browser, Pico, any WebXR browser) over your local network.

## Features

- **WebXR** via Babylon.js `createDefaultXRExperienceAsync`: teleport locomotion, tracked controllers, and your head and hand poses are synced to other players.
- **Desktop and mobile fallback**: WASD/arrow keys plus mouse or touch look.
- **Social game loop**: get within 3 m of someone, then click them, press <kbd>C</kbd>, or press B/Y in VR to connect. You earn +10 per connection and +5 per shared interest.
- **A room for every interest** (WebXR, Game Dev, 3D Art, Music, AI, Hardware, Design, Web, Fitness, Startups). Walk into a coloured booth to **teleport** to that room, and use the gold 🏠 booth to get back to the Main Plaza. Each room has its own sky and accent colour. Players can create their own rooms too.
- **Two boards:** the in-world *Top Connectors* billboard ranks only the people in your current room. The HUD leaderboard ranks everyone on the site and shows which room each online player is in.
- Chat bubbles above heads and emotes (👋 🎉 ❤️ 😂).
- **UNO card table** in the Game Dev Room, east of the plaza and outside the ring of teleport booths. It's an octagon card table with 8 chairs (models from [Models-for-Meetup-room](https://github.com/Scottie113/Models-for-Meetup-room) / *Table and Chairs*). See [UNO](#uno) below.
- **3D Art Room decor:** an enclosed round gallery with warm off-white plaster walls (subtle trowelled relief via a normal map), a polished white marble floor framed by light-oak boards with a brass inlay, oak skirting, warm interior lighting, and a ceiling of softly moving pastel 3D waves (GPU shader in `public/js/gallery.js`). All textures are generated procedurally in `public/js/textures.js`, so there's nothing extra to download. Van Gogh's *Starry Night* (`starry-night-framed.glb`) and Monet's *Water Lilies* (`water-lilies-kit/water-lilies-framed.glb`) hang on the wall under warm picture lights, alongside Friedrich's *Wanderer above the Sea of Fog* (`friedrich-kit/wanderer-framed.glb`). They're loaded directly from the [Models-for-Meetup-room](https://github.com/Scottie113/Models-for-Meetup-room) repo on GitHub, so they need internet access; offline, the room simply shows without them. Add more paintings to `PAINTINGS` in `public/js/gallery.js`.
- **Step into the painting:** *The Starry Night* in the 3D Art Room is a portal. On PC, walk within 6 m, hover to see it shimmer, and double-click. In VR, point a controller at it: a gold beam runs from your controller to the spot you're aiming at. Pull the trigger to go through. You arrive inside a 3D Starry Night: a hilltop at night with the flame-like cypress, the village with lit windows and church spire in the valley, blue hills and mountains, and Van Gogh's swirling sky painted live in brush dabs all around you (stars with halos, crescent moon). It's all procedural shaders in `public/js/starryNight.js`. The framed window behind you shows a snapshot of the 3D Art Room as seen from the painting; use it the same way (double-click / aim + trigger) to step back out in front of the painting. *Water Lilies* works the same way. It leads to Monet's pond: you stand on a wooden dock, with lavender-blue water painted in soft horizontal dabs and willow reflections, clusters of lily pads with pink and white blossoms, swaying weeping willows, the green Japanese footbridge and a pastel sky (`public/js/waterLilies.js`). Portal effects, the aim beam, the fade and the snapshot live in `public/js/portals.js`.
- **3D models in rooms:** the Music Room has a grand piano out past the teleport booths on the west side (`public/models/grand_piano.glb`, from [Models-for-Meetup-room](https://github.com/Scottie113/Models-for-Meetup-room)). It loads the first time someone visits the room. Its parts are merged by material to keep draw calls low on headsets. A reflection probe captures the room so the lacquer, brass and ivory materials look right without downloading an HDR file. Add more per-room models in `ROOM_PROPS` in `public/js/world.js`.
- **JSON-file persistence**: players, rooms, points and connections live in `data/db.json`. Writes are atomic and queued, and a corrupt file gets backed up.
- **HTTPS by default**: a self-signed certificate is generated automatically and covers `localhost` and all of your LAN IPs. WebXR needs a secure context.
- **Docker**: a compose file with a named volume for the JSON database.
- **Tests**: `node:test` plus supertest for the store, the REST API and the realtime WebSocket protocol.

## Quick start (Node 20+)

```bash
npm install
npm start
```

The console prints the URLs:

```
WebXR Meetup is running:
  this PC:      https://localhost:8443
  your network: https://192.168.1.96:8443
```

Your browser will warn that the certificate is self-signed. Choose **Advanced → Proceed**.

### Testing on your local network (headset / phone)

1. Make sure the device is on the **same Wi-Fi/LAN** as your PC.
2. Open `https://<your-pc-ip>:8443` in the headset's browser (Quest Browser, for example) and accept the certificate warning.
3. If the page doesn't load, allow Node through the firewall. On Windows, run this in an **admin** PowerShell:
   ```powershell
   New-NetFirewallRule -DisplayName "WebXR Meetup" -Direction Inbound -Protocol TCP -LocalPort 8443 -Action Allow -Profile Private
   ```
4. If your PC's IP changes, regenerate the certificate with `npm run cert`.
5. Open a second browser tab or device to see multiplayer in action.

> **Trusted certificates (optional):** if you use [mkcert](https://github.com/FiloSottile/mkcert), put its
> output in `certs/cert.pem` and `certs/key.pem`. Devices that trust the mkcert CA then won't show a warning.

## Docker

```bash
npm run cert                 # optional: create a cert on the host that includes your LAN IPs
docker compose up --build -d
```

- The JSON database lives in the named volume `meetup-data` (`/app/data` inside the container), so it survives rebuilds.
- `./certs` is bind-mounted. If it's empty, the container generates a cert, so set `PUBLIC_HOSTS=<your LAN IP>` in `.env` first.
- Inspect or back up the data: `docker compose exec meetup cat /app/data/db.json`

## UNO

1. In the **Game Dev Room**, walk up to a chair at the card table. When it glows, press <kbd>E</kbd>, or click the chair (in VR, point at it and pull the trigger).
2. Once **2–8 players** are seated, everyone presses **✋ Play**. The game starts when everyone at the table has pressed it. Anyone who sits down during a game waits and joins the next one.
3. Everyone is dealt **8 cards** from one shuffled 108-card deck held in server memory, so no two players can ever hold the same card. Your cards stand in front of your chair and only you can see them; other players see face-down backs and a count. The server only ever sends each player their own hand.
4. **Play** a card by clicking it (in VR, touch or point at it with your controller and pull the trigger). Playable cards lift up on your turn. Card faces: numbers in their colour, **S** = Skip, **R** = Reverse, **D2** = Draw Two, **W** = Wild, **D4** = Wild Draw Four. For W and D4 you then pick a colour from the four chips that appear.
5. **Draw** (button, <kbd>F</kbd>, or the deck in the middle) when you have nothing you can play. Drawing takes one card and ends your turn.
6. **UNO!** (button or <kbd>U</kbd>): when someone is down to one card, the first person to press UNO decides it. If it's the player on one card, they're safe; if anyone else gets there first, that player draws **4**. You can also press it on your turn with two cards to call it early.
7. **Leave** any time with the 🚪 Leave button or <kbd>Q</kbd>. If only one player is left, the game ends.

Turns time out after `UNO_TURN_SECONDS` (default 60): an idle player draws automatically, so one AFK player can't stall the table. The rules live in `server/game/uno.js` and the seats in `server/game/tables.js`, both covered by `test/uno.test.js`.

## Tests

```bash
npm test
```

The tests use an in-memory store and plain HTTP, so they need no certificates and no open ports.

## Project layout

```
server/
  index.js              HTTPS server, HTTP->HTTPS redirect, WebSocket attach, graceful shutdown
  app.js                createApp(): Express app factory (used by tests)
  config.js             env-based config
  middleware/
    index.js            middleware pipeline: helmet/CSP, JSON body limit, rate limit, imports + mounts routes, static, errors
    auth.js             Bearer <playerId>.<token> auth
    errors.js           JSON 404 + error handler
  routes/               health/meta, players, rooms, leaderboard (combined in routes/index.js)
  store/jsonStore.js    JSON-file database
  realtime/socket.js    WebSocket game protocol (join, poses, chat, emotes, connect)
  lib/                  validation, cert generation, LAN IP discovery
public/                 Babylon.js client (lobby, world, avatars, HUD, networking)
scripts/gen-cert.js     regenerate the self-signed certificate
test/                   node:test suites
```

## REST API

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/health` | | Health check |
| GET | `/api/meta` | | Interests, emotes, connect distance |
| POST | `/api/players` | | Register `{name, color, interests[]}` and get back `{player, token}` |
| GET / PATCH | `/api/players/me` | ✓ | Read or update your profile |
| GET | `/api/players/:id` | | Public profile |
| GET / POST | `/api/rooms` | POST ✓ | List rooms (with online counts) or create a room |
| GET | `/api/leaderboard?limit=10` | | Top players |

Auth header: `Authorization: Bearer <playerId>.<token>`. The server stores only a SHA-256 hash of each token.

## WebSocket protocol (`wss://host:8443/ws`)

Client → server: `join {id, token, room}`, `pose {h, l, r}` (each `[x,y,z,qx,qy,qz,qw]`), `chat {text}`, `emote {e}`, `connect {target}`, `switch-room {room}`, `table-sit {table, seat}`, `table-stand`, `uno-ready {ready}`, `uno-play {card, color?}`, `uno-draw`, `uno-call`

Server → client: `welcome` (also sent after each room switch), `peer-join`, `peer-leave`, `poses` (batched at 15 Hz), `chat`, `emote`, `connected`, `leaderboard` (site-wide, pushed on join, leave, switch and connect), `table` (public table state: seats, card counts, top card, turn), `uno-hand` (sent only to its owner), `error`

Chat, emotes, poses and connections are all scoped to the room you're in.

## Security notes

- TLS 1.2+ only. Plain HTTP just redirects to HTTPS.
- Helmet security headers, with a strict CSP (scripts from `'self'` only; Babylon is served locally from `node_modules`). A `Permissions-Policy` header limits WebXR to this origin.
- HSTS is **off by default**, because on `localhost` it would force HTTPS onto every other dev server you run. Set `ENABLE_HSTS=true` on a real domain.
- Rate limits: REST API at 300 requests/min, sign-ups at 20/min. Each socket has its own message buckets.
- 10 KB JSON body limit and 4 KB WebSocket message limit. Every input is validated, chat text has control characters stripped, and the client renders user text with `textContent` or canvas only.
- WebSocket upgrades from other origins are rejected. The server checks the distance between players itself before awarding a connection, so clients can't fake it.
- The container runs as the non-root `node` user. Private keys and the database are git-ignored.

## Configuration

See [.env.example](.env.example): `HTTPS_PORT`, `HTTP_PORT`, `PUBLIC_HOSTS`, `CONNECT_DISTANCE`, `UNO_TURN_SECONDS`, `ENABLE_HSTS`, `DATA_FILE`, `CERT_DIR`.
