---
title: The Collatz Conjecture: A Problem No One Can Solve
date: 2026-02-17
excerpt: One of the simplest unsolved problems in mathematics, and what Project Euler problem 14 teaches us about optimization
---

# The Collatz Conjecture: A Problem No One Can Solve

Take any positive integer. If it's even, divide it by 2. If it's odd, multiply by 3 and add 1. Repeat.

The Collatz conjecture says that no matter what number you start with, you'll eventually reach 1.

Nobody has proven this. Not for lack of trying.

## The Sequence

Start with 13:

```
13 → 40 → 20 → 10 → 5 → 16 → 8 → 4 → 2 → 1
```

That's 10 steps. Let's try 27:

```
27 → 82 → 41 → 124 → 62 → 31 → 94 → 47 → 142 → 71 → 214 → 107 → 322 → 161 → 484 → 242 → 121 → 364 → 182 → 91 → 274 → 137 → 412 → 206 → 103 → 310 → 155 → 466 → 233 → 700 → 350 → 175 → 526 → 263 → 790 → 395 → 1186 → 593 → 1780 → 890 → 445 → 1336 → 668 → 334 → 167 → 502 → 251 → 754 → 377 → 1132 → 566 → 283 → 850 → 425 → 1276 → 638 → 319 → 958 → 479 → 1438 → 719 → 2158 → 1079 → 3238 → 1619 → 4858 → 2429 → 7288 → 3644 → 1822 → 911 → 2734 → 1367 → 4102 → 2051 → 6154 → 3077 → 9232 → 4616 → 2308 → 1154 → 577 → 1732 → 866 → 433 → 1300 → 650 → 325 → 976 → 488 → 244 → 122 → 61 → 184 → 92 → 46 → 23 → 70 → 35 → 106 → 53 → 160 → 80 → 40 → 20 → 10 → 5 → 16 → 8 → 4 → 2 → 1
```

That's 112 steps. The number shoots up to 9232 before eventually collapsing back to 1.

This is what makes the Collatz conjecture so fascinating. The behavior seems chaotic, unpredictable. Small changes in starting numbers produce wildly different sequences. But every number tested so far (and we've checked up to 2^68) eventually reaches 1.

## Project Euler Problem 14

The problem asks: which starting number under 1 million produces the longest chain?

The naive solution is simple:

```python
def collatz_length(n):
    count = 0
    while n != 1:
        if n % 2 == 0:
            n = n // 2
        else:
            n = 3 * n + 1
        count += 1
    return count

max_length = 0
max_number = 0

for i in range(1, 1_000_000):
    length = collatz_length(i)
    if length > max_length:
        max_length = length
        max_number = i
```

This works. But it's slow. You're recomputing the same sequences over and over.

## Memoization

Notice that if you're computing the sequence for 40, you'll hit 20, then 10, then 5. If you've already computed the length for 5, you don't need to do it again.

```python
cache = {1: 0}

def collatz_length(n):
    if n in cache:
        return cache[n]

    original = n
    path = []

    while n not in cache:
        path.append(n)
        if n % 2 == 0:
            n = n // 2
        else:
            n = 3 * n + 1

    # Now n is in cache, backfill the path
    length = cache[n]
    for num in reversed(path):
        length += 1
        cache[num] = length

    return cache[original]
```

This is much faster. You compute each chain segment once.

But you can do better.

## Optimizations

**Skip even numbers in the loop:** If n is odd, then 3n+1 is always even. So you can immediately divide by 2:

```python
if n % 2 == 0:
    n = n // 2
else:
    n = (3 * n + 1) // 2
    count += 1  # Count both operations as 2 steps
```

**Bit operations instead of modulo:** Checking if a number is even is just checking the least significant bit:

```python
if n & 1:  # odd
    n = (3 * n + 1) >> 1
else:
    n = n >> 1
```

Faster on most hardware.

**Don't cache everything:** The cache can grow large. You could limit it to numbers below your search range, since you won't revisit numbers above 1 million.

With these optimizations, the problem solves in under a second.

## Why It's Hard to Prove

The Collatz conjecture seems simple. So why can't we prove it?

The issue is that the behavior is chaotic. Sometimes the sequence grows (multiply by 3, add 1), sometimes it shrinks (divide by 2). On average, it shrinks. But "on average" doesn't mean "always."

You can prove that *most* numbers reach 1. You can prove various properties about the sequences. But proving that *every* number reaches 1 requires showing there are no cycles (other than 4 → 2 → 1) and no sequences that grow forever.

Nobody knows how to do this.

Paul Erdős said about the Collatz conjecture: "Mathematics may not be ready for such problems."

It's a humbling reminder. Some problems that look simple are actually deeply hard. The structure might be beyond current mathematical tools.

## What We Learn

Project Euler problem 14 isn't about the Collatz conjecture itself. It's about optimization.

You start with the naive solution. Then you notice repeated work. You cache. You optimize the hot path. You use bit operations. Each step makes it faster.

This is how you solve most programming problems. Start simple, measure, optimize the bottlenecks.

The Collatz conjecture is just the excuse to practice.

And maybe, while you're computing these sequences, you'll notice something. Some pattern nobody has seen before. Some structure that hints at why it works.

Probably not. But that's the fun of it.
