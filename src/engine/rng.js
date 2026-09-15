// Seeded, deterministic PRNG. PRODUCT.md §10.4: a visit's entire persona must be
// reproducible from its seed, so coherence within a visit is free, the corpus can assert
// exact outputs, and a breakage report can carry a seed instead of the user's history.
//
// xmur3 + sfc32. Not cryptographic and not used for anything that needs to be: the seed
// itself comes from crypto.getRandomValues, and everything here only decides which
// plausible lie to tell.

function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

function sfc32(a, b, c, d) {
  return () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

export function makeRng(seed) {
  const h = xmur3(String(seed));
  const next = sfc32(h(), h(), h(), h());
  // Warm up: sfc32's first few outputs correlate with the seed bits.
  for (let i = 0; i < 12; i++) next();

  const int = (n) => Math.floor(next() * n);
  const pick = (arr) => arr[int(arr.length)];

  return {
    next,
    int,
    pick,
    bool: (p = 0.5) => next() < p,

    /**
     * Pick from `arr`, avoiding `avoid`. This is the whole point of C1 substitution:
     * "a different value from the same vocabulary". If the vocabulary has nothing else
     * to offer, returns null rather than handing back the original — the caller then
     * leaves the parameter alone, which is the safe failure.
     */
    pickExcept(arr, avoid) {
      const pool = arr.filter((v) => String(v).toLowerCase() !== String(avoid ?? '').toLowerCase());
      return pool.length ? pool[int(pool.length)] : null;
    },

    /**
     * Weighted pick. `weightOf` maps an item to a positive weight. Used for the channel
     * draw, where a uniform distribution across channels would itself be implausible.
     */
    pickWeighted(arr, weightOf) {
      const weights = arr.map((item) => Math.max(0, weightOf(item) ?? 0));
      const total = weights.reduce((a, b) => a + b, 0);
      if (total <= 0) return pick(arr);
      let r = next() * total;
      for (let i = 0; i < arr.length; i++) {
        r -= weights[i];
        if (r < 0) return arr[i];
      }
      return arr[arr.length - 1];
    },

    /** Deterministic string of `length` characters drawn from `alphabet`. */
    chars(alphabet, length) {
      let out = '';
      for (let i = 0; i < length; i++) out += alphabet[int(alphabet.length)];
      return out;
    },
  };
}
