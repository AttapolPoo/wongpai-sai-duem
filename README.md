# Animal Racing Party

Editable remake of the animal-racing drinking game concept.

What is included:

- 20 racers
- solo and team battle modes
- random lane switching during races
- tap-to-boost controls so everyone around the phone can help a racer
- harsher punishment chest with 24 cards
- responsive layout for desktop and mobile

## Run locally

```powershell
npm run dev
```

Open [http://localhost:4173](http://localhost:4173).

If that port is busy:

```powershell
$env:PORT=3000
npm run dev
```

## Public hosting

This build is static-host ready.

### Netlify

1. Push this folder to a Git repo.
2. Create a new Netlify site from that repo.
3. Use:
   - Build command: leave empty
   - Publish directory: `.`

### Vercel

1. Import the repo into Vercel.
2. Framework preset: `Other`
3. Build command: leave empty
4. Output directory: `.`

## Important note

This version is public-host friendly as a shared-screen web app. Anyone with the deployed link can open and play it.

It does **not** include true synchronized multiplayer rooms yet. The crowd-boost mechanic is designed for a group playing on the same screen or passing one phone around. If you want real host/join rooms across multiple phones, the next step is adding a backend plus WebSocket room sync.
