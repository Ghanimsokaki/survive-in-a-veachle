# Getting real money out of SKYUSS

Short answer: **yes, but it is a traffic business, not a code business.** The game is finished
enough to publish; what it does not have is an audience, and every revenue route below pays per
play, not per release. This file is the honest arithmetic, the routes that fit this project, and
what is already wired in the code.

---

## 1. What the numbers actually look like

Browser games are monetised by advertising, so revenue is roughly:

```
revenue ≈ sessions × ads per session × eCPM ÷ 1000 × your share
```

| Route | Realistic rate | Notes |
| --- | --- | --- |
| Portal ad share (CrazyGames, Poki, GamePix, Y8) | **$1 – $15 per 1 000 plays** | published shares run ~45–60% of ad revenue; one developer's eight WebGL titles earned **€556.92 across 451 327 plays ≈ €1.20 per 1 000 plays** |
| Google AdSense on your own domain | **$1 – $8 RPM in gaming** (lower with an Indonesian audience) | 50 000 pageviews/month at $2 RPM ≈ **$100** |
| itch.io paid page / "pay what you want" | **$2 – $5 per sale**, minus fees | no ads, no minimum; refunds are your problem |
| Gumroad / Ko-fi / Saweria / Trakteer tips | whatever people give | works today, needs an audience that *likes* you |
| Selling asset/tech packs (e.g. this procedural hull kit) | $5 – $40 per pack | separate product, not this game |

What that means concretely:

| Plays per month | Portal income (at $3/1 000) | AdSense on your domain (at $2 RPM) |
| --- |  --- | --- |
| 1 000 | ~$3 | ~$2 |
| 10 000 | ~$30 | ~$20 |
| 100 000 | ~$300 | ~$200 |
| 1 000 000 | ~$3 000 | ~$2 000 |

So: **a game nobody plays earns nothing**, and 100 000 plays is a genuinely good launch. Plan for
the audience first, the payout second.

## 2. Route A — a portal (CrazyGames, Poki)

This is the route that fits a browser game with no marketing budget, because the portal brings
the players.

- **CrazyGames** starts every game in a **Basic Launch with monetisation switched off**. Only
  games with good retention get invited to a **Full Launch**, where the SDK and the revenue share
  begin. Its developer share is not published in the docs; its 2026 GameMaker jam terms list
  **60% of ad revenue** and **70% of in-app purchases** to the developer, with a **€100 payout
  minimum**. Midgame ads are capped at roughly one every three minutes.
- **Poki** pays direct traffic to you outright, and shares traffic it brings on terms in your
  agreement.
- Both forbid the same build from running on a competing portal, and both require *your* assets to
  be the majority of the game — worth knowing, given the Star Trek names (section 5).

**What the game already does for this.** `skyuss/js/portal.js` is a complete adapter:

```js
portal.init()              // detects CrazyGames.SDK or PokiSDK, or returns 'none'
portal.gameplayStart()     // called by the loop when the player takes control
portal.gameplayStop()      // menus, modals, photo mode
portal.commercialBreak()   // interstitial — call at a boundary, never mid-flight
portal.rewardedBreak()     // resolves true only if a reward was actually earned
portal.happytime()         // portal-specific "player is happy" ping
```

`skyuss/js/main.js` already calls `init()`, `gameplayStart()` and `gameplayStop()` on transitions
(not per frame), and it never throws into the game loop — a blocked ad-blocker, an offline SDK or
a broken network all resolve quietly. The smoke test exercises a fake CrazyGames SDK, a fake Poki
SDK and a deliberately broken one.

To go live on a portal, add **one line** to `skyuss/index.html` and place the breaks:

```html
<!-- CrazyGames -->
<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>
```

```js
// where a run ends — death, a photo contract paid, the fortress falling
if (await portal.commercialBreak()) { /* the SDK paused the game for us */ }
```

Good break points in this game, in order of least annoying: after the fortress falls (already a
6-second rebuild pause), after buying a hull in the shipyard, after a photo contract pays, and on
returning to the start menu. Never during a siege — that is the most exciting 90 seconds you have.

## 3. Route B — your own domain (Vercel + AdSense)

Vercel hosting is free at this size, so a custom domain is your only fixed cost (~$10–15/year).

- Apply for AdSense with the deployed URL, add the `ads.txt` Google gives you, and put the ad
  units **around** the canvas — a leaderboard above, a 300×250 beside the HUD — never on top of the
  game. Overlaying an ad on a full-screen game is what gets accounts suspended.
- You need a **privacy policy** page and, for EU/UK visitors, a consent banner (Google's certified
  CMP). Indonesia's traffic is a Tier-3 audience, so expect the lower end of the range.
- AdSense pays out at **$100**; keep the payment profile and tax info accurate, and declare the
  income locally (it is taxable, and an NPWP keeps the rate sane).

Honest sizing: 10 000 visits/month at $2 RPM is **$20/month**. AdSense is a nice topping on a
portal launch, not a business on its own.

## 4. Route C — sell it, don't advertise it

Often more per user than ads, and it works at tiny scale:

- **itch.io**: upload the same folder as an HTML game. "Pay what you want" with a $3 suggested
  price converts a small loyal audience far better than banners do.
- **Cosmetics, not power**: the game already has a shipyard, photo contracts and a hull drop
  system. A paid skin pack (a colour scheme for the Reaver, a chrome Enterprise) is a good
  $2–3 purchase that does not unbalance anything — and, per CrazyGames' terms, in-app purchases
  are usually invite-only, so do this on your own domain or itch.io.
- **Content**: a 30-second clip of the Reaver dreadnought arriving, or the Abyss swallows, is
  exactly the kind of thing that travels on TikTok/Shorts. That is how a browser game finds its
  first 10 000 players these days — not by being listed.

## 5. Do this before you charge anything

1. **Rename the Star Trek references in anything commercial.** `USS Enterprise`, `Kang`,
   `Vengeance`, `Dreadnought-class`, `Galaxy-class` are CBS/Paramount names. The *art* in this
   repo is clean (CC0 Quaternius mesh, everything else procedural and original — including the
   Reaver), but names are trademarks and fan-art licences are explicit about non-commercial use.
   The store copy, the page title and the ship names are the risk, not the geometry. Cheap fix:
   keep the silhouettes, change the names (`Enterprise` → `Aurora`, `Kang-class` → `Vanguard-class`,
   `Vengeance` → `Reaver`).
2. **Never ship the bought mesh.** `skyuss/assets/premium/` is git-ignored exactly so a
   royalty-free TurboSquid hull cannot leak into a public build. A deployed Vengeance OBJ would be
   redistribution.
3. **Keep the license page reachable.** `skyuss/assets/models/quaternius/LICENSE.txt` and
   `skyuss/vendor/THREE-LICENSE.txt` must stay in the deploy (they are, and `npm run deploy:check`
   confirms it).
4. **Add a privacy page if you add ads or analytics.** Today the game sets no cookies and loads
   nothing from another origin; that is a selling point, so do not lose it by accident.

## 6. A 30-day plan that could actually pay something

| Days | Do |
| --- | --- |
| 1 | Deploy to Vercel, play it on a phone, fix whatever is unplayable (`npm run deploy:check` first) |
| 2–5 | Rename the IP references, add a title/description, upload the same build to itch.io (free, no ads) |
| 6–10 | Cut three 20–30 s clips (dreadnought arrival, warp home, Abyss) and post them; put the play link in every one |
| 11–20 | Submit to CrazyGames/Poki with the SDK off (Basic Launch), read the retention numbers they show you |
| 21–30 | If retention is good: add the SDK script + `commercialBreak()` at run boundaries, apply for AdSense as a backstop, and add an itch.io "pay what you want" listing for people who want to support it |

If after 30 days you have a few thousand plays and a handful of tips, that is a *normal* result for
a first browser game — and it is the audience, not the revenue, that makes the next one worth
building.

---

*Sources for the rates above: CrazyGames developer docs / 2026 GameMaker jam terms (60% ads, 70%
IAP, €100 minimum, monetisation off during Basic Launch), a published per-title breakdown of
€556.92 from 451 327 CrazyGames plays, and 2026 AdSense RPM benchmarks putting gaming at roughly
$1–8 per 1 000 pageviews. Portal shares change without notice — read your own contract.*
