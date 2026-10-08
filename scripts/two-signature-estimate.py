# An estimate, for docs/CRYPTOGRAPHY.md, of the work to forge after ONE key has
# signed TWO different messages: LM-OTS with 8-bit digits, the program's step
# limit (checksum high byte <= 14), and a forger free to pick the randomizer.
# For each random pair of in-limit digests it counts exactly how many digests
# have every digit, and both checksum digits, at or above the lower of the two.
#   python3 scripts/two-signature-estimate.py 3000
# Not a security proof. Standard library only; fixed seed.
import random, math, sys
from itertools import accumulate
rng = random.Random(20261008)
LIMIT_HI = 14
TOP = (LIMIT_HI + 1) * 256          # sums at or above this are refused anyway
def digest():
    while True:
        q = [rng.randrange(256) for _ in range(32)]
        s = sum(255 - v for v in q)
        if (s >> 8) <= LIMIT_HI:
            return q, s >> 8, s & 255
def work(m, mh, ml):
    # ways[s] = number of digit tuples with every a_i >= m_i and sum(255-a_i) = s
    ways = [0.0] * TOP; ways[0] = 1.0
    for mi in m:
        w = 255 - mi                # b_i = 255 - a_i ranges over [0, w]
        c = list(accumulate(ways))
        ways = [c[s] - (c[s - w - 1] if s - w - 1 >= 0 else 0.0) for s in range(TOP)]
    total = sum(v for s, v in enumerate(ways) if (s >> 8) >= mh and (s & 255) >= ml)
    return 256 - math.log2(total) if total > 0 else float('inf')
n = int(sys.argv[1]); out = []
for _ in range(n):
    (a, ah, al), (b, bh, bl) = digest(), digest()
    out.append(work([min(x, y) for x, y in zip(a, b)], min(ah, bh), min(al, bl)))
out.sort()
q = lambda f: out[int(f * (n - 1))]
print("pairs", n, "median 2^%.1f" % q(.5), "| 10%% 2^%.1f" % q(.1), "| 1%% 2^%.1f" % q(.01), "| min 2^%.1f" % out[0], "| 90%% 2^%.1f" % q(.9))
