# P3gaz

Warszawa FIR radar simulator with solo play and shared multiplayer rooms.

## Run locally

Install Node.js 24, then run:

```sh
npm ci
npm start
```

Open http://localhost:3000. For multiplayer, select **Multiplayer**, enter initials and create a room. Share the invitation link, then each player selects an available sector. Everyone starts as an observer. The host can split or merge sectors and assign players through **Sectorisation**.

GitHub Pages still supports solo play. Multiplayer requires the Node server; use its address for both hosting and joining.

See [multiplayer and Render setup](docs/multiplayer.md) for deployment, coordination behaviour and testing.
