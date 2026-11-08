/**
 * portal.js — the one place a web-game portal plugs into SKYUSS.
 *
 * Browser-game money almost always comes from a portal (CrazyGames, Poki) that
 * hosts the build, runs its own ad inventory and pays a revenue share. Those
 * SDKs want four calls: init at load, gameplayStart/Stop around real play, and a
 * commercial break between runs; rewarded ads are optional. This adapter makes
 * those four calls and **does nothing at all** when no SDK is present, so the
 * same build runs on Vercel, on itch.io, on a portal, or from a file:// copy.
 *
 * Nothing here loads an SDK by itself. The portal gives you a <script> tag (or
 * you add it to index.html) and then the calls below find it:
 *
 *   <script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>
 *   <script src="https://game-cdn.poki.com/scripts/v2/poki-sdk.js"></script>
 *
 * Every method resolves instead of throwing, because a game must never break
 * because an ad network is slow, blocked by an ad-blocker, or absent.
 */

export const PORTAL_SDK_SRC = {
  crazygames: 'https://sdk.crazygames.com/crazygames-sdk-v3.js',
  poki: 'https://game-cdn.poki.com/scripts/v2/poki-sdk.js',
};

/** Which SDK, if any, is on this page? Reads only; safe in any environment. */
export function detectPortal(scope = typeof window !== 'undefined' ? window : undefined) {
  if (!scope) return null;
  if (scope.CrazyGames && scope.CrazyGames.SDK) return 'crazygames';
  if (scope.PokiSDK && typeof scope.PokiSDK.init === 'function') return 'poki';
  if (scope.Poki && typeof scope.Poki.init === 'function') return 'poki';
  return null;
}

export class SkyPortal {
  constructor({ scope = typeof window !== 'undefined' ? window : undefined, log = () => {} } = {}) {
    this.scope = scope;
    this.log = log;
    this.kind = null;
    this.ready = false;
    this.playing = false;
    this.invites = 0;          // how many banner slots have been asked for
    this.last = null;          // last call, for tests and the HUD-free debug hook
    this._inFlight = null;
  }

  /** Wrap the bare module functions in the object the renderer talks to. */
  _call(name) {
    this.last = name;
    return this;
  }

  /**
   * Initialise whichever SDK is present. Resolves to the portal name, or
   * `'none'` when the page has no portal (the normal case on Vercel).
   */
  async init() {
    if (this._inFlight) return this._inFlight;
    this._inFlight = (async () => {
      const kind = detectPortal(this.scope);
      this.kind = kind;
      if (!kind) return 'none';
      try {
        if (kind === 'crazygames') {
          const sdk = this.scope.CrazyGames.SDK;
          if (typeof sdk.init === 'function') await sdk.init();
          this.ready = true;
        } else {
          const sdk = this.scope.PokiSDK || this.scope.Poki;
          if (typeof sdk.init === 'function') await sdk.init();
          this.ready = true;
        }
      } catch (err) {
        this.ready = false;
        this.log(`portal init failed: ${err && err.message}`);
      }
      return this.kind;
    })();
    return this._inFlight;
  }

  /** The ship is under the player's control: start counting a gameplay session. */
  gameplayStart() {
    if (this.playing) return this._call('gameplayStart');
    this.playing = true;
    try {
      if (this.kind === 'crazygames') this.scope.CrazyGames.SDK.game.gameplayStart();
      else if (this.kind === 'poki') (this.scope.PokiSDK || this.scope.Poki).gameplayStart();
    } catch { /* a portal hiccup must not pause the game */ }
    return this._call('gameplayStart');
  }

  /** A menu, a modal or a photo pause: stop counting. */
  gameplayStop() {
    if (!this.playing) return this._call('gameplayStop');
    this.playing = false;
    try {
      if (this.kind === 'crazygames') this.scope.CrazyGames.SDK.game.gameplayStop();
      else if (this.kind === 'poki') (this.scope.PokiSDK || this.scope.Poki).gameplayStop();
    } catch { /* ignore */ }
    return this._call('gameplayStop');
  }

  /** Loading overlay, if the SDK has one. */
  loadingProgress(value = null) {
    try {
      if (this.kind === 'crazygames' && this.scope.CrazyGames.SDK.game.loadingStart) {
        if (value === null) this.scope.CrazyGames.SDK.game.loadingStart();
        else if (value >= 1) this.scope.CrazyGames.SDK.game.loadingStop();
      } else if (this.kind === 'poki' && (this.scope.PokiSDK || this.scope.Poki).gameLoadingFinished && value >= 1) {
        (this.scope.PokiSDK || this.scope.Poki).gameLoadingFinished();
      }
    } catch { /* ignore */ }
    return this._call('loadingProgress');
  }

  /**
   * An interstitial between runs. Resolves to `true` when an ad actually ran,
   * `false` when there is no portal, the player has an ad-blocker, or the SDK
   * refuses. Call it at a boundary (death, ship purchase, warp home), never
   * mid-flight.
   */
  async commercialBreak() {
    if (!this.ready) return false;
    try {
      if (this.kind === 'crazygames') {
        await this.scope.CrazyGames.SDK.ad.requestAd('midgame');
        return true;
      }
      if (this.kind === 'poki') {
        await (this.scope.PokiSDK || this.scope.Poki).commercialBreak();
        return true;
      }
    } catch (err) {
      this.log(`commercial break unavailable: ${err && err.message}`);
    }
    return false;
  }

  /** A rewarded ad: resolves to `true` only when the reward was actually earned. */
  async rewardedBreak() {
    if (!this.ready) return false;
    try {
      if (this.kind === 'crazygames') {
        const res = await this.scope.CrazyGames.SDK.ad.requestAd('rewarded');
        return res !== false;
      }
      if (this.kind === 'poki') {
        const res = await (this.scope.PokiSDK || this.scope.Poki).rewardedBreak();
        return res !== false;
      }
    } catch (err) {
      this.log(`rewarded break unavailable: ${err && err.message}`);
    }
    return false;
  }

  /** Portals like to know the player did something worth smiling about. */
  happytime() {
    try {
      if (this.kind === 'crazygames' && this.scope.CrazyGames.SDK.game.happytime) this.scope.CrazyGames.SDK.game.happytime();
      else if (this.kind === 'poki' && (this.scope.PokiSDK || this.scope.Poki).happytime) (this.scope.PokiSDK || this.scope.Poki).happytime();
    } catch { /* ignore */ }
    return this._call('happytime');
  }

  /** One-line status for the debug overlay and the smoke test. */
  status() {
    return `${this.kind || 'none'}${this.ready ? ' (ready)' : ''}`;
  }
}
