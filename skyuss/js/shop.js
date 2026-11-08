/**
 * shop.js — the in-game store, and the two currencies it spends.
 *
 * SKYUSS already had one currency (credits ¢) earned by flying: bounties and
 * photo contracts. This adds a second, **shards (◆)**, which cannot be bought —
 * they only drop from the two things worth doing: a paid photo contract and
 * killing a Reaver dreadnought. That is deliberate. A currency you can only earn
 * is a reward; a currency you can buy is a payment system, and a payment system
 * needs an adult on the account (see MONETISE.md). The store shows the honest
 * "not for sale yet" state instead of a fake checkout.
 *
 * The catalogue lives here so the sim, the UI and the tests all read one list.
 */

/** Engine-glow colours the cosmetics cycle through; `ion` is the stock look. */
export const TRAILS = {
  ion: { hex: '#8fd8ff', name: 'Ion' },
  ember: { hex: '#ff8a3d', name: 'Ember' },
  void: { hex: '#b58cff', name: 'Void' },
  aurora: { hex: '#6bffb0', name: 'Aurora' },
};

export const SHOP = {
  items: [
    {
      id: 'repair', name: 'Hull Patch', icon: '🩹', kind: 'consumable',
      currency: 'credits', price: 120, blurb: 'Panels welded shut — +35% hull, used immediately.',
    },
    {
      id: 'shield', name: 'Shield Cell', icon: '🛡️', kind: 'consumable',
      currency: 'credits', price: 90, blurb: 'Brings every emitter back to full shield.',
    },
    {
      id: 'energy', name: 'Energy Cell', icon: '⚡', kind: 'consumable',
      currency: 'credits', price: 60, blurb: 'Fills the capacitor — warping is expensive.',
    },
    {
      id: 'trail_ember', name: 'Ember Trail', icon: '🔥', kind: 'cosmetic',
      currency: 'shards', price: 5, blurb: 'Engine glow burns orange instead of ion blue.',
    },
    {
      id: 'trail_void', name: 'Void Trail', icon: '🌌', kind: 'cosmetic',
      currency: 'shards', price: 5, blurb: 'Violet exhaust, for flying the Abyss edge.',
    },
    {
      id: 'trail_aurora', name: 'Aurora Trail', icon: '🟢', kind: 'cosmetic',
      currency: 'shards', price: 8, blurb: 'Green plasma, the colour of a healthy warp core.',
    },
  ],

  /** Shown in the store's premium tab. No price, no button — see MONETISE.md. */
  premiumNote: 'Shards are earned, never sold. Real payments need an adult on the account.',
};

const byId = (id) => SHOP.items.find((i) => i.id === id) || null;

/** Trail key for a cosmetic id, e.g. 'trail_void' → 'void'. */
export function trailOf(itemId) {
  return String(itemId).replace(/^trail_/, '');
}

/**
 * Buy one item. Pure state change on the game object — no DOM, so tests can
 * call it directly.
 * @returns {{ok: boolean, message: string, item?: object}}
 */
export function buyItem(game, id) {
  const item = byId(id);
  if (!item) return { ok: false, message: 'Unknown item.' };
  if (item.kind === 'cosmetic') {
    const trail = trailOf(item.id);
    if (game.cosmetics && game.cosmetics.trail === trail) return { ok: false, message: `${item.name} is already installed.`, item };
    if ((game.shards || 0) < item.price) return { ok: false, message: `Needs ${item.price} ◆ — you have ${game.shards || 0}.`, item };
    game.shards -= item.price;
    game.cosmetics = { ...(game.cosmetics || {}), trail };
    return { ok: true, message: `${item.name} installed. Engine glow is now ${TRAILS[trail] ? TRAILS[trail].name : trail}.`, item };
  }

  if ((game.credits || 0) < item.price) return { ok: false, message: `Needs ${item.price} ¢ — you have ${Math.floor(game.credits || 0)}.`, item };
  // consumables are useless at full health; don't take the money
  if (item.id === 'repair' && game.hull >= game.ship.stats.hull) return { ok: false, message: 'Hull is already intact.', item };
  if (item.id === 'shield') {
    if ((game.ship.stats.maxShields || 0) <= 0) return { ok: false, message: 'No shield emitters installed — refit them first.', item };
    if (game.shields >= game.ship.stats.maxShields) return { ok: false, message: 'Shields are already full.', item };
  }
  if (item.id === 'energy' && game.energy >= game.ship.stats.energy) return { ok: false, message: 'Capacitor is already full.', item };

  game.credits -= item.price;
  if (item.id === 'repair') game.hull = Math.min(game.ship.stats.hull, game.hull + game.ship.stats.hull * 0.35);
  else if (item.id === 'shield') game.shields = game.ship.stats.maxShields;
  else if (item.id === 'energy') game.energy = game.ship.stats.energy;
  return { ok: true, message: `${item.name} used.`, item };
}

/** Everything the store panel needs to draw itself. */
export function shopView(game) {
  const credits = Math.floor(game.credits || 0);
  const shards = game.shards || 0;
  return {
    credits,
    shards,
    trail: (game.cosmetics && game.cosmetics.trail) || 'ion',
    rows: SHOP.items.map((item) => {
      const owned = item.kind === 'cosmetic' && trailOf(item.id) === ((game.cosmetics && game.cosmetics.trail) || 'ion');
      const affordable = item.currency === 'shards' ? shards >= item.price : credits >= item.price;
      return { ...item, owned, affordable };
    }),
  };
}
