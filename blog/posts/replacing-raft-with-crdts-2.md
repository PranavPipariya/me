---
title: Replacing Raft with CRDTs, part 2: Counters and sets
date: 2026-11-19
excerpt: Part 2 of 4. The smallest CRDTs: a counter that fits in a for loop, and a set where deleting finally works.
---

# Replacing Raft with CRDTs, part 2: Counters and sets

Welcome to part 2 of 4. [Part 1](post.html?post=replacing-raft-with-crdts-1) ended with a goal: replicas that accept writes while offline, and that end up in the same state as soon as they've seen the same updates, in any order. No leader, no voting.

Doing that for text is the hard part, and we'll get there in [part 3](post.html?post=replacing-raft-with-crdts-3). This post builds the two smallest structures that meet the goal, because everything later is made of the same ideas.

## A counter

The editor wants to show how many edits a document has had, and every laptop counts its own edits while offline. When two laptops meet, they merge their counts. My first two merges looked like this (sketches; neither made it into the module, for good reason):

```go
// Try 1: keep the bigger count.
n = max(mine, theirs)

// Try 2: add them.
n = mine + theirs
```

Do you see it? Neither survives a real network:

1. **Keep the bigger one.** If I made 3 edits and you made 2, the answer is not 3. Your work is gone.
2. **Add them.** This works exactly once. The network will happily deliver the same state twice, and suddenly we've made 10 edits. (Networks retry. It's their love language.)

The fix is almost insultingly simple. Don't share one number. Give every replica its own slot, and never write anyone else's:

```go
type GCounter []uint64 // one slot per replica

func (c GCounter) Inc(replica int) { c[replica]++ }

func (c GCounter) Merge(o GCounter) {
	for i := range c {
		c[i] = max(c[i], o[i])
	}
}
```

The value is the sum of the slots. Each replica only ever increments its own slot, so the largest value I've seen for your slot is your true count, and `max` can't lose anything. Eight bytes per replica.

## Why that works

This tiny thing contains the idea behind every state-based CRDT. A network can commit exactly three crimes against your messages, and `max` is innocent of all three. (Below, a⊔b just means "merge a and b".)

- **It reorders them.** `max` doesn't care about order (commutative: a⊔b = b⊔a).
- **It routes them strangely,** gossiped and batched. `max` doesn't care about grouping (associative: (a⊔b)⊔c = a⊔(b⊔c)).
- **It duplicates them.** `max(a, a)` is still `a` (idempotent: a⊔a = a).

A set of states with a merge like this is called a **join-semilattice**. Add one more rule, that updates only ever move a state upward, and every replica's state becomes the merge of whatever updates it has seen. Same updates, same state. That's strong convergence, from a `for` loop.

I don't trust laws I haven't watched survive abuse, so the test does what a bad network does: random increments and random merges between three replicas, in any order, repeated, over 2,000 seeds (20,000 in a stress run). Every replica ends with the identical vector and the true total.

```go
for range 200 {
	a, b := rng.IntN(3), rng.IntN(3)
	if rng.IntN(2) == 0 {
		cs[a].Inc(a)
	} else {
		cs[a].Merge(cs[b]) // any order, any number of times
	}
}
```

Note: decrements need two G-Counters, one for ups and one for downs. That's a PN-Counter. A counter that must never go below zero is a different animal, and it's where this series eventually comes back to Raft.

## A set, and the problem with deleting

Next up: a set. In an editor that could be the document's tags, but every CRDT tutorial is contractually obliged to use a shopping list, so here we are. Adding things is easy: union two sets and you're done. Then something gets removed, and the whole thing starts sweating.

- If merge is union, a removed item comes back the moment I sync with a laptop that still has it. Deletion becomes a suggestion.
- So keep a second set of removed items, called tombstones. That's the 2P-Set. Now a removed item can never come back, even when you want it back, and the tombstone pile grows forever.
- So timestamp everything and let the latest write win. Now whichever laptop has a fast clock wins every argument, silently.

The fix is a sharper question: which adds did this remove actually see? Tag every add with a unique **dot**, the pair (replica, counter). A remove deletes only the dots its replica has seen. If someone re-added the item at the same time, their add carries a dot I've never seen, so my remove can't touch it. A concurrent add beats a remove. This is the **observed-remove set**, and its rule is called add-wins.

The textbook version still keeps a tombstone for every removed dot. The optimized version (Bieniusa et al., 2012) keeps a version vector instead: the highest counter seen from each replica. If my vector covers a dot but I don't hold it, I must have seen that add and removed it. One integer per replica replaces an ever-growing pile:

```go
type Dot struct{ Replica, Seq uint32 }

type ORSet[E comparable] struct {
	id      uint32
	clock   []uint32 // highest counter seen per replica
	entries map[E][]Dot
}
```

And the heart of `Merge`, deciding which dots survive:

```go
for _, d := range mine {
	if slices.Contains(theirs, d) || d.Seq > o.clock[d.Replica] {
		keep = append(keep, d)
	}
}
for _, d := range theirs {
	if !slices.Contains(mine, d) && d.Seq > s.clock[d.Replica] {
		keep = append(keep, d)
	}
}
```

Read the two conditions as English. If you don't have a dot that your clock covers, you saw that add and removed it, so it goes. If you don't have a dot your clock doesn't cover, you just haven't heard about it yet, so it stays.

Here's the case that tells them apart: one replica removes milk while the other adds it again, at the same time. What should both replicas end up with?

```go
a.Add("milk")
b.Merge(a)
a.Remove("milk") // concurrently...
b.Add("milk")    // ...b adds it again
a.Merge(b)
b.Merge(a)
// both: milk is present. a's remove never saw b's new dot.
```

Here are three of those sets: union, tombstones and the or-set. The example runs two tests: a plain remove, then the one above. Play it under each merge and watch where it goes wrong. The or-set also shows its clock, so you can see why a dot survives.

<div class="set-demo"></div>

## Two styles of CRDT

The counter and the set are **state-based**: they ship whole states, and whole states shrug off loss, reordering and duplicates. Text is going to need the other style, **operation-based**, where replicas send small operations and the network must deliver each one exactly once, in causal order: an edit never arrives before the edits its author had already seen. Shapiro's group showed the two styles are equally powerful, and delta-state CRDTs (Almeida, Shoker and Baquero) sit in between.

## Fin

That's part 2. A CRDT is a merge that doesn't care about order, routing or repetition, and deleting is harder than adding because you have to know what the delete saw.

Next time: text, where the positions themselves shift under your feet.

[Part 3: Text that doesn't interleave →](post.html?post=replacing-raft-with-crdts-3)
